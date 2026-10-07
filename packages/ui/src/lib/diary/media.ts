import type { MediaScope } from '@ego/api-contracts'
import type { DiaryAttachment } from '@ego/core'
import { mediaUrl } from '../../platform/local'

/**
 * A file this window just sent shows from memory until its upload is recorded; anything else
 * loads through `ego-media://`, which the main process answers from disk, its cache, or the Worker.
 */
export function mediaSource(local: ReadonlyMap<string, string>, mediaId: string, scope: MediaScope = 'diary'): string {
  return local.get(mediaId) ?? mediaUrl(mediaId, scope)
}

/** What opening a file needs to know about it, shared by diary and task attachments. */
export type OpenableFile = Pick<DiaryAttachment, 'mediaId' | 'mimeType' | 'fileName'>

/** Hands the file to whichever Windows app opens its type. Resolves with why it did not open, or null. */
export async function openWithAnotherApp(attachment: OpenableFile, scope: MediaScope = 'diary'): Promise<string | null> {
  if (!attachment.mediaId) return 'This file was never uploaded'
  return window.api.mediaOpen({
    mediaId: attachment.mediaId, scope, fileName: attachment.fileName, mimeType: attachment.mimeType
  })
}

/** Staged copies this computer no longer needs, like the files of a message that did not save. */
export function deleteLocalFiles(paths: readonly string[]): void {
  if (paths.length > 0) void window.api.mediaDeleteStaged([...paths]).catch(() => undefined)
}
