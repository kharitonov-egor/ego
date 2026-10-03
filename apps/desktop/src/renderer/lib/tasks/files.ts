import type { TaskAttachment, TaskAttachmentKind } from '@ego/core'
import type { QueuedUpload } from '@ego/local/diary/uploads'
import { newId } from '@ego/local/sync/commands'
import type { StagedMedia } from '../../../shared/local'

/** Photos above this edge get a smaller copy for the board. The original stays for the viewer. */
const PREVIEW_EDGE = 1280
const PREVIEW_OVER_BYTES = 1500000
const POSTER_TIMEOUT_MS = 10000

export function kindForMime(mimeType: string): TaskAttachmentKind {
  if (mimeType.startsWith('image/')) return 'photo'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

export interface PersistedFile {
  attachment: Omit<TaskAttachment, 'id' | 'addedAt'>
  uploads: Array<Omit<QueuedUpload, 'messageId'>>
}

interface Picture {
  width: number
  height: number
  durationSeconds: number | null
  preview: Blob | null
}

function fit(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function jpeg(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const size = fit(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) return Promise.resolve(null)
  context.drawImage(source, 0, 0, size.width, size.height)
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
}

/** Scales down past the edge, and otherwise only re-encodes, which is what a heavy PNG needs. */
async function photo(file: File): Promise<Picture | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }
  try {
    const { width, height } = bitmap
    const heavy = file.type !== 'image/gif' && (Math.max(width, height) > PREVIEW_EDGE || file.size > PREVIEW_OVER_BYTES)
    return { width, height, durationSeconds: null, preview: heavy ? await jpeg(bitmap, width, height).catch(() => null) : null }
  } finally {
    bitmap.close()
  }
}

/** The frame half a second in, which is what the phone's thumbnailer takes. */
function video(file: File): Promise<Picture | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const element = document.createElement('video')
    let settled = false
    const done = (value: Picture | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      element.removeAttribute('src')
      element.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), POSTER_TIMEOUT_MS)
    element.muted = true
    element.preload = 'auto'
    element.onloadedmetadata = () => { element.currentTime = Math.min(0.5, (element.duration || 0) / 2) }
    element.onseeked = () => {
      const width = element.videoWidth
      const height = element.videoHeight
      if (!width || !height) {
        done(null)
        return
      }
      const durationSeconds = Number.isFinite(element.duration) ? Math.round(element.duration) : null
      void jpeg(element, width, height)
        .catch(() => null)
        .then((preview) => done({ width, height, durationSeconds, preview }))
    }
    element.onerror = () => done(null)
    element.src = url
  })
}

async function stage(file: File, mediaId: string, mimeType: string, fileName: string | null): Promise<StagedMedia> {
  const path = window.api.pathForFile(file)
  if (path) return window.api.mediaStageFile({ mediaId, path, fileName, mimeType })
  return window.api.mediaStage({ mediaId, fileName, mimeType, data: await file.arrayBuffer() })
}

/**
 * Copies a picked, pasted, or dropped file into the main process's media folder and builds the
 * smaller image the board shows for it. Both are queued for upload; the card edit waits for them.
 */
export async function persistFile(file: File): Promise<PersistedFile> {
  const mediaId = newId()
  const mimeType = file.type || 'application/octet-stream'
  const fileName = file.name || null
  const kind = kindForMime(mimeType)
  const copy = await stage(file, mediaId, mimeType, fileName)
  const uploads: PersistedFile['uploads'] = [{ mediaId, localUri: copy.localUri, contentType: mimeType, size: copy.size }]
  const attachment: PersistedFile['attachment'] = {
    mediaId, kind, mimeType, fileName, size: copy.size, width: null, height: null, durationSeconds: null, previewId: null
  }
  const picture = kind === 'photo' ? await photo(file) : kind === 'video' ? await video(file) : null
  if (picture) {
    attachment.width = picture.width
    attachment.height = picture.height
    attachment.durationSeconds = picture.durationSeconds
  }
  if (picture?.preview) {
    const previewId = newId()
    const previewCopy = await window.api.mediaStage({
      mediaId: previewId, fileName: null, mimeType: 'image/jpeg', data: await picture.preview.arrayBuffer()
    })
    attachment.previewId = previewId
    uploads.unshift({ mediaId: previewId, localUri: previewCopy.localUri, contentType: 'image/jpeg', size: previewCopy.size })
  }
  return { attachment, uploads }
}

export function deleteStagedFiles(paths: readonly string[]): void {
  if (paths.length > 0) void window.api.mediaDeleteStaged([...paths]).catch(() => undefined)
}
