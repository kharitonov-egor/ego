import {
  DOCKET_OPEN_PARAM, DOCKET_OPEN_PATH, DOCKET_OPEN_TARGET, DOCKET_PDF_TIMEOUT_MS, DOCKET_SESSION_PATH, docketPdfName
} from '@ego/api-contracts'
import { resultFrom, type EgoApi } from '@ego/local/api-client'
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

/** Fetches the PDF with the token and hands it to the browser as a download named after the docket. */
export async function downloadDocketPdf(api: Pick<EgoApi, 'docketPdfUrl' | 'authHeaders'>, id: string, title: string): Promise<string | null> {
  let response: Response
  try {
    response = await fetch(api.docketPdfUrl(id), { headers: api.authHeaders(), signal: AbortSignal.timeout(DOCKET_PDF_TIMEOUT_MS) })
  } catch {
    return 'The Ego server is unreachable'
  }
  if (!response.ok) {
    const result = resultFrom(response.status, await response.text())
    return result.ok ? 'The PDF did not download' : result.error.message
  }
  const url = URL.createObjectURL(await response.blob())
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  const link = document.createElement('a')
  link.href = url
  link.download = docketPdfName(title)
  link.click()
  return null
}

export function rememberDocketReturn(target: string): void {
  sessionStorage.setItem(RETURN_KEY, target)
}

export function takeDocketReturn(): string | null {
  const target = sessionStorage.getItem(RETURN_KEY)
  sessionStorage.removeItem(RETURN_KEY)
  return target && /^\/docket\/[a-z0-9]{10}(?:\/v\/[0-9]+)?$/.test(target) ? target : null
}
