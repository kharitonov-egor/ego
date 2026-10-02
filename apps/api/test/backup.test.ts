import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupKey, runScheduledBackup } from '../src/backup'
import { createTestBucket } from './r2'

const RUN_AT = new Date('2026-10-02T07:00:00.000Z')
const EXPORT_URL = 'https://api.cloudflare.com/client/v4/accounts/account-1/d1/database/db-1/export'
const SIGNED_URL = 'https://export.example/dump.sql?signature=abc'
const DUMP = 'PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE accounts (id TEXT PRIMARY KEY);\n'

afterEach(() => {
  vi.unstubAllGlobals()
})

function environment() {
  const { bucket, objects } = createTestBucket()
  return {
    env: { BACKUPS: bucket, D1_ACCOUNT_ID: 'account-1', D1_DATABASE_ID: 'db-1', D1_EXPORT_TOKEN: 'cf-token' },
    objects
  }
}

function poll(result: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { type: 'export', ...result } }))
}

function fakeCloudflare(polls: Response[]) {
  const sent: { url: string; init: RequestInit | undefined }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    sent.push({ url, init })
    if (url === SIGNED_URL) return new Response(DUMP)
    return polls.shift() ?? new Response('{}', { status: 500 })
  })
  return { fetch: fetchMock, sent }
}

describe('database backup', () => {
  it('polls the export until it finishes and stores the dump under the run date', async () => {
    const { env, objects } = environment()
    const cloudflare = fakeCloudflare([
      poll({ status: 'active', at_bookmark: 'bookmark-1' }),
      poll({ status: 'complete', at_bookmark: 'bookmark-2', result: { filename: 'dump.sql', signed_url: SIGNED_URL } })
    ])
    vi.stubGlobal('fetch', cloudflare.fetch)

    await runScheduledBackup(env, RUN_AT, 0)

    const [first, second] = cloudflare.sent
    expect(first.url).toBe(EXPORT_URL)
    expect(new Headers(first.init?.headers).get('authorization')).toBe('Bearer cf-token')
    expect(JSON.parse(String(first.init?.body))).toEqual({ output_format: 'polling' })
    expect(JSON.parse(String(second.init?.body))).toEqual({ output_format: 'polling', current_bookmark: 'bookmark-1' })

    const stored = objects.get('d1/2026-10-02.sql')
    expect(stored?.contentType).toBe('application/sql')
    expect(new TextDecoder().decode(stored?.bytes)).toBe(DUMP)
  })

  it('stores nothing when the export fails', async () => {
    const { env, objects } = environment()
    vi.stubGlobal('fetch', fakeCloudflare([poll({ status: 'error', at_bookmark: 'b', error: 'Database is too busy' })]).fetch)
    await expect(runScheduledBackup(env, RUN_AT, 0)).rejects.toThrow('D1 export failed: Database is too busy')
    expect(objects.size).toBe(0)
  })

  it("reports Cloudflare's reason when the token is refused", async () => {
    const { env } = environment()
    const refused = new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), { status: 403 })
    vi.stubGlobal('fetch', fakeCloudflare([refused]).fetch)
    await expect(runScheduledBackup(env, RUN_AT, 0)).rejects.toThrow('D1 export failed with status 403: Authentication error')
  })

  it('fails loudly until the token secret is set', async () => {
    const { env } = environment()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(runScheduledBackup({ ...env, D1_EXPORT_TOKEN: undefined }, RUN_AT, 0)).rejects.toThrow('not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names one file per UTC day', () => {
    expect(backupKey(new Date('2026-12-31T23:59:59.000Z'))).toBe('d1/2026-12-31.sql')
  })
})
