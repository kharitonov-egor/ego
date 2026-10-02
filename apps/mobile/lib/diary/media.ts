import { Platform } from 'react-native'
import { Directory, File, Paths } from 'expo-file-system'
import type { MediaScope } from '@ego/api-contracts'
import type { DiaryAttachment } from '@ego/core'
import type { DiaryMediaApi } from '@ego/local/api-client'
import { outsideApp } from '../private-lock'

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

function directory(name: string, parent: Directory): Directory {
  const folder = new Directory(parent, name)
  if (!folder.exists) folder.create({ intermediates: true })
  return folder
}

/**
 * Files sent from this phone stay in the app's documents, named by media ID. A picked photo lives
 * in a cache the system may clear before the upload finishes, so it is copied here first.
 */
export function localCopyFor(mediaId: string, mimeType: string, fileName: string | null): File {
  return new File(directory('diary-media', Paths.document), `${mediaId}${extensionFor(mimeType, fileName)}`)
}

export function deleteLocalFiles(uris: readonly string[]): void {
  for (const uri of uris) {
    try {
      const file = new File(uri)
      if (file.exists) file.delete()
    } catch {
      // A file that is already gone needs no cleanup.
    }
  }
}

export interface MediaSource {
  uri: string
  headers?: Record<string, string>
}

/** A local copy when this phone has one, otherwise the Worker URL with the device token. */
export function mediaSource(
  api: DiaryMediaApi, local: ReadonlyMap<string, string>, mediaId: string, scope: MediaScope = 'diary'
): MediaSource {
  const copy = local.get(mediaId)
  if (copy) return { uri: copy }
  return { uri: api.mediaUrl(mediaId, scope), headers: api.authHeaders() }
}

/** What opening a file needs to know about it, shared by diary and task attachments. */
export type OpenableFile = Pick<DiaryAttachment, 'mediaId' | 'mimeType' | 'fileName' | 'size'>

/** Animated stickers are Lottie JSON, which the player takes as an object rather than a URL with headers. */
export async function readLottie(api: DiaryMediaApi, local: ReadonlyMap<string, string>, mediaId: string): Promise<object | null> {
  try {
    const source = mediaSource(api, local, mediaId)
    const text = source.headers
      ? await (await fetch(source.uri, { headers: source.headers })).text()
      : await new File(source.uri).text()
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

function safeName(attachment: OpenableFile): string {
  const base = (attachment.fileName ?? attachment.mediaId ?? 'file').replace(/[\\/:*?"<>|]/g, '_')
  const extension = extensionFor(attachment.mimeType, attachment.fileName)
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

/** Downloads a file once into the cache, keeping its real name so the app that opens it shows one. */
export async function fileForOpening(
  api: DiaryMediaApi, local: ReadonlyMap<string, string>, attachment: OpenableFile,
  onProgress?: (share: number) => void, scope: MediaScope = 'diary'
): Promise<File> {
  const mediaId = attachment.mediaId
  if (!mediaId) throw new Error('This file was never uploaded')
  const copy = local.get(mediaId)
  if (copy) return new File(copy)
  const target = new File(directory(mediaId, directory('diary-open', Paths.cache)), safeName(attachment))
  if (target.exists && (attachment.size === null || target.size === attachment.size)) return target
  const source = mediaSource(api, local, mediaId, scope)
  return File.downloadFileAsync(source.uri, target, {
    headers: source.headers,
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (onProgress && totalBytes > 0) onProgress(bytesWritten / totalBytes)
    }
  })
}

const FLAG_GRANT_READ_URI_PERMISSION = 1

/** Hands the file to whichever app on the phone opens its type, the way Telegram opens a PDF. */
export async function openWithAnotherApp(file: File, mimeType: string): Promise<void> {
  if (Platform.OS !== 'android') throw new Error('Opening files in other apps works on Android only')
  const { startActivityAsync } = await import('expo-intent-launcher')
  await outsideApp(() => startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: mimeType
  }))
}
