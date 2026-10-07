import {
  DIARY_PART_SIZE, DIARY_SINGLE_UPLOAD_LIMIT,
  type ApiResult, type DiaryMediaInfo, type DiaryMultipartPart
} from '@ego/api-contracts'
import { resultFrom, type DiaryMediaApi } from '@ego/local/api-client'
import type { LocalDatabase } from '@ego/local/database/types'
import type { PendingUpload, UploadTransport } from '@ego/local/diary/uploads'
import type { MediaFileInput, MediaOpenInput, StagedMedia } from '@ego/ui/platform/local'
import { MEDIA_ID, extensionFor, isMediaScope } from '@ego/ui/platform/media-files'
import { MEDIA_CACHE, type MediaAnswer, type MediaQuestion } from './media-protocol'

const OPFS_FOLDER = 'ego-media'
const FILE_NAME = /^[A-Za-z0-9_-]{1,80}(\.[a-z0-9]{1,10})?$/
/** Tab-only sign-ins keep staged files here, so nothing outlives the tab. */
const memory = new Map<string, Blob>()

async function folder(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(OPFS_FOLDER, { create: true })
}

function canKeepFiles(): boolean {
  return typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype
}

function stagedName(localUri: string): { where: 'opfs' | 'memory'; name: string } | null {
  const match = /^(opfs|memory):(.+)$/.exec(localUri)
  if (!match || !FILE_NAME.test(match[2])) return null
  return { where: match[1] === 'opfs' ? 'opfs' : 'memory', name: match[2] }
}

/**
 * Keeps a file that is about to be sent, named by its media ID, so the upload queue can still read
 * it after a reload. A browser that keeps its copy writes it to private storage; a tab-only one, to memory.
 */
export async function stageMedia(input: MediaFileInput, keep: boolean): Promise<StagedMedia> {
  if (!MEDIA_ID.test(input.mediaId)) throw new Error('Invalid media ID')
  const name = `${input.mediaId}${extensionFor(input.mimeType, input.fileName)}`
  const blob = new Blob([input.data], { type: input.mimeType })
  if (keep && canKeepFiles()) {
    const handle = await (await folder()).getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return { localUri: `opfs:${name}`, size: blob.size }
  }
  memory.set(name, blob)
  return { localUri: `memory:${name}`, size: blob.size }
}

export async function readStaged(localUri: string): Promise<Blob | null> {
  const staged = stagedName(localUri)
  if (!staged) return null
  if (staged.where === 'memory') return memory.get(staged.name) ?? null
  try {
    return await (await (await folder()).getFileHandle(staged.name)).getFile()
  } catch {
    return null
  }
}

export async function deleteStaged(paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const staged = stagedName(path)
    if (!staged) continue
    if (staged.where === 'memory') memory.delete(staged.name)
    else await (await folder()).removeEntry(staged.name).catch(() => undefined)
  }
}

/** Sign-out: staged files, the downloaded-file cache, and anything held in memory. */
export async function eraseMedia(): Promise<void> {
  memory.clear()
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(OPFS_FOLDER, { recursive: true }).catch(() => undefined)
  await caches.delete(MEDIA_CACHE).catch(() => false)
}

async function stagedCopy(db: LocalDatabase | null, mediaId: string): Promise<{ blob: Blob; contentType: string } | null> {
  if (!db) return null
  const rows = await db.all<{ local_uri: string; content_type: string }>(
    'SELECT local_uri, content_type FROM diary_uploads WHERE media_id = ?', [mediaId])
  const sent = rows[0]
  const blob = sent ? await readStaged(sent.local_uri) : null
  return blob && sent ? { blob, contentType: sent.content_type } : null
}

/**
 * What the service worker should hand an `<img>` or `<video>` asking for `/media/<scope>/<id>`:
 * this browser's own copy of a file it sent, or the Worker's with this tab's token attached.
 */
export async function answerMedia(
  question: MediaQuestion, db: LocalDatabase | null, api: DiaryMediaApi | null, keep: boolean
): Promise<MediaAnswer> {
  if (!isMediaScope(question.scope) || !MEDIA_ID.test(question.mediaId) || !api) return { kind: 'missing' }
  const staged = await stagedCopy(db, question.mediaId).catch(() => null)
  if (staged) return { kind: 'file', blob: staged.blob, contentType: staged.contentType }
  return { kind: 'remote', url: api.mediaUrl(question.mediaId, question.scope), headers: api.authHeaders(), keep }
}

const VIEWABLE = /^(image|video|audio|text)\/|^application\/pdf$/

function safeName(input: MediaOpenInput): string {
  const base = (input.fileName ?? input.mediaId).replace(/[\\/:*?"<>|]/g, '_')
  const extension = extensionFor(input.mimeType, input.fileName)
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

/** Opens a file the browser can show in a new tab and downloads anything else under its real name. */
export async function openMedia(input: MediaOpenInput, db: LocalDatabase | null, api: DiaryMediaApi | null): Promise<string | null> {
  if (!MEDIA_ID.test(input.mediaId) || !isMediaScope(input.scope)) return 'This file cannot be opened'
  let blob = (await stagedCopy(db, input.mediaId).catch(() => null))?.blob ?? null
  if (!blob) {
    if (!api) return 'Sign in to open this file'
    try {
      const response = await fetch(api.mediaUrl(input.mediaId, input.scope), { headers: api.authHeaders() })
      if (!response.ok) return 'The file did not download'
      blob = await response.blob()
    } catch {
      return 'The file did not download'
    }
  }
  const typed = blob.type ? blob : new Blob([blob], { type: input.mimeType })
  const url = URL.createObjectURL(typed)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  if (VIEWABLE.test(typed.type) && window.open(url, '_blank', 'noopener')) return null
  const link = document.createElement('a')
  link.href = url
  link.download = safeName(input)
  link.click()
  return null
}

const OFFLINE: ApiResult<never> = { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }

/** Gives a slow connection time to finish: at least a minute, plus a second for every 100 KB. */
const uploadTimeout = (bytes: number): number => Math.max(60000, bytes / 100)

async function put<T>(url: string, headers: Record<string, string>, body: Blob): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { method: 'PUT', headers, body, signal: AbortSignal.timeout(uploadTimeout(body.size)) })
    return resultFrom<T>(response.status, await response.text())
  } catch {
    return OFFLINE
  }
}

async function send(
  client: DiaryMediaApi, upload: PendingUpload, file: Blob, onProgress: (mediaId: string, share: number | null) => void
): Promise<ApiResult<DiaryMediaInfo>> {
  if (upload.size <= DIARY_SINGLE_UPLOAD_LIMIT) {
    return put<DiaryMediaInfo>(client.mediaUrl(upload.mediaId, upload.scope),
      { ...client.authHeaders(), 'content-type': upload.contentType }, file)
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
    const chunk = file.slice(offset, Math.min(offset + DIARY_PART_SIZE, upload.size))
    const result = await put<DiaryMultipartPart>(client.mediaPartUrl(upload.mediaId, uploadId, number, upload.scope),
      { ...client.authHeaders(), 'content-type': 'application/octet-stream' }, chunk)
    if (!result.ok) return result
    parts.push(result.data)
    onProgress(upload.mediaId, (offset + chunk.size) / upload.size)
  }
  return client.mediaMultipartComplete(upload.mediaId, uploadId, parts, upload.scope)
}

/** The desktop's upload transport, reading staged files from browser storage instead of disk. */
export function mediaUploadTransport(client: DiaryMediaApi, onProgress: (mediaId: string, share: number | null) => void): UploadTransport {
  return async (upload: PendingUpload): Promise<ApiResult<DiaryMediaInfo>> => {
    const file = await readStaged(upload.localUri)
    if (!file) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'This file is no longer in this browser' } }
    onProgress(upload.mediaId, 0)
    try {
      return await send(client, upload, file, onProgress)
    } catch {
      return { ok: false, error: { code: 'INVALID_REQUEST', message: 'This file could not be read' } }
    } finally {
      onProgress(upload.mediaId, null)
    }
  }
}
