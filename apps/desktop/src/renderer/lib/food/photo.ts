import type { FoodImage } from '@ego/api-contracts'
import { splitImageDataUrl, type FoodPhoto } from '@ego/core'
import type { QueuedUpload } from '@ego/local/diary/uploads'
import { newId } from '@ego/local/sync/commands'
import { deleteLocalFiles } from '../diary/media'

/** Big enough for the model to read a nutrition label, small enough to send quickly. */
const PHOTO_EDGE = 1600
const PREVIEW_EDGE = 480
const UNREADABLE = 'This computer could not read that photo. Try again.'

export interface PreparedPhoto {
  photo: FoodPhoto
  /** What the model reads. */
  image: FoodImage
  /** Queued against the entry once it saves. */
  uploads: Array<Omit<QueuedUpload, 'messageId'>>
  /** Blob URLs for the two copies, so a draft shows before its files are queued. */
  uri: string
  previewUri: string
}

/** A null message means the user backed out, so there is nothing to say. */
export type PhotoPick = { ok: true; photo: PreparedPhoto } | { ok: false; message: string | null }

export interface Size {
  width: number
  height: number
}

/** The phone's resize: the long edge comes down to `edge` and the other keeps the proportion. A smaller photo stays as it is. */
export function fitWithin(width: number, height: number, edge: number): Size {
  if (Math.max(width, height) <= edge) return { width, height }
  return width >= height
    ? { width: edge, height: Math.max(1, Math.round(height * edge / width)) }
    : { width: Math.max(1, Math.round(width * edge / height)), height: edge }
}

interface Encoded {
  canvas: HTMLCanvasElement
  blob: Blob
}

async function jpeg(source: CanvasImageSource, size: Size, quality: number): Promise<Encoded> {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No canvas')
  // JPEG has no transparency, and a see-through screenshot of a label would otherwise turn black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(source, 0, 0, size.width, size.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('The photo could not be encoded')
  return { canvas, blob }
}

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unreadable')))
    reader.onerror = () => reject(reader.error ?? new Error('Unreadable'))
    reader.readAsDataURL(blob)
  })
}

async function keep(mediaId: string, blob: Blob): Promise<Omit<QueuedUpload, 'messageId'>> {
  const staged = await window.api.mediaStage({ mediaId, fileName: null, mimeType: 'image/jpeg', data: await blob.arrayBuffer() })
  return { mediaId, localUri: staged.localUri, contentType: 'image/jpeg', size: staged.size, scope: 'food' }
}

/**
 * One upload-sized copy and one list-sized copy, both kept in the main process's media folder
 * until they reach R2.
 */
export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file)
  let main: Encoded
  try {
    main = await jpeg(bitmap, fitWithin(bitmap.width, bitmap.height, PHOTO_EDGE), 0.8)
  } finally {
    bitmap.close()
  }
  const small = await jpeg(main.canvas, fitWithin(main.canvas.width, main.canvas.height, PREVIEW_EDGE), 0.7)
  const encoded = splitImageDataUrl(await dataUrlOf(main.blob))
  if (!encoded) throw new Error('The photo could not be read')
  const mediaId = newId()
  const previewId = newId()
  const staged = await Promise.allSettled([keep(previewId, small.blob), keep(mediaId, main.blob)])
  const uploads = staged.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  if (uploads.length < staged.length) {
    deleteLocalFiles(uploads.map((upload) => upload.localUri))
    throw new Error('The photo could not be kept')
  }
  return {
    photo: { mediaId, previewId, width: main.canvas.width, height: main.canvas.height },
    image: { base64: encoded.base64, mimeType: 'image/jpeg' },
    uploads,
    uri: URL.createObjectURL(main.blob),
    previewUri: URL.createObjectURL(small.blob)
  }
}

/** Lets go of the blob URLs once the saved entry shows its photo from the media folder. */
export function releasePhoto(prepared: PreparedPhoto | null): void {
  if (!prepared) return
  URL.revokeObjectURL(prepared.uri)
  URL.revokeObjectURL(prepared.previewUri)
}

export function discardPhoto(prepared: PreparedPhoto | null): void {
  if (!prepared) return
  deleteLocalFiles(prepared.uploads.map((upload) => upload.localUri))
  releasePhoto(prepared)
}

/** A photo pasted, dropped, or picked. */
export async function photoFromFile(file: Blob): Promise<PhotoPick> {
  try {
    return { ok: true, photo: await preparePhoto(file) }
  } catch {
    return { ok: false, message: UNREADABLE }
  }
}

/** The system's file dialog for one image. Resolves with null when it closes without a pick. */
function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

export async function chooseFoodPhoto(): Promise<PhotoPick> {
  const file = await pickImage()
  return file ? photoFromFile(file) : { ok: false, message: null }
}

/** The first image in a paste or a drop, if there is one. */
export function imageIn(transfer: DataTransfer | null): File | null {
  return Array.from(transfer?.files ?? []).find((file) => file.type.startsWith('image/')) ?? null
}
