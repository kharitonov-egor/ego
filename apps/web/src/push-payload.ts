// Only sw.ts may import this file. The build then inlines it into sw.js, which loads as a classic
// script; a second importer would split it into a chunk that sw.js cannot import.

export const AGENT_ROUTE = '/ai?chat=agent'
const PLACEHOLDER_ORIGIN = 'https://ego.invalid'

export interface PushPayload {
  title: string
  body: string
  route: string
  tag: string
  urgent: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** A path on this site. The URL parser drops tabs and reads backslashes as slashes, so this asks it rather than a pattern. */
export function safeRoute(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return AGENT_ROUTE
  try {
    const url = new URL(value, PLACEHOLDER_ORIGIN)
    return url.origin === PLACEHOLDER_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : AGENT_ROUTE
  } catch {
    return AGENT_ROUTE
  }
}

/** The Worker sends `{ title, body, route, tag, urgent }`. Anything unreadable still shows a notification, as Web Push requires. */
export function parsePushPayload(text: string | null | undefined): PushPayload {
  let value: unknown = null
  try {
    value = JSON.parse(text ?? '')
  } catch {
    value = null
  }
  const payload = isRecord(value) ? value : {}
  return {
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Ego',
    body: typeof payload.body === 'string' ? payload.body : 'Your agent posted a message.',
    route: safeRoute(payload.route),
    tag: typeof payload.tag === 'string' ? payload.tag : '',
    urgent: payload.urgent === true
  }
}

/** The route a clicked notification stored in its `data`. */
export function clickedRoute(data: unknown): string {
  return safeRoute(isRecord(data) ? data.route : undefined)
}
