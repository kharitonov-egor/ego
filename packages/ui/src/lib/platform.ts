import type { MediaScope } from '@ego/api-contracts'

export function isWeb(): boolean {
  return window.api?.platform === 'web'
}

/**
 * What an `<img>` or `<video>` loads. The desktop's main process answers `ego-media://` from disk or
 * the Worker; in a browser the service worker answers `/media/` the same way.
 */
export function mediaUrl(mediaId: string, scope: MediaScope = 'diary'): string {
  const id = encodeURIComponent(mediaId)
  return isWeb() ? `/media/${scope}/${id}` : `ego-media://${scope}/${id}`
}
