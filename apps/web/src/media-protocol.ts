/** What the service worker and the page say to each other about one `/media/` request. */

export const MEDIA_CACHE = 'ego-media'

export interface MediaQuestion {
  type: 'ego-media'
  scope: string
  mediaId: string
}

export type MediaAnswer =
  | { kind: 'file'; blob: Blob; contentType: string }
  /** `keep` lets the service worker cache the whole file; a tab-only sign-in leaves nothing behind. */
  | { kind: 'remote'; url: string; headers: Record<string, string>; keep: boolean }
  | { kind: 'missing' }

export function isMediaQuestion(value: unknown): value is MediaQuestion {
  if (typeof value !== 'object' || value === null) return false
  const question = value as Record<string, unknown>
  return question.type === 'ego-media' && typeof question.scope === 'string' && typeof question.mediaId === 'string'
}
