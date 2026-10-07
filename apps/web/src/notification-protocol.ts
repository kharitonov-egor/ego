/**
 * After a notification click, the service worker asks every open tab to show the page. Only the tab
 * running Ego answers true, since only one tab holds the database.
 */
export interface OpenRequest {
  type: 'ego-open'
  route: string
}

export function isOpenRequest(value: unknown): value is OpenRequest {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Record<string, unknown>
  return request.type === 'ego-open' && typeof request.route === 'string'
}
