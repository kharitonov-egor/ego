import { Image } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import { splitImageDataUrl } from '@ego/core'
import { outsideApp } from '../../lib/private-lock'

export interface Attachment {
  base64: string
  mimeType: string
  uri: string
}

/** A null message means the user cancelled, so there is nothing to say. */
export type AttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; message: string | null }

/** Enough for the model to read receipt lines, small enough to send from a phone. */
const RECEIPT_LONG_EDGE = 1800

async function optimize(uri: string, width: number, height: number): Promise<AttachmentResult> {
  try {
    const resize = Math.max(width, height) > RECEIPT_LONG_EDGE
      ? [{ resize: width >= height ? { width: RECEIPT_LONG_EDGE } : { height: RECEIPT_LONG_EDGE } }]
      : []
    const result = await manipulateAsync(uri, resize, { compress: 0.82, format: SaveFormat.JPEG, base64: true })
    if (!result.base64) throw new Error('Image encoding returned no data')
    return { ok: true, attachment: { base64: result.base64, mimeType: 'image/jpeg', uri: result.uri } }
  } catch {
    return { ok: false, message: 'The phone could not read that image. Choose it again.' }
  }
}

function fromAsset(asset: ImagePicker.ImagePickerAsset): Promise<AttachmentResult> {
  return optimize(asset.uri, asset.width, asset.height)
}

export async function fromCamera(): Promise<AttachmentResult> {
  const permission = await outsideApp(() => ImagePicker.requestCameraPermissionsAsync())
  if (!permission.granted) return { ok: false, message: 'Camera access is off. Allow it in system settings to take a photo.' }
  const result = await outsideApp(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }))
  if (result.canceled) return { ok: false, message: null }
  return fromAsset(result.assets[0])
}

export async function fromLibrary(): Promise<AttachmentResult> {
  const permission = await outsideApp(() => ImagePicker.requestMediaLibraryPermissionsAsync())
  if (!permission.granted) return { ok: false, message: 'Photo access is off. Allow it in system settings to choose a receipt.' }
  const result = await outsideApp(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }))
  if (result.canceled) return { ok: false, message: null }
  return fromAsset(result.assets[0])
}

export async function fromClipboard(): Promise<AttachmentResult> {
  const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.85 })
  if (!image) return { ok: false, message: 'There is no image on the clipboard.' }
  if (!splitImageDataUrl(image.data)) return { ok: false, message: 'I could not read the clipboard image. Copy it again and retry.' }
  const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
    Image.getSize(image.data, (width, height) => resolve({ width, height }), () => resolve(null))
  })
  if (!size) return { ok: false, message: 'I could not read the clipboard image. Copy it again and retry.' }
  return optimize(image.data, size.width, size.height)
}
