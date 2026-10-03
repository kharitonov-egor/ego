import { splitImageDataUrl } from '@ego/core'

export interface Attachment {
  base64: string
  mimeType: string
  uri: string
}

/** A null message means the user cancelled, so there is nothing to say. */
export type AttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; message: string | null }

/** Enough for the model to read receipt lines, small enough to send quickly. */
const RECEIPT_LONG_EDGE = 1800
const UNREADABLE = 'This computer could not read that image. Choose it again.'

function dataUrlOf(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unreadable')))
    reader.onerror = () => reject(reader.error ?? new Error('Unreadable'))
    reader.readAsDataURL(blob)
  })
}

/** The phone's encoding: the long edge capped, then a JPEG at 0.82. */
async function optimize(bitmap: ImageBitmap): Promise<AttachmentResult> {
  try {
    const scale = Math.min(1, RECEIPT_LONG_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No canvas')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) throw new Error('Image encoding returned no data')
    const encoded = splitImageDataUrl(await dataUrlOf(blob))
    if (!encoded) throw new Error('Image encoding returned no data')
    return { ok: true, attachment: { base64: encoded.base64, mimeType: 'image/jpeg', uri: URL.createObjectURL(blob) } }
  } catch {
    return { ok: false, message: UNREADABLE }
  } finally {
    bitmap.close()
  }
}

/** A receipt picked, pasted, or dropped. */
export async function fromFile(file: File): Promise<AttachmentResult> {
  try {
    return await optimize(await createImageBitmap(file))
  } catch {
    return { ok: false, message: UNREADABLE }
  }
}

/** The first image in a paste or a drop, if there is one. */
export function imageIn(transfer: DataTransfer | null): File | null {
  return Array.from(transfer?.files ?? []).find((file) => file.type.startsWith('image/')) ?? null
}
