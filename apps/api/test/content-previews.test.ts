import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult, SyncOperation } from '@ego/api-contracts'
import { emptyContentItem, type ContentItemInput } from '@ego/core'
import type { MoneyApi } from '../../../packages/local/src/api-client'
import { localContent } from '../../../packages/local/src/content/repository'
import { saveContent } from '../../../packages/local/src/content/actions'
import { createSyncCoordinator } from '../../../packages/local/src/sync/coordinator'
import { openTestLedger } from '../../../packages/local/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { applyOperation } from '../src/commands'
import { previewBase, renderContentPreviews, type PageRenderer } from '../src/content-previews'
import { handle } from '../src/router'
import { NOW, seedLedger, exec } from './helpers'
import { createTestBucket } from './r2'

const TOKEN = 'device-token-previews-testing-0123456789'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })

async function setup(): Promise<{ env: Env; objects: Map<string, unknown> }> {
  const server = await seedLedger(); cleanup.push(server.close)
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('preview-device', 'Test', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  const { bucket, objects } = createTestBucket()
  return { env: { DB: server.db, CONTENT_PREVIEWS: bucket, PUBLIC_BASE_URL: 'https://ego.example/' }, objects }
}
async function over<T>(env: Env, path: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> {
  const response = await handle(new Request(`https://ego.example${path}`, {
    method, headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  }), env)
  return response.json()
}
async function phone(env: Env) {
  const db = await openTestLedger(); cleanup.push(() => db.close())
  const api: MoneyApi = {
    bootstrap: () => over(env, '/v1/bootstrap'), reference: () => over(env, '/v1/reference'),
    balances: () => over(env, '/v1/balances'), transactions: () => over(env, '/v1/transactions'), receipt: id => over(env, `/v1/receipts/${id}`),
    changes: (after, limit) => over(env, `/v1/changes?after=${after}&limit=${limit}`),
    operations: operations => over(env, '/v1/operations', 'POST', { operations })
  }
  return { db, sync: createSyncCoordinator({ db, api, now: () => NOW }).sync }
}
const bookmark = (url: string, changes: Partial<ContentItemInput> = {}): ContentItemInput => ({ ...emptyContentItem(url), title: url, ...changes })
function recorder(answer: (url: string) => Promise<Uint8Array | string> | Uint8Array | string = () => JPEG): PageRenderer & { calls: string[][] } {
  const calls: string[][] = []
  return Object.assign(async (urls: string[]) => {
    calls.push(urls)
    const results: Array<Uint8Array | string> = []
    for (const url of urls) results.push(await answer(url))
    return results
  }, { calls })
}

describe('Content previews', () => {
  it('screenshots bookmarks without a cover once and syncs the screenshot as their cover', async () => {
    const { env, objects } = await setup(); const device = await phone(env)
    await saveContent(device.db, bookmark('https://example.com/essay'), null, NOW)
    await saveContent(device.db, bookmark('https://example.com/has-cover', { coverUrl: 'https://example.com/cover.png' }), null, NOW)
    await saveContent(device.db, bookmark('https://example.com/trashed', { trashedAt: NOW }), null, NOW)
    await device.sync()
    const render = recorder()
    expect(await renderContentPreviews(env, previewBase(env), 5, render)).toEqual({ applied: 1, failed: 0 })
    expect(render.calls).toEqual([['https://example.com/essay']])
    await device.sync()
    const essay = (await localContent(device.db)).items.find(item => item.url === 'https://example.com/essay')
    expect(essay?.revision).toBe(2)
    const cover = essay?.coverUrl ?? ''
    expect(cover).toMatch(/^https:\/\/ego\.example\/v1\/content\/previews\/[a-f0-9]{48}\.jpg$/)
    expect(objects.size).toBe(1)
    const image = await handle(new Request(cover), env)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(JPEG)
    expect((await handle(new Request('https://ego.example/v1/content/previews/' + 'a'.repeat(48) + '.jpg'), env)).status).toBe(404)
    expect((await handle(new Request('https://ego.example/v1/content/previews/..%2Fsecret.jpg'), env)).status).toBe(404)
    expect(await renderContentPreviews(env, previewBase(env), 5, render)).toEqual({ applied: 0, failed: 0 })
    expect(render.calls).toHaveLength(1)
  })

  it('waits six hours before retrying a page that failed, and stops after three attempts', async () => {
    const { env } = await setup(); const device = await phone(env)
    await saveContent(device.db, bookmark('https://blocked.example/'), null, NOW); await device.sync()
    const render = recorder(() => 'The page answered 403')
    const at = (hours: number) => new Date(Date.parse(NOW) + hours * 3_600_000)
    expect(await renderContentPreviews(env, previewBase(env), 5, render, at(1))).toEqual({ applied: 0, failed: 1 })
    expect(await renderContentPreviews(env, previewBase(env), 5, render, at(2))).toEqual({ applied: 0, failed: 0 })
    await renderContentPreviews(env, previewBase(env), 5, render, at(8))
    await renderContentPreviews(env, previewBase(env), 5, render, at(15))
    await renderContentPreviews(env, previewBase(env), 5, render, at(22))
    expect(render.calls).toHaveLength(3)
  })

  it('keeps a screenshot through an edit conflict and applies it to the newer revision without rendering again', async () => {
    const { env } = await setup(); const device = await phone(env)
    await saveContent(device.db, bookmark('https://example.com/busy'), null, NOW); await device.sync()
    const item = (await localContent(device.db)).items[0]
    const render = recorder(async () => {
      const edit: SyncOperation = {
        operationId: 'edit-during-render', entityId: item.id, expectedRevision: 1, createdAt: NOW,
        command: { entity: 'contentItem', type: 'update', payload: { ...bookmark(item.url), title: 'Edited meanwhile' } }
      }
      await applyOperation(env.DB, edit, NOW)
      return JPEG
    })
    expect(await renderContentPreviews(env, previewBase(env), 5, render)).toEqual({ applied: 0, failed: 0 })
    expect(await renderContentPreviews(env, previewBase(env), 5, render)).toEqual({ applied: 1, failed: 0 })
    expect(render.calls).toHaveLength(1)
    await device.sync()
    expect((await localContent(device.db)).items[0]).toMatchObject({ title: 'Edited meanwhile', revision: 3 })
    expect((await localContent(device.db)).items[0].coverUrl).toContain('/v1/content/previews/')
  })

  it('renders on request for a signed-in device but not for an extension key', async () => {
    const { env } = await setup()
    expect(await over(env, '/v1/content/previews', 'POST')).toEqual({ ok: true, data: { applied: 0, failed: 0 } })
    const key = await over<{ token: string }>(env, '/v1/content/keys', 'POST')
    if (!key.ok) throw new Error(key.error.message)
    const response = await handle(new Request('https://ego.example/v1/content/previews', { method: 'POST', headers: { authorization: `Bearer ${key.data.token}` } }), env)
    expect(response.status).toBe(401)
  })
})
