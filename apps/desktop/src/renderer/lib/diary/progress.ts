import { useSyncExternalStore } from 'react'

/** Upload progress by media ID, from 0 to 1, for the ring drawn over a sending photo. */
const progress = new Map<string, number>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function reportUploadProgress(mediaId: string, value: number | null): void {
  if (value === null) progress.delete(mediaId)
  else progress.set(mediaId, Math.max(0, Math.min(1, value)))
  notify()
}

/**
 * The main process sends the files and reports how far each has gone. A screen follows it while
 * it is open; what it missed while closed is dropped, so no ring is left stuck halfway.
 */
export function followUploadProgress(): () => void {
  const unsubscribe = window.api.onMediaProgress(({ mediaId, share }) => reportUploadProgress(mediaId, share))
  return () => {
    unsubscribe()
    progress.clear()
    notify()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUploadProgress(mediaId: string | null): number | null {
  return useSyncExternalStore(subscribe, () => (mediaId ? progress.get(mediaId) ?? null : null))
}
