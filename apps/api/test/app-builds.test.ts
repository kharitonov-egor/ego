import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppBuildStatus } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-aaaaaa'
const SECRET = 'webhook-secret-at-least-16'
let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

async function payload<T>(response: Response): Promise<Envelope<T>> {
  return await response.json() as Envelope<T>
}

async function environment(overrides: Partial<Env> = {}): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-a', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: ledger.db, EAS_WEBHOOK_SECRET: SECRET, ...overrides }
}

function report(overrides: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'build-9',
    platform: 'android',
    status: 'finished',
    artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/abc.apk' },
    metadata: {
      appVersion: '0.4.0',
      appBuildVersion: '9',
      buildProfile: 'preview',
      distribution: 'internal',
      gitCommitHash: 'd8d3d2114854a7ff340a706c7c7e30e5374a2ce5',
      gitCommitMessage: 'feat: install new builds from Settings\n\nLonger body.',
      ...metadata
    },
    completedAt: '2026-09-29T02:21:24.114Z',
    expirationDate: '2099-01-01T00:00:00.000Z',
    ...overrides
  }
}

function webhook(body: unknown, secret = SECRET): Request {
  const raw = JSON.stringify(body)
  return new Request('https://ego.example/v1/app/builds/webhook', {
    method: 'POST',
    body: raw,
    headers: { 'expo-signature': `sha1=${createHmac('sha1', secret).update(raw).digest('hex')}` }
  })
}

function latest(): Request {
  return new Request('https://ego.example/v1/app/builds/latest', { headers: { authorization: `Bearer ${TOKEN}` } })
}

describe('app builds', () => {
  it('stores a signed preview APK and offers it as the latest build', async () => {
    const env = await environment()
    const stored = await handle(webhook(report()), env)
    expect(stored.status).toBe(200)
    expect((await payload<{ stored: boolean }>(stored)).data).toEqual({ stored: true })

    const body = await payload<AppBuildStatus>(await handle(latest(), env))
    expect(body.data).toEqual({
      webhookReady: true,
      latest: {
        id: 'build-9',
        appVersion: '0.4.0',
        buildNumber: 9,
        apkUrl: 'https://expo.dev/artifacts/eas/abc.apk',
        title: 'feat: install new builds from Settings',
        commit: 'd8d3d2114854a7ff340a706c7c7e30e5374a2ce5',
        completedAt: '2026-09-29T02:21:24.114Z',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    })
  })

  it('rejects a report signed with another secret', async () => {
    const env = await environment()
    const response = await handle(webhook(report(), 'someone-elses-secret'), env)
    expect(response.status).toBe(401)
    expect((await payload<AppBuildStatus>(await handle(latest(), env))).data.latest).toBeNull()
  })

  it('refuses every report until the secret is set', async () => {
    const env = await environment({ EAS_WEBHOOK_SECRET: undefined })
    expect((await handle(webhook(report()), env)).status).toBe(503)
    expect((await payload<AppBuildStatus>(await handle(latest(), env))).data).toEqual({ webhookReady: false, latest: null })
  })

  it('acknowledges builds the phone cannot install without storing them', async () => {
    const env = await environment()
    const skipped = [
      report({ status: 'errored' }),
      report({ platform: 'ios' }),
      report({ artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/abc.aab' } }, { distribution: 'store' }),
      report({ artifacts: {} })
    ]
    for (const body of skipped) {
      const response = await handle(webhook(body), env)
      expect(response.status).toBe(200)
      expect((await payload<{ stored: boolean }>(response)).data.stored).toBe(false)
    }
    expect((await payload<AppBuildStatus>(await handle(latest(), env))).data.latest).toBeNull()
  })

  it('keeps one row per build when EAS retries, and skips expired builds', async () => {
    const env = await environment()
    await handle(webhook(report()), env)
    await handle(webhook(report()), env)
    await handle(webhook(report({ id: 'build-8', expirationDate: '2000-01-01T00:00:00.000Z' }, { appBuildVersion: '8' })), env)
    await handle(webhook(report({ id: 'build-10', expirationDate: '2000-01-01T00:00:00.000Z' }, { appBuildVersion: 10 })), env)
    const rows = await ledger!.db.prepare('SELECT id FROM app_builds ORDER BY id').all<{ id: string }>()
    expect(rows.results.map((row) => row.id)).toEqual(['build-10', 'build-8', 'build-9'])
    expect((await payload<AppBuildStatus>(await handle(latest(), env))).data.latest?.buildNumber).toBe(9)
  })

  it('serves the latest build only to a signed-in device', async () => {
    const env = await environment()
    const response = await handle(new Request('https://ego.example/v1/app/builds/latest'), env)
    expect(response.status).toBe(401)
  })
})
