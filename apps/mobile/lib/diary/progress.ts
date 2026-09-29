import { useSyncExternalStore } from 'react'

/** Upload progress by media ID, from 0 to 1, for the ring drawn over a sending photo. */
const progress = new Map<string, number>()
const listeners = new Set<() => void>()

export function reportUploadProgress(mediaId: string, value: number | null): void {
  if (value === null) progress.delete(mediaId)
  else progress.set(mediaId, Math.max(0, Math.min(1, value)))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUploadProgress(mediaId: string | null): number | null {
  return useSyncExternalStore(subscribe, () => (mediaId ? progress.get(mediaId) ?? null : null))
}
