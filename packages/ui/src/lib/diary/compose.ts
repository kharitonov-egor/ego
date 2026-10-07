import type { DiaryAttachment, DiaryAttachmentKind } from '@ego/core'
import type { QueuedUpload } from '@ego/local/diary/uploads'
import { newId } from '@ego/local/sync/commands'
import type { StagedMedia } from '../../../shared/local'

/** Something picked, pasted, dropped, or recorded in the composer, not yet copied or queued. */
export interface DraftFile {
  key: string
  /** The bytes, for a pasted image or a recording, which have no file on disk. */
  blob: Blob
  /** Where a picked or dropped file is on disk, so a big video is copied by name. Empty when there is none. */
  path: string
  /** An object URL for the thumbnail, and for the bubble until the upload is recorded. */
  uri: string
  kind: DiaryAttachmentKind
  mimeType: string
  fileName: string | null
  size: number | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  waveform: number[] | null
}

/** Photos above this edge get a smaller copy for the chat. The original stays for the viewer. */
const PREVIEW_EDGE = 1280
const PREVIEW_OVER_BYTES = 1500000

export function kindForMime(mimeType: string): DiaryAttachmentKind {
  if (mimeType.startsWith('image/')) return 'photo'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

function pathOf(file: File): string {
  try {
    return window.api.pathForFile(file)
  } catch {
    return ''
  }
}

/** The files in a drop or a paste. A dropped folder has no bytes to send, so it is left out. */
export function filesFrom(transfer: DataTransfer): File[] {
  const files: File[] = []
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== 'file' || item.webkitGetAsEntry()?.isDirectory) continue
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

/** Images still show as images; everything else keeps its type. */
export function draftsFromFiles(files: readonly File[]): DraftFile[] {
  return files.map((file) => {
    const mimeType = file.type || 'application/octet-stream'
    return {
      key: newId(),
      blob: file,
      path: pathOf(file),
      uri: URL.createObjectURL(file),
      kind: kindForMime(mimeType),
      mimeType,
      fileName: file.name || null,
      size: file.size,
      width: null,
      height: null,
      durationSeconds: null,
      waveform: null
    }
  })
}

export function voiceDraft(blob: Blob, mimeType: string, durationSeconds: number, waveform: number[]): DraftFile {
  return {
    key: newId(), blob, path: '', uri: URL.createObjectURL(blob), kind: 'voice', mimeType, fileName: null,
    size: blob.size, width: null, height: null, durationSeconds, waveform
  }
}

/** Frees a draft's thumbnail once it is removed rather than sent. */
export function discardDraft(draft: DraftFile): void {
  URL.revokeObjectURL(draft.uri)
}

export interface PersistedDraft {
  attachment: DiaryAttachment
  uploads: Array<Omit<QueuedUpload, 'messageId'>>
  /** Object URLs the chat shows for these media IDs until the files come back through `ego-media`. */
  shown: Array<[string, string]>
}

/** A file on disk is copied by the main process; only pasted images and recordings cross over as bytes. */
async function copyIn(mediaId: string, blob: Blob, path: string, mimeType: string, fileName: string | null): Promise<StagedMedia> {
  if (path) return window.api.mediaStageFile({ mediaId, path, fileName, mimeType })
  return window.api.mediaStage({ mediaId, fileName, mimeType, data: await blob.arrayBuffer() })
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

function drawn(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null {
  const scale = Math.min(1, PREVIEW_EDGE / Math.max(width, height, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

interface Preview {
  blob: Blob
  width: number
  height: number
}

/** Scales down past the edge, and otherwise only re-encodes, which is what a heavy PNG needs. */
async function photoPreview(bitmap: ImageBitmap): Promise<Preview | null> {
  const canvas = drawn(bitmap, bitmap.width, bitmap.height)
  const blob = canvas ? await canvasBlob(canvas, 0.8) : null
  return blob && canvas ? { blob, width: canvas.width, height: canvas.height } : null
}

/** A frame half a second in, plus the size and length, read by the window's own video element. */
function videoPoster(uri: string): Promise<(Preview & { duration: number | null }) | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    let settled = false
    const finish = (value: (Preview & { duration: number | null }) | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), 8000)
    video.muted = true
    video.preload = 'auto'
    video.onerror = () => finish(null)
    video.onloadeddata = () => {
      video.currentTime = Number.isFinite(video.duration) ? Math.min(0.5, video.duration / 2) : 0.5
    }
    video.onseeked = () => {
      const canvas = drawn(video, video.videoWidth, video.videoHeight)
      const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : null
      if (!canvas) {
        finish(null)
        return
      }
      void canvasBlob(canvas, 0.7).then((blob) => finish(blob
        ? { blob, width: video.videoWidth, height: video.videoHeight, duration }
        : null))
    }
    video.src = uri
  })
}

/**
 * Copies a draft into the main process's media folder and builds the smaller image the chat
 * shows for it. Both are queued for upload; the message waits for them.
 */
export async function persistDraft(draft: DraftFile): Promise<PersistedDraft> {
  const mediaId = newId()
  const copy = await copyIn(mediaId, draft.blob, draft.path, draft.mimeType, draft.fileName)
  const uploads: PersistedDraft['uploads'] = [{ mediaId, localUri: copy.localUri, contentType: draft.mimeType, size: copy.size }]
  const shown: PersistedDraft['shown'] = [[mediaId, draft.uri]]
  const attachment: DiaryAttachment = {
    mediaId, kind: draft.kind, mimeType: draft.mimeType, fileName: draft.fileName, size: copy.size,
    width: draft.width, height: draft.height, durationSeconds: draft.durationSeconds,
    title: null, performer: null, emoji: null, previewId: null, waveform: draft.waveform
  }

  let preview: Preview | null = null
  if (draft.kind === 'photo') {
    const bitmap = await createImageBitmap(draft.blob).catch(() => null)
    if (bitmap) {
      attachment.width = bitmap.width
      attachment.height = bitmap.height
      if (draft.mimeType !== 'image/gif' && (Math.max(bitmap.width, bitmap.height) > PREVIEW_EDGE || copy.size > PREVIEW_OVER_BYTES)) {
        preview = await photoPreview(bitmap)
      }
      bitmap.close()
    }
  } else if (draft.kind === 'video') {
    const poster = await videoPoster(draft.uri)
    if (poster) {
      preview = poster
      attachment.width = poster.width
      attachment.height = poster.height
      attachment.durationSeconds = attachment.durationSeconds ?? poster.duration
    }
  }
  const previewId = newId()
  const previewCopy = preview
    ? await preview.blob.arrayBuffer()
      .then((data) => window.api.mediaStage({ mediaId: previewId, fileName: null, mimeType: 'image/jpeg', data }))
      .catch(() => null)
    : null
  if (preview && previewCopy) {
    attachment.previewId = previewId
    uploads.unshift({ mediaId: previewId, localUri: previewCopy.localUri, contentType: 'image/jpeg', size: previewCopy.size })
    shown.push([previewId, URL.createObjectURL(preview.blob)])
  }
  return { attachment, uploads, shown }
}
