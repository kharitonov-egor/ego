import { File } from 'expo-file-system'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import type { FoodImage } from '@ego/api-contracts'
import type { FoodPhoto } from '@ego/core'
import { deleteLocalFiles, localCopyFor } from '../diary/media'
import type { QueuedUpload } from '../diary/uploads'
import { outsideApp } from '../private-lock'
import { newId } from '../sync/commands'

/** Big enough for the model to read a nutrition label, small enough to send from a phone. */
const PHOTO_EDGE = 1600
const PREVIEW_EDGE = 480

export interface PreparedPhoto {
  photo: FoodPhoto
  /** What the model reads. */
  image: FoodImage
  /** Queued against the entry once it saves. */
  uploads: Array<Omit<QueuedUpload, 'messageId'>>
  uri: string
  previewUri: string
}

/** A null message means the user backed out, so there is nothing to say. */
export type PhotoPick = { ok: true; photo: PreparedPhoto } | { ok: false; message: string | null }

function resize(width: number, height: number, edge: number): Array<{ resize: { width: number } | { height: number } }> {
  return Math.max(width, height) > edge ? [{ resize: width >= height ? { width: edge } : { height: edge } }] : []
}

async function keep(uri: string, mediaId: string): Promise<File> {
  const target = localCopyFor(mediaId, 'image/jpeg', null)
  await new File(uri).copy(target)
  return target
}

/** One upload-sized copy and one list-sized copy, both kept in the app's documents until they reach R2. */
export async function preparePhoto(uri: string, width: number, height: number): Promise<PreparedPhoto> {
  const main = await manipulateAsync(uri, resize(width, height, PHOTO_EDGE), { compress: 0.8, format: SaveFormat.JPEG, base64: true })
  if (!main.base64) throw new Error('The photo could not be read')
  const small = await manipulateAsync(main.uri, resize(main.width, main.height, PREVIEW_EDGE), { compress: 0.7, format: SaveFormat.JPEG })
  const mediaId = newId()
  const previewId = newId()
  const [full, preview] = await Promise.all([keep(main.uri, mediaId), keep(small.uri, previewId)])
  return {
    photo: { mediaId, previewId, width: main.width, height: main.height },
    image: { base64: main.base64, mimeType: 'image/jpeg' },
    uploads: [
      { mediaId: previewId, localUri: preview.uri, contentType: 'image/jpeg', size: preview.size, scope: 'food' },
      { mediaId, localUri: full.uri, contentType: 'image/jpeg', size: full.size, scope: 'food' }
    ],
    uri: full.uri,
    previewUri: preview.uri
  }
}

export function discardPhoto(prepared: PreparedPhoto | null): void {
  if (prepared) deleteLocalFiles([prepared.uri, prepared.previewUri])
}

async function fromAsset(asset: ImagePicker.ImagePickerAsset): Promise<PhotoPick> {
  try {
    return { ok: true, photo: await preparePhoto(asset.uri, asset.width, asset.height) }
  } catch {
    return { ok: false, message: 'The phone could not read that photo. Try again.' }
  }
}

export async function takeFoodPhoto(): Promise<PhotoPick> {
  const permission = await outsideApp(() => ImagePicker.requestCameraPermissionsAsync())
  if (!permission.granted) return { ok: false, message: 'Camera access is off. Allow it in system settings to take a photo.' }
  const result = await outsideApp(() => ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }))
  if (result.canceled) return { ok: false, message: null }
  return fromAsset(result.assets[0])
}

export async function chooseFoodPhoto(): Promise<PhotoPick> {
  const permission = await outsideApp(() => ImagePicker.requestMediaLibraryPermissionsAsync())
  if (!permission.granted) return { ok: false, message: 'Photo access is off. Allow it in system settings to choose a photo.' }
  const result = await outsideApp(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }))
  if (result.canceled) return { ok: false, message: null }
  return fromAsset(result.assets[0])
}
