import { DOCKET_OPEN_PARAM, DOCKET_OPEN_PATH, DOCKET_OPEN_TARGET, DOCKET_SESSION_PATH } from '@ego/api-contracts'
import type { WebSession } from './session'

/** A private docket that sent this tab to sign in, kept across the round trip to Google. */
const RETURN_KEY = 'ego.docket-return'

/**
 * Asks the Worker, through this site's own `/docket/` proxy, for the cookie that private docket
 * pages check. A page load cannot carry the token kept in storage, so the cookie stands in for it.
 */
export async function refreshDocketCookie(session: WebSession | null): Promise<boolean> {
  if (!session) return false
  try {
    const response = await fetch(DOCKET_SESSION_PATH, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}` },
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10_000)
    })
    return response.ok
  } catch {
    return false
  }
}

/** `/docket/<id>` or `/docket/<id>/v/<n>` when this page is a private docket's "Open in Ego" link. */
export function docketOpenTarget(location: Pick<Location, 'pathname' | 'search'>): string | null {
  if (location.pathname !== DOCKET_OPEN_PATH) return null
  const target = new URLSearchParams(location.search).get(DOCKET_OPEN_PARAM)
  return target && DOCKET_OPEN_TARGET.test(target) ? `/docket/${target}` : null
}

export function rememberDocketReturn(target: string): void {
  sessionStorage.setItem(RETURN_KEY, target)
}

export function takeDocketReturn(): string | null {
  const target = sessionStorage.getItem(RETURN_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  return target && /^\/docket\/[a-z0-9]{10}(?:\/v\/[0-9]+)?$/.test(target) ? target : null
}
