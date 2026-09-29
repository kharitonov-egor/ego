import { afterEach, describe, expect, it } from 'vitest'
import type {
  BootstrapData, ChangePage, DiaryMediaInfo, DiaryMultipartPart, DiaryMultipartStart, OperationResponse, SyncOperation
} from '@ego/api-contracts'
import type { DiaryAttachment, DiaryMessageInput } from '@ego/core'
import { hashToken, type Env } from '../src/auth'
import { parseByteRange } from '../src/diary'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'
import { createTestBucket } from './r2'

const TOKEN = 'device-token-that-is-long-enough-0123456789'

let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

async function setup(): Promise<{ env: Env; objects: ReturnType<typeof createTestBucket>['objects'] }> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-1', 'Phone', ?, 'ego-money', ?)`, [await hashToken(TOKEN), NOW])
  const { bucket, objects } = createTestBucket()
  return { env: { DB: ledger.db, DIARY_MEDIA: bucket }, objects }
}

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  return new Request(`https://ego.example${path}`, { ...init, headers })
}

function upload(id: string, bytes: Uint8Array, contentType = 'image/jpeg'): Request {
  return request(`/v1/diary/media/${id}`, {
    method: 'PUT', body: bytes, headers: { 'content-type': contentType, 'content-length': String(bytes.length) }
  })
}

async function data<T>(response: Response): Promise<T> {
  const payload = await response.json() as { ok: boolean; data: T }
  return payload.data
}

async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  const payload = await response.json() as { error: { code: string; message: string } }
  return payload.error
}

const photo = (mediaId: string | null, overrides: Partial<DiaryAttachment> = {}): DiaryAttachment => ({
  mediaId, kind: 'photo', mimeType: 'image/jpeg', fileName: null, size: 5, width: 10, height: 10,
  durationSeconds: null, title: null, performer: null, emoji: null, previewId: null, waveform: null, ...overrides
})

const message = (overrides: Partial<DiaryMessageInput> = {}): DiaryMessageInput => ({
  sentAt: '2021-03-08T01:04:59.000Z', text: 'Always wanted a channel', entities: [], attachments: [],
  replyToId: null, forwarded: false, forwardedFrom: null, pinnedAt: null, editedAt: null, source: 'telegram', ...overrides
})

function operations(...items: SyncOperation[]): Request {
  return request('/v1/operations', {
    method: 'POST', body: JSON.stringify({ operations: items }), headers: { 'content-type': 'application/json' }
  })
}

const create = (operationId: string, entityId: string, input: DiaryMessageInput): SyncOperation => ({
  operationId, entityId, expectedRevision: null, createdAt: NOW, command: { entity: 'diaryMessage', type: 'create', payload: input }
})

describe('diary media', () => {
  it('stores a file once and serves it back with its type', async () => {
    const { env } = await setup()
    const bytes = new TextEncoder().encode('hello')
    const stored = await handle(upload('m-1', bytes), env)
    expect(await data<DiaryMediaInfo>(stored)).toEqual({ id: 'm-1', contentType: 'image/jpeg', size: 5 })

    const again = await handle(upload('m-1', new TextEncoder().encode('other!')), env)
    expect(await data<DiaryMediaInfo>(again)).toEqual({ id: 'm-1', contentType: 'image/jpeg', size: 5 })

    const served = await handle(request('/v1/diary/media/m-1'), env)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/jpeg')
    expect(served.headers.get('cache-control')).toContain('immutable')
    expect(await served.text()).toBe('hello')
  })

  it('answers a byte range, a HEAD, and a matching ETag', async () => {
    const { env } = await setup()
    await handle(upload('clip', new TextEncoder().encode('0123456789'), 'video/mp4'), env)
    const partial = await handle(request('/v1/diary/media/clip', { headers: { range: 'bytes=2-4' } }), env)
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 2-4/10')
    expect(await partial.text()).toBe('234')

    const head = await handle(request('/v1/diary/media/clip', { method: 'HEAD' }), env)
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')

    const cached = await handle(request('/v1/diary/media/clip', { headers: { 'if-none-match': head.headers.get('etag') ?? '' } }), env)
    expect(cached.status).toBe(304)

    const beyond = await handle(request('/v1/diary/media/clip', { headers: { range: 'bytes=20-' } }), env)
    expect(beyond.status).toBe(416)
  })

  it('refuses uploads without a type or length, and IDs that are not safe keys', async () => {
    const { env } = await setup()
    const untyped = await handle(request('/v1/diary/media/m-2', { method: 'PUT', body: new Uint8Array([1, 2, 3]), headers: { 'content-length': '3' } }), env)
    expect(untyped.status).toBe(400)
    const unsafe = await handle(upload('a.b', new Uint8Array([1])), env)
    expect(unsafe.status).toBe(400)
    const missing = await handle(request('/v1/diary/media/nothing-here'), env)
    expect(missing.status).toBe(404)
  })

  it('assembles a large file from parts', async () => {
    const { env } = await setup()
    const start = await data<DiaryMultipartStart>(await handle(request('/v1/diary/media/big/multipart', {
      method: 'POST', body: JSON.stringify({ contentType: 'video/mp4' })
    }), env))
    expect(start.media).toBeNull()
    const uploadId = encodeURIComponent(start.uploadId ?? '')
    const parts: DiaryMultipartPart[] = []
    for (const [index, chunk] of ['abc', 'def'].entries()) {
      const response = await handle(request(`/v1/diary/media/big/multipart/${uploadId}/${index + 1}`, {
        method: 'PUT', body: chunk, headers: { 'content-length': '3' }
      }), env)
      parts.push(await data<DiaryMultipartPart>(response))
    }
    const done = await handle(request(`/v1/diary/media/big/multipart/${uploadId}/complete`, {
      method: 'POST', body: JSON.stringify({ parts: [...parts].reverse() })
    }), env)
    expect(await data<DiaryMediaInfo>(done)).toEqual({ id: 'big', contentType: 'video/mp4', size: 6 })
    expect(await (await handle(request('/v1/diary/media/big'), env)).text()).toBe('abcdef')

    const repeat = await data<DiaryMultipartStart>(await handle(request('/v1/diary/media/big/multipart', {
      method: 'POST', body: JSON.stringify({ contentType: 'video/mp4' })
    }), env))
    expect(repeat).toEqual({ uploadId: null, media: { id: 'big', contentType: 'video/mp4', size: 6 } })
  })

  it('says storage is missing when the bucket is not bound', async () => {
    const { env } = await setup()
    const response = await handle(upload('m-1', new Uint8Array([1])), { DB: env.DB })
    expect(response.status).toBe(503)
    expect((await errorOf(response)).code).toBe('NOT_CONFIGURED')
  })
})

describe('byte ranges', () => {
  it('reads the forms a player sends', () => {
    expect(parseByteRange('bytes=0-', 10)).toEqual({ offset: 0, length: 10 })
    expect(parseByteRange('bytes=5-100', 10)).toEqual({ offset: 5, length: 5 })
    expect(parseByteRange('bytes=-3', 10)).toEqual({ offset: 7, length: 3 })
    expect(parseByteRange('bytes=10-', 10)).toBe('unsatisfiable')
    expect(parseByteRange('items=1-2', 10)).toBeNull()
    expect(parseByteRange(null, 10)).toBeNull()
  })
})

describe('diary messages', () => {
  it('waits for every attached file before it accepts a message', async () => {
    const { env } = await setup()
    const withPhoto = message({ text: '', attachments: [photo('p-1', { previewId: 'p-1-preview' })] })
    const early = await data<OperationResponse>(await handle(operations(create('op-1', 'tg-35', withPhoto)), env))
    expect(early.failed?.error).toMatchObject({ code: 'INVALID_REQUEST', message: 'Upload the 2 attached files before sending' })

    await handle(upload('p-1', new Uint8Array([1, 2, 3, 4, 5])), env)
    await handle(upload('p-1-preview', new Uint8Array([1])), env)
    const sent = await data<OperationResponse>(await handle(operations(create('op-2', 'tg-35', withPhoto)), env))
    expect(sent.results).toEqual([expect.objectContaining({ entity: 'diaryMessage', entityId: 'tg-35', status: 'applied', revision: 1 })])
  })

  it('accepts a message whose file never reached Ego', async () => {
    const { env } = await setup()
    const lost = message({ text: '', forwarded: true, forwardedFrom: 'Telegram Memes', attachments: [photo(null, { kind: 'video', mimeType: 'video/mp4' })] })
    const sent = await data<OperationResponse>(await handle(operations(create('op-1', 'tg-148', lost)), env))
    expect(sent.failed).toBeNull()
  })

  it('downloads, pins, and deletes through the change log', async () => {
    const { env } = await setup()
    await handle(operations(create('op-1', 'tg-4', message())), env)
    const bootstrap = await data<BootstrapData>(await handle(request('/v1/bootstrap'), env))
    expect(bootstrap.diaryMessages).toEqual([expect.objectContaining({
      id: 'tg-4', text: 'Always wanted a channel', forwarded: false, entities: [], attachments: [], revision: 1
    })])

    const pinned = await data<OperationResponse>(await handle(operations({
      operationId: 'op-2', entityId: 'tg-4', expectedRevision: 1, createdAt: NOW,
      command: { entity: 'diaryMessage', type: 'update', payload: message({ pinnedAt: '2021-07-16T21:01:07.000Z' }) }
    }), env))
    expect(pinned.results[0]).toMatchObject({ revision: 2 })

    const stale = await data<OperationResponse>(await handle(operations({
      operationId: 'op-3', entityId: 'tg-4', expectedRevision: 1, createdAt: NOW,
      command: { entity: 'diaryMessage', type: 'update', payload: message({ text: 'Stale edit' }) }
    }), env))
    expect(stale.failed?.error.code).toBe('CONFLICT')

    await handle(operations({
      operationId: 'op-4', entityId: 'tg-4', expectedRevision: 2, createdAt: NOW, command: { entity: 'diaryMessage', type: 'delete' }
    }), env)
    const changes = await data<ChangePage>(await handle(request('/v1/changes?after=0'), env))
    expect(changes.changes.map((change) => [change.entity, change.action, change.revision])).toEqual([
      ['diaryMessage', 'upsert', 1], ['diaryMessage', 'upsert', 2], ['diaryMessage', 'delete', 3]
    ])
    const pinChange = changes.changes[1]
    expect(pinChange.entity === 'diaryMessage' && pinChange.record?.pinnedAt).toBe('2021-07-16T21:01:07.000Z')
    const after = await data<BootstrapData>(await handle(request('/v1/bootstrap'), env))
    expect(after.diaryMessages).toEqual([])
  })

  it('refuses a message that is empty or points outside its text', async () => {
    const { env } = await setup()
    const empty = await handle(operations(create('op-1', 'd-1', message({ text: ' ' }))), env)
    expect(empty.status).toBe(400)
    const outside = await handle(operations(create('op-2', 'd-2', message({ entities: [{ type: 'bold', offset: 0, length: 999 }] }))), env)
    expect(outside.status).toBe(400)
  })
})
