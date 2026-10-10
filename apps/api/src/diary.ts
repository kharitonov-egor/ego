import {
  DIARY_PART_SIZE, DIARY_SINGLE_UPLOAD_LIMIT, HTTP_STATUS, isDiaryMultipartComplete,
  type ApiErrorCode, type DiaryMediaInfo, type DiaryMultipartPart, type DiaryMultipartStart, type MediaScope
} from '@ego/api-contracts'
import { DIARY_FILE_SIZE_LIMIT, isDiaryMediaId, isDiaryMimeType } from '@ego/core'
import type { Env } from './auth'
import { query } from './reads'

/**
 * Diary, Tasks, and Food files in R2. The bucket is private and every route sits behind the device token,
 * so a file is only readable through this Worker. A media ID is written once and never changes,
 * which lets the phone cache a download forever. Each app keeps its files under its own prefix
 * and records finished uploads in its own table.
 */

interface MediaStore {
  scope: MediaScope
  table: 'diary_media' | 'task_media' | 'food_media'
}

const STORES: readonly MediaStore[] = [
  { scope: 'diary', table: 'diary_media' },
  { scope: 'tasks', table: 'task_media' },
  { scope: 'food', table: 'food_media' }
]

interface MediaRow {
  id: string
  content_type: string
  size: number
}

const CACHE_FOREVER = 'private, max-age=31536000, immutable'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

function failure(code: ApiErrorCode, message: string): Response {
  return json({ ok: false, error: { code, message } }, HTTP_STATUS[code])
}

function mediaKey(store: MediaStore, id: string): string {
  return `${store.scope}/${id}`
}

function bucketFor(env: Env): R2Bucket | null {
  return env.DIARY_MEDIA ?? null
}

function notConfigured(): Response {
  return failure('NOT_CONFIGURED', 'File storage is not set up on the server')
}

async function storedMedia(db: D1Database, store: MediaStore, id: string): Promise<DiaryMediaInfo | null> {
  const rows = await query<MediaRow>(db, `SELECT id, content_type, size FROM ${store.table} WHERE id = ?`, [id])
  const row = rows[0]
  return row ? { id: row.id, contentType: row.content_type, size: row.size } : null
}

/** Stores a file the Worker already holds, such as a food photo or a file sent to the Telegram bot. */
export async function storeMedia(
  env: Env, scope: MediaScope, id: string, bytes: Uint8Array | ArrayBuffer, contentType: string, now: string
): Promise<boolean> {
  const bucket = bucketFor(env)
  const store = STORES.find((candidate) => candidate.scope === scope)
  if (!bucket || !store || !isDiaryMediaId(id)) return false
  const object = await bucket.put(mediaKey(store, id), bytes, { httpMetadata: { contentType } })
  await recordMedia(env.DB, store, { id, contentType, size: object.size }, now)
  return true
}

export async function deleteFoodPhoto(env: Env, id: string): Promise<void> {
  const bucket = bucketFor(env)
  const store = STORES.find((candidate) => candidate.scope === 'food')
  if (!bucket || !store || !isDiaryMediaId(id)) return
  await bucket.delete(mediaKey(store, id))
  await env.DB.prepare('DELETE FROM food_media WHERE id = ?').bind(id).run()
}

async function recordMedia(db: D1Database, store: MediaStore, media: DiaryMediaInfo, now: string): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO ${store.table} (id, content_type, size, created_at) VALUES (?, ?, ?, ?)`)
    .bind(media.id, media.contentType, media.size, now).run()
}

function contentTypeOf(request: Request): string | null {
  const value = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  return isDiaryMimeType(value) ? value : null
}

function declaredLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/** One request, one file. Sending the same ID again answers with the stored file untouched. */
async function putMedia(request: Request, env: Env, store: MediaStore, id: string, now: string): Promise<Response> {
  const bucket = bucketFor(env)
  if (!bucket) return notConfigured()
  if (!isDiaryMediaId(id)) return failure('INVALID_REQUEST', 'That media ID is not valid')
  const existing = await storedMedia(env.DB, store, id)
  if (existing) return ok(existing)
  const contentType = contentTypeOf(request)
  if (!contentType) return failure('INVALID_REQUEST', 'Send the file with its content type')
  const length = declaredLength(request)
  if (length === null) return failure('INVALID_REQUEST', 'Send the file with its length')
  if (length > DIARY_SINGLE_UPLOAD_LIMIT) return failure('INVALID_REQUEST', 'Send a file this large in parts')
  if (!request.body) return failure('INVALID_REQUEST', 'The file is empty')
  const object = await bucket.put(mediaKey(store, id), request.body, { httpMetadata: { contentType } })
  if (object.size !== length) {
    await bucket.delete(mediaKey(store, id))
    return failure('INVALID_REQUEST', 'The upload was cut short')
  }
  const media: DiaryMediaInfo = { id, contentType, size: object.size }
  await recordMedia(env.DB, store, media, now)
  return ok(media)
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

async function startMultipart(request: Request, env: Env, store: MediaStore, id: string): Promise<Response> {
  const bucket = bucketFor(env)
  if (!bucket) return notConfigured()
  if (!isDiaryMediaId(id)) return failure('INVALID_REQUEST', 'That media ID is not valid')
  const existing = await storedMedia(env.DB, store, id)
  if (existing) return ok<DiaryMultipartStart>({ uploadId: null, media: existing })
  const body = await readJson(request)
  const contentType = typeof body === 'object' && body !== null && 'contentType' in body ? body.contentType : null
  if (!isDiaryMimeType(contentType)) return failure('INVALID_REQUEST', 'Send the file with its content type')
  const upload = await bucket.createMultipartUpload(mediaKey(store, id), { httpMetadata: { contentType: contentType.toLowerCase() } })
  return ok<DiaryMultipartStart>({ uploadId: upload.uploadId, media: null })
}

async function putPart(
  request: Request, env: Env, store: MediaStore, id: string, uploadId: string, partNumber: number
): Promise<Response> {
  const bucket = bucketFor(env)
  if (!bucket) return notConfigured()
  if (!isDiaryMediaId(id) || uploadId.length === 0) return failure('INVALID_REQUEST', 'That upload is not valid')
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > DIARY_FILE_SIZE_LIMIT / DIARY_PART_SIZE + 1) {
    return failure('INVALID_REQUEST', 'That part number is not valid')
  }
  const length = declaredLength(request)
  if (length === null || length > DIARY_SINGLE_UPLOAD_LIMIT) return failure('INVALID_REQUEST', 'Send each part with its length')
  if (!request.body) return failure('INVALID_REQUEST', 'The part is empty')
  try {
    const part = await bucket.resumeMultipartUpload(mediaKey(store, id), uploadId).uploadPart(partNumber, request.body)
    return ok<DiaryMultipartPart>({ partNumber: part.partNumber, etag: part.etag })
  } catch {
    return failure('NOT_FOUND', 'That upload expired. Start it again')
  }
}

async function completeMultipart(
  request: Request, env: Env, store: MediaStore, id: string, uploadId: string, now: string
): Promise<Response> {
  const bucket = bucketFor(env)
  if (!bucket) return notConfigured()
  if (!isDiaryMediaId(id) || uploadId.length === 0) return failure('INVALID_REQUEST', 'That upload is not valid')
  const existing = await storedMedia(env.DB, store, id)
  if (existing) return ok(existing)
  const body = await readJson(request)
  if (!isDiaryMultipartComplete(body)) return failure('INVALID_REQUEST', 'List the uploaded parts')
  const parts = [...body.parts].sort((left, right) => left.partNumber - right.partNumber)
  let object: R2Object
  try {
    object = await bucket.resumeMultipartUpload(mediaKey(store, id), uploadId).complete(parts)
  } catch {
    return failure('NOT_FOUND', 'That upload expired. Start it again')
  }
  const contentType = object.httpMetadata?.contentType
  const media: DiaryMediaInfo = {
    id, contentType: isDiaryMimeType(contentType) ? contentType : 'application/octet-stream', size: object.size
  }
  await recordMedia(env.DB, store, media, now)
  return ok(media)
}

export type ByteRange = { offset: number; length: number }

/** One `bytes=` range. A player asks for these to seek in a video without downloading all of it. */
export function parseByteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix === 0) return 'unsatisfiable'
    const length = Math.min(suffix, size)
    return { offset: size - length, length }
  }
  const start = Number(match[1])
  if (start >= size) return 'unsatisfiable'
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (end < start) return 'unsatisfiable'
  return { offset: start, length: end - start + 1 }
}

async function serveMedia(request: Request, env: Env, store: MediaStore, id: string): Promise<Response> {
  const bucket = bucketFor(env)
  if (!bucket) return notConfigured()
  if (!isDiaryMediaId(id)) return failure('NOT_FOUND', 'That file does not exist')
  const head = await bucket.head(mediaKey(store, id))
  if (!head) return failure('NOT_FOUND', 'That file does not exist')
  const headers = new Headers({
    'content-type': head.httpMetadata?.contentType ?? 'application/octet-stream',
    etag: head.httpEtag,
    'cache-control': CACHE_FOREVER,
    'accept-ranges': 'bytes'
  })
  if (request.headers.get('if-none-match') === head.httpEtag) return new Response(null, { status: 304, headers })
  const range = parseByteRange(request.headers.get('range'), head.size)
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${head.size}`)
    return new Response(null, { status: 416, headers })
  }
  headers.set('content-length', String(range ? range.length : head.size))
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`)
  const status = range ? 206 : 200
  if (request.method === 'HEAD') return new Response(null, { status, headers })
  const object = await bucket.get(mediaKey(store, id), range ? { range } : undefined)
  if (!object) return failure('NOT_FOUND', 'That file does not exist')
  return new Response(object.body, { status, headers })
}

/** Routes under `/v1/<scope>/media/`, one per store. Null means the path is not one of them. */
export function mediaRoute(request: Request, env: Env, path: string, now: string): Promise<Response> | null {
  const store = STORES.find((candidate) => path.startsWith(`/v1/${candidate.scope}/media/`))
  if (!store) return null
  const prefix = `/v1/${store.scope}/media/`
  const parts = path.slice(prefix.length).split('/').map((part) => {
    try {
      return decodeURIComponent(part)
    } catch {
      return ''
    }
  })
  const [id, section, uploadId, last] = parts
  const method = request.method
  if (parts.length === 1) {
    if (method === 'GET' || method === 'HEAD') return serveMedia(request, env, store, id)
    if (method === 'PUT') return putMedia(request, env, store, id, now)
  }
  if (section !== 'multipart') return null
  if (parts.length === 2 && method === 'POST') return startMultipart(request, env, store, id)
  if (parts.length === 4 && last === 'complete' && method === 'POST') return completeMultipart(request, env, store, id, uploadId, now)
  if (parts.length === 4 && method === 'PUT') return putPart(request, env, store, id, uploadId, Number(last))
  return null
}
