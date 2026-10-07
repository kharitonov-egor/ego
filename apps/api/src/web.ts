import { WEB_SIGN_IN_PATH } from '@ego/api-contracts'
import type { Env } from './auth'

export function webOrigins(env: Pick<Env, 'WEB_ORIGINS'>): Set<string> {
  const origins = new Set<string>()
  for (const entry of (env.WEB_ORIGINS ?? '').split(/[\s,]+/)) {
    try {
      const url = new URL(entry.trim())
      if (url.protocol === 'https:' || url.hostname === 'localhost') origins.add(url.origin)
    } catch {
      // A blank or malformed entry allows nothing.
    }
  }
  return origins
}

/** The browser's `<origin>/auth`, or null when that origin is not one of `WEB_ORIGINS`. */
export function webSignInReturn(env: Pick<Env, 'WEB_ORIGINS'>, value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.pathname !== WEB_SIGN_IN_PATH || url.search || url.hash || url.username || url.password) return null
  return webOrigins(env).has(url.origin) ? `${url.origin}${WEB_SIGN_IN_PATH}` : null
}

/**
 * Google sends Health and Calendar consent back here. A browser device returns to its own page
 * with the same `connected` or `error` values the apps read from their `ego://` link.
 */
export async function connectReturn(env: Env, deviceId: string, appLink: string, route: string): Promise<string> {
  const row = await env.DB.prepare('SELECT web_origin FROM devices WHERE id = ?')
    .bind(deviceId).first<{ web_origin: string | null }>()
  const origin = row?.web_origin
  return origin && webOrigins(env).has(origin) ? `${origin}${route}` : appLink
}

const ALLOWED_HEADERS = 'authorization, content-type, range'
const EXPOSED_HEADERS = 'content-length, content-range, content-type, accept-ranges'

function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('origin')
  return origin && webOrigins(env).has(origin) ? origin : null
}

/** The browser's preflight. Only the web app's own origins get a yes. */
export function preflight(request: Request, env: Env): Response | null {
  if (request.method !== 'OPTIONS') return null
  const origin = allowedOrigin(request, env)
  if (!origin) return new Response(null, { status: 403 })
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET, POST, PUT, DELETE',
      'access-control-allow-headers': ALLOWED_HEADERS,
      'access-control-max-age': '86400',
      vary: 'origin'
    }
  })
}

/** Copies the response with CORS headers, keeping a streamed body streaming. */
export function withCors(request: Request, env: Env, response: Response): Response {
  const origin = allowedOrigin(request, env)
  if (!origin || response.status === 101) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('access-control-expose-headers', EXPOSED_HEADERS)
  headers.append('vary', 'origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
