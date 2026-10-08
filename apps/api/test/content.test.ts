import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult, ContentKeyCreated, ContentItemRecord } from '@ego/api-contracts'
import { emptyContentItem, filterContent, type ContentItemInput } from '@ego/core'
import type { MoneyApi } from '../../../packages/local/src/api-client'
import { localContent } from '../../../packages/local/src/content/repository'
import { saveContent, saveCollection, deleteCollection } from '../../../packages/local/src/content/actions'
import { createSyncCoordinator } from '../../../packages/local/src/sync/coordinator'
import { allOperations } from '../../../packages/local/src/sync/outbox'
import { keepMine } from '../../../packages/local/src/sync/conflicts'
import { openTestLedger } from '../../../packages/local/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, seedLedger, exec } from './helpers'
const TOKEN = 'device-token-content-testing-0123456789'
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function setup(): Promise<Env> {
  const server = await seedLedger(); cleanup.push(server.close)
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('content-device', 'Test', ?, 'ego-money', ?)`, [await hashToken(TOKEN), new Date().toISOString()])
  return { DB: server.db }
}
async function request(env: Env, path: string, token = TOKEN, method = 'GET', body?: unknown): Promise<Response> {
  return handle(new Request(`https://ego.example${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
}
async function over<T>(env: Env, path: string, method = 'GET', body?: unknown): Promise<ApiResult<T>> { return (await request(env, path, TOKEN, method, body)).json() }
function api(env: Env): MoneyApi {
  return {
    bootstrap: () => over(env, '/v1/bootstrap'), reference: () => over(env, '/v1/reference'),
    balances: () => over(env, '/v1/balances'), transactions: () => over(env, '/v1/transactions'), receipt: id => over(env, `/v1/receipts/${id}`),
    changes: (after, limit) => over(env, `/v1/changes?after=${after}&limit=${limit}`),
    operations: operations => over(env, '/v1/operations', 'POST', { operations })
  }
}
async function phone(env: Env) {
  const db = await openTestLedger(); cleanup.push(() => db.close())
  const coordinator = createSyncCoordinator({ db, api: api(env), now: () => NOW })
  return { db, sync: coordinator.sync }
}
const bookmark = (changes: Partial<ContentItemInput> = {}): ContentItemInput => ({ ...emptyContentItem('https://example.com/article'), title: 'A saved article', kind: 'article', tags: ['Read', 'read'], ...changes })
async function keyFor(env: Env): Promise<ContentKeyCreated> {
  const result = await over<ContentKeyCreated>(env, '/v1/content/keys', 'POST')
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
describe('Content capture and sync', () => {
  it('captures once on retry, bootstraps a phone, and delivers edits, trash, and restore to another phone', async () => {
    const env = await setup(); const key = await keyFor(env)
    const capture = { id: 'capture-test-123', item: bookmark() }
    expect((await request(env, '/v1/content/capture', key.token, 'POST', capture)).status).toBe(200)
    expect((await request(env, '/v1/content/capture', key.token, 'POST', capture)).status).toBe(200)
    const first = await phone(env); const second = await phone(env)
    expect((await first.sync()).touched.content).toBe(true)
    await second.sync()
    let record = (await localContent(first.db)).items[0]
    expect((await localContent(first.db)).items).toHaveLength(1)
    expect(record).toMatchObject({ id: capture.id, title: capture.item.title, tags: ['read'], revision: 1 })
    await saveCollection(first.db, 'Reading', null, NOW)
    const collection = (await localContent(first.db)).collections[0]
    await saveContent(first.db, { ...record, notes: 'Read chapter 2', favorite: true, collectionId: collection.id }, record, NOW)
    await first.sync(); expect((await second.sync()).touched.content).toBe(true)
    record = (await localContent(second.db)).items[0]
    expect(record).toMatchObject({ notes: 'Read chapter 2', favorite: true, collectionId: collection.id, revision: 2 })
    await saveContent(second.db, { ...record, trashedAt: NOW }, record, NOW)
    await second.sync(); await first.sync()
    record = (await localContent(first.db)).items[0]
    expect(filterContent([record], [collection], 'all', '')).toHaveLength(0)
    expect(filterContent([record], [collection], 'trash', '')).toHaveLength(1)
    await saveContent(first.db, { ...record, trashedAt: null }, record, NOW)
    await deleteCollection(first.db, collection, NOW)
    await first.sync(); await second.sync()
    const data = await localContent(second.db)
    expect(data.collections).toHaveLength(0)
    expect(filterContent(data.items, data.collections, 'unsorted', 'chapter read')).toHaveLength(1)
    expect(await allOperations(first.db)).toEqual([])
  })
  it('reports an offline edit conflict and applies Keep mine with the new revision', async () => {
    const env = await setup(); const first = await phone(env); const second = await phone(env)
    await saveContent(first.db, bookmark(), null, NOW); await first.sync(); await second.sync()
    const a = (await localContent(first.db)).items[0]; const b = (await localContent(second.db)).items[0]
    await saveContent(first.db, { ...a, title: 'First edit' }, a, NOW)
    await saveContent(second.db, { ...b, title: 'Second edit' }, b, NOW)
    await first.sync(); await second.sync()
    const conflict = (await allOperations(second.db))[0]
    expect(conflict.status).toBe('conflict')
    await keepMine(second.db, conflict, 'resolve-content-conflict', NOW)
    await second.sync(); await first.sync()
    expect((await localContent(first.db)).items[0].title).toBe('Second edit')
  })
  it('limits extension keys to reading Content and capture, and revokes access', async () => {
    const env = await setup(); const { key, token } = await keyFor(env)
    expect((await request(env, '/v1/content/library', token)).status).toBe(200)
    for (const [path, method] of [['/v1/content/keys', 'POST'], ['/v1/content/keys', 'GET'], ['/v1/bootstrap', 'GET'], ['/v1/operations', 'POST']]) {
      expect((await request(env, path, token, method)).status).toBe(401)
    }
    expect((await request(env, `/v1/content/keys/${key.id}`, TOKEN, 'DELETE')).status).toBe(200)
    expect((await request(env, '/v1/content/library', token)).status).toBe(401)
    expect((await request(env, '/v1/content/capture', token, 'POST', { id: 'capture-123', item: bookmark() })).status).toBe(401)
  })
  it('rejects executable URLs, malformed records, and reuse of an operation ID with different content', async () => {
    const env = await setup(); const { token } = await keyFor(env)
    for (const patch of [{ url: 'javascript:alert(1)' }, { coverUrl: 'data:text/html,<script>' }, { title: '' }, { tags: Array(31).fill('tag') }, { url: 'https://user:password@example.com' }]) {
      expect((await request(env, '/v1/content/capture', token, 'POST', { id: 'bad-content-123', item: bookmark(patch) })).status).toBe(400)
    }
    await request(env, '/v1/content/capture', token, 'POST', { id: 'good-content-123', item: bookmark() })
    expect((await request(env, '/v1/content/capture', token, 'POST', { id: 'good-content-123', item: bookmark({ title: 'Changed' }) })).status).toBe(400)
    const library = await (await request(env, '/v1/content/library', token)).json() as { data: { contentItems: ContentItemRecord[] } }
    expect(library.data.contentItems).toHaveLength(1)
  })
})
