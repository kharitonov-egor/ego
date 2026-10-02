import { app, net, protocol, shell } from 'electron'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  DIARY_PART_SIZE, DIARY_SINGLE_UPLOAD_LIMIT,
  type ApiResult, type DiaryMediaInfo, type DiaryMultipartPart, type MediaScope
} from '@ego/api-contracts'
import { resultFrom, type DiaryMediaApi } from '@ego/local/api-client'
import type { PendingUpload, UploadTransport } from '@ego/local/diary/uploads'
import type { LocalDatabase } from '@ego/local/database/types'
import type { MediaFileInput, MediaOpenInput, MediaPathInput, StagedMedia } from '../../shared/local'

export const MEDIA_SCHEME = 'ego-media'

/** Whole files under this size are kept after the first view, so a diary grid does not download twice. */
const CACHE_LIMIT = 25 * 1024 * 1024

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/webm': '.weba',
  'audio/aac': '.aac',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
  'application/json': '.json'
}

export function extensionFor(mimeType: string, fileName: string | null): string {
  const known = EXTENSIONS[mimeType]
  if (known) return known
  const dot = fileName?.lastIndexOf('.') ?? -1
  return fileName && dot > 0 ? fileName.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : ''
}

const isScope = (value: string): value is MediaScope => value === 'diary' || value === 'tasks'
const MEDIA_ID = /^[A-Za-z0-9_-]{1,80}$/

function folder(name: string): string {
  return join(app.getPath('userData'), 'ledger', name)
}

export interface MediaDeps {
  database: () => Promise<LocalDatabase | null>
  api: () => DiaryMediaApi
}

/** Must run before the app is ready, so the renderer may load media URLs and seek in videos. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }])
}

interface ByteRange { start: number; end: number }

function byteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null
  if (!match || (!match[1] && !match[2])) return null
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end }
}

async function fromDisk(path: string, contentType: string, rangeHeader: string | null): Promise<Response> {
  const { size } = await stat(path)
  const range = byteRange(rangeHeader, size)
  const headers = new Headers({ 'content-type': contentType, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
  if (range === 'unsatisfiable') {
    headers.set('content-range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  headers.set('content-length', String(end - start + 1))
  if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`)
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

const downloads = new Map<string, Promise<string | null>>()

/** Downloads one whole file into the cache. Two screens asking at once share the download. */
function cacheCopy(deps: MediaDeps, scope: MediaScope, mediaId: string): Promise<string | null> {
  const key = `${scope}/${mediaId}`
  const running = downloads.get(key)
  if (running) return running
  const work = (async () => {
    const target = join(folder('media-cache'), scope, mediaId)
    if (await exists(target)) return target
    const api = deps.api()
    const response = await net.fetch(api.mediaUrl(mediaId, scope), { headers: api.authHeaders() })
    if (!response.ok) return null
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length > CACHE_LIMIT) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    await mkdir(join(folder('media-cache'), scope), { recursive: true })
    await writeFile(`${target}.part`, bytes)
    await writeFile(`${target}.type`, response.headers.get('content-type') ?? 'application/octet-stream')
    await rename(`${target}.part`, target)
    return target
  })().catch(() => null).finally(() => downloads.delete(key))
  downloads.set(key, work)
  return work
}

async function cachedType(path: string): Promise<string> {
  return (await readFile(`${path}.type`, 'utf8').catch(() => '')) || 'application/octet-stream'
}

/**
 * `ego-media://diary/<id>` and `ego-media://tasks/<id>`. A file this computer sent is read from
 * disk; anything else comes from the Worker with the device token, which never reaches the page.
 */
export function handleMediaRequests(deps: MediaDeps): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url)
    const scope = url.hostname
    const mediaId = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (!isScope(scope) || !MEDIA_ID.test(mediaId)) return new Response(null, { status: 404 })
    const range = request.headers.get('range')
    const db = await deps.database()
    if (!db) return new Response(null, { status: 401 })
    const local = await db.all<{ local_uri: string; content_type: string }>(
      'SELECT local_uri, content_type FROM diary_uploads WHERE media_id = ?', [mediaId])
    if (local[0] && await exists(local[0].local_uri)) return fromDisk(local[0].local_uri, local[0].content_type, range)
    const cached = join(folder('media-cache'), scope, mediaId)
    if (await exists(cached)) return fromDisk(cached, await cachedType(cached), range)
    if (!range) {
      const copy = await cacheCopy(deps, scope, mediaId)
      if (copy) return fromDisk(copy, await cachedType(copy), null)
    }
    const api = deps.api()
    return net.fetch(api.mediaUrl(mediaId, scope), {
      headers: { ...api.authHeaders(), ...(range ? { range } : {}) }
    })
  })
}

/** Keeps a file that is about to be sent, named by its media ID, so the upload queue can still read it after a restart. */
export async function stageMedia(input: MediaFileInput): Promise<StagedMedia> {
  if (!MEDIA_ID.test(input.mediaId)) throw new Error('Invalid media ID')
  const directory = folder('media')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${input.mediaId}${extensionFor(input.mimeType, input.fileName)}`)
  const bytes = Buffer.from(input.data)
  await writeFile(path, bytes)
  return { localUri: path, size: bytes.length }
}

/** The same for a file already on disk, copied rather than read into memory. */
export async function stageMediaFile(input: MediaPathInput): Promise<StagedMedia> {
  if (!MEDIA_ID.test(input.mediaId)) throw new Error('Invalid media ID')
  const directory = folder('media')
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${input.mediaId}${extensionFor(input.mimeType, input.fileName)}`)
  await copyFile(input.path, path)
  return { localUri: path, size: (await stat(path)).size }
}

/** Files this computer staged and no longer needs, like a photo removed from a draft. */
export async function deleteStagedMedia(paths: readonly string[]): Promise<void> {
  const directory = folder('media')
  for (const path of paths) {
    if (path.startsWith(directory)) await rm(path, { force: true })
  }
}

function safeName(input: MediaOpenInput): string {
  const base = (input.fileName ?? input.mediaId).replace(/[\\/:*?"<>|]/g, '_')
  const extension = extensionFor(input.mimeType, input.fileName)
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

/** Saves the file under its real name and hands it to whichever Windows app opens its type. */
export async function openMedia(deps: MediaDeps, input: MediaOpenInput): Promise<string | null> {
  if (!MEDIA_ID.test(input.mediaId) || !isScope(input.scope)) return 'This file cannot be opened'
  const db = await deps.database()
  const local = db ? await db.all<{ local_uri: string }>('SELECT local_uri FROM diary_uploads WHERE media_id = ?', [input.mediaId]) : []
  let path = local[0] && await exists(local[0].local_uri) ? local[0].local_uri : null
  if (!path) {
    const directory = join(folder('media-open'), input.mediaId)
    path = join(directory, safeName(input))
    if (!await exists(path)) {
      const api = deps.api()
      const response = await net.fetch(api.mediaUrl(input.mediaId, input.scope), { headers: api.authHeaders() })
      if (!response.ok) return 'The file did not download'
      await mkdir(directory, { recursive: true })
      await writeFile(path, Buffer.from(await response.arrayBuffer()))
    }
  }
  const problem = await shell.openPath(path)
  return problem || null
}

const OFFLINE: ApiResult<never> = { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }

async function put<T>(url: string, headers: Record<string, string>, body: Buffer): Promise<ApiResult<T>> {
  try {
    const response = await net.fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) })
    return resultFrom<T>(response.status, await response.text())
  } catch {
    return OFFLINE
  }
}

async function readSlice(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * The phone's upload transport, reading from disk here. Past one request's limit the file goes up
 * in parts, with one part in memory at a time.
 */
export function mediaUploadTransport(api: () => DiaryMediaApi, onProgress: (mediaId: string, share: number | null) => void): UploadTransport {
  return async (upload: PendingUpload): Promise<ApiResult<DiaryMediaInfo>> => {
    if (!await exists(upload.localUri)) {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'This file is no longer on this computer' } }
    }
    const client = api()
    onProgress(upload.mediaId, 0)
    try {
      if (upload.size <= DIARY_SINGLE_UPLOAD_LIMIT) {
        return await put<DiaryMediaInfo>(client.mediaUrl(upload.mediaId, upload.scope),
          { ...client.authHeaders(), 'content-type': upload.contentType }, await readFile(upload.localUri))
      }
      const start = await client.mediaMultipartStart(upload.mediaId, upload.contentType, upload.scope)
      if (!start.ok) return start
      if (start.data.media) return { ok: true, data: start.data.media }
      const uploadId = start.data.uploadId
      if (!uploadId) return { ok: false, error: { code: 'SERVER_ERROR', message: 'The server did not start the upload' } }
      const parts: DiaryMultipartPart[] = []
      const count = Math.ceil(upload.size / DIARY_PART_SIZE)
      for (let number = 1; number <= count; number += 1) {
        const offset = (number - 1) * DIARY_PART_SIZE
        const chunk = await readSlice(upload.localUri, offset, Math.min(DIARY_PART_SIZE, upload.size - offset))
        const result = await put<DiaryMultipartPart>(client.mediaPartUrl(upload.mediaId, uploadId, number, upload.scope),
          { ...client.authHeaders(), 'content-type': 'application/octet-stream' }, chunk)
        if (!result.ok) return result
        parts.push(result.data)
        onProgress(upload.mediaId, (offset + chunk.length) / upload.size)
      }
      return await client.mediaMultipartComplete(upload.mediaId, uploadId, parts, upload.scope)
    } finally {
      onProgress(upload.mediaId, null)
    }
  }
}
