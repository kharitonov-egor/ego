import { useSyncExternalStore } from 'react'
import type { MediaProgress } from '../../../shared/local'

/** Upload progress by media ID, from 0 to 1, as the main process sends a file during sync. */
const progress = new Map<string, number>()
const listeners = new Set<() => void>()
let unsubscribe: (() => void) | null = null

function report({ mediaId, share }: MediaProgress): void {
  if (share === null) progress.delete(mediaId)
  else progress.set(mediaId, Math.max(0, Math.min(1, share)))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  unsubscribe ??= window.api.onMediaProgress(report)
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    unsubscribe?.()
    unsubscribe = null
    progress.clear()
  }
}

export function useUploadProgress(mediaId: string | null): number | null {
  return useSyncExternalStore(subscribe, () => (mediaId ? progress.get(mediaId) ?? null : null))
}
