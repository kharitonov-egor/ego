import { Image } from 'react-native'
import { File } from 'expo-file-system'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import type { ImagePickerAsset } from 'expo-image-picker'
import type { DiaryAttachment, DiaryAttachmentKind } from '@ego/core'
import { newId } from '@ego/local/sync/commands'
import { localCopyFor } from './media'
import type { QueuedUpload } from '@ego/local/diary/uploads'

/** Something picked in the composer, not yet copied or queued. */
export interface DraftFile {
  key: string
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

function draftKey(): string {
  return newId()
}

export function kindForMime(mimeType: string): DiaryAttachmentKind {
  if (mimeType.startsWith('image/')) return 'photo'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

export function draftsFromLibrary(assets: readonly ImagePickerAsset[]): DraftFile[] {
  return assets.map((asset) => {
    const video = asset.type === 'video' || asset.type === 'pairedVideo'
    return {
      key: draftKey(),
      uri: asset.uri,
      kind: video ? 'video' : 'photo',
      mimeType: asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
      fileName: asset.fileName ?? null,
      size: asset.fileSize ?? null,
      width: asset.width || null,
      height: asset.height || null,
      durationSeconds: asset.duration ? Math.round(asset.duration / 1000) : null,
      waveform: null
    }
  })
}

/** Images picked as files still show as images; everything else keeps its type. */
export function draftsFromFiles(files: readonly File[]): DraftFile[] {
  return files.map((file) => {
    const mimeType = file.type || 'application/octet-stream'
    return {
      key: draftKey(),
      uri: file.uri,
      kind: kindForMime(mimeType),
      mimeType,
      fileName: file.name || null,
      size: file.size ?? null,
      width: null,
      height: null,
      durationSeconds: null,
      waveform: null
    }
  })
}

export function voiceDraft(uri: string, durationSeconds: number, waveform: number[]): DraftFile {
  return {
    key: draftKey(), uri, kind: 'voice', mimeType: 'audio/mp4', fileName: null, size: null, width: null, height: null,
    durationSeconds, waveform
  }
}

export interface PersistedDraft {
  attachment: DiaryAttachment
  uploads: Array<Omit<QueuedUpload, 'messageId'>>
}

async function copyIn(uri: string, mediaId: string, mimeType: string, fileName: string | null): Promise<File> {
  const target = localCopyFor(mediaId, mimeType, fileName)
  await new File(uri).copy(target)
  return target
}

function imageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve(null))
  })
}

/** Scales down past the edge, and otherwise only re-encodes, which is what a heavy PNG needs. */
async function photoPreview(source: File, width: number, height: number): Promise<{ uri: string; width: number; height: number } | null> {
  const actions = Math.max(width, height) > PREVIEW_EDGE
    ? [{ resize: width >= height ? { width: PREVIEW_EDGE } : { height: PREVIEW_EDGE } }]
    : []
  try {
    return await manipulateAsync(source.uri, actions, { compress: 0.8, format: SaveFormat.JPEG })
  } catch {
    return null
  }
}

async function videoPoster(source: File): Promise<{ uri: string; width: number; height: number } | null> {
  try {
    const { getThumbnailAsync } = await import('expo-video-thumbnails')
    return await getThumbnailAsync(source.uri, { time: 500, quality: 0.7 })
  } catch {
    return null
  }
}

/**
 * Copies a picked file into the app's documents and builds the smaller image the chat shows for
 * it. Both are queued for upload; the message waits for them.
 */
export async function persistDraft(draft: DraftFile): Promise<PersistedDraft> {
  const mediaId = newId()
  const copy = await copyIn(draft.uri, mediaId, draft.mimeType, draft.fileName)
  const size = copy.size
  const uploads: PersistedDraft['uploads'] = [{ mediaId, localUri: copy.uri, contentType: draft.mimeType, size }]
  const attachment: DiaryAttachment = {
    mediaId, kind: draft.kind, mimeType: draft.mimeType, fileName: draft.fileName, size,
    width: draft.width, height: draft.height, durationSeconds: draft.durationSeconds,
    title: null, performer: null, emoji: null, previewId: null, waveform: draft.waveform
  }

  let preview: { uri: string; width: number; height: number } | null = null
  if (draft.kind === 'photo') {
    if (attachment.width === null || attachment.height === null) {
      const measured = await imageSize(copy.uri)
      attachment.width = measured?.width ?? null
      attachment.height = measured?.height ?? null
    }
    const width = attachment.width ?? 0
    const height = attachment.height ?? 0
    if (draft.mimeType !== 'image/gif' && (Math.max(width, height) > PREVIEW_EDGE || size > PREVIEW_OVER_BYTES)) {
      preview = await photoPreview(copy, width, height)
    }
  } else if (draft.kind === 'video') {
    preview = await videoPoster(copy)
    if (preview && (attachment.width === null || attachment.height === null)) {
      attachment.width = preview.width
      attachment.height = preview.height
    }
  }
  if (preview) {
    const previewId = newId()
    const previewCopy = await copyIn(preview.uri, previewId, 'image/jpeg', null)
    attachment.previewId = previewId
    uploads.unshift({ mediaId: previewId, localUri: previewCopy.uri, contentType: 'image/jpeg', size: previewCopy.size })
  }
  return { attachment, uploads }
}
