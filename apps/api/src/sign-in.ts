import {
  BROWSER_IDLE_DAYS, SIGN_IN_RETURN_URL, TAB_IDLE_DAYS,
  type DeviceIdentity,
  type SessionInfo,
  type SignInResult,
  type SignInStartResult
} from '@ego/api-contracts'
import { currentDataset, hashToken, type Env } from './auth'
import { fromBase64, randomUrlToken, sha256 } from './connector-crypto'
import { connectorStatus, googleCallbackUrl } from './connectors'
import { healthConnected } from './health'
import { webSignInReturn } from './web'

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])
const SIGN_IN_TTL_MS = 10 * 60_000
const MAX_SIGN_IN_STARTS_PER_MINUTE = 10

type SignInError = 'cancelled' | 'expired' | 'not_allowed' | 'failed'

interface SignInRow {
  state_hash: string
  exchange_secret_hash: string
  google_verifier: string
  device_name: string
  callback_at: string | null
  code_hash: string | null
  account_email: string | null
  expires_at: string
  consumed_at: string | null
  return_url: string | null
  idle_days: number | null
}

interface IdTokenClaims {
  iss?: unknown
  aud?: unknown
  exp?: unknown
  email?: unknown
  email_verified?: unknown
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status)
}

function returnToApp(returnUrl: string | null, params: { code: string } | { error: SignInError }): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `${returnUrl ?? SIGN_IN_RETURN_URL}?${new URLSearchParams(params)}`, 'cache-control': 'no-store' }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { return null }
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function allowedEmails(env: Pick<Env, 'ALLOWED_EMAILS'>): Set<string> {
  return new Set((env.ALLOWED_EMAILS ?? '').split(/[\s,]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))
}

export function signInConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && allowedEmails(env).size > 0)
}

function deviceNameFrom(value: unknown): string {
  if (typeof value !== 'string') return 'Phone'
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Phone'
}

export function idTokenClaims(idToken: string): IdTokenClaims | null {
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(new TextDecoder().decode(fromBase64(payload)))
    return isRecord(claims) ? claims : null
  } catch {
    return null
  }
}

/**
 * The ID token comes straight from Google's token endpoint over TLS, which OpenID Connect accepts
 * in place of a signature check. The audience, issuer, expiry, and verified flag are still checked.
 */
async function verifiedGoogleEmail(
  code: string, verifier: string, redirectUri: string, env: Env, now: Date
): Promise<string | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET
      })
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let token: unknown
  try { token = await response.json() } catch { return null }
  if (!isRecord(token) || typeof token.id_token !== 'string') return null
  const claims = idTokenClaims(token.id_token)
  if (!claims || typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) return null
  if (claims.aud !== env.GOOGLE_CLIENT_ID) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) return null
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null
  return typeof claims.email === 'string' ? claims.email.toLowerCase() : null
}

export async function startSignIn(request: Request, env: Env, now = new Date()): Promise<Response> {
  if (!signInConfigured(env) || !env.GOOGLE_CLIENT_ID) {
    return failure(503, 'NOT_CONFIGURED', 'Google sign-in is not set up on the server')
  }
  const body = await readJson(request)
  const askedReturn = isRecord(body) ? body.returnUrl : undefined
  const returnUrl = askedReturn === undefined ? null : webSignInReturn(env, askedReturn)
  if (askedReturn !== undefined && !returnUrl) {
    return failure(400, 'INVALID_REQUEST', 'This web address may not sign in to Ego')
  }
  const idleDays = returnUrl ? (isRecord(body) && body.remember === false ? TAB_IDLE_DAYS : BROWSER_IDLE_DAYS) : null
  const nowIso = now.toISOString()
  await env.DB.prepare('DELETE FROM sign_in_requests WHERE expires_at <= ?').bind(nowIso).run()
  const minuteAgo = new Date(now.getTime() - 60_000).toISOString()
  const client = await sha256(request.headers.get('cf-connecting-ip') ?? 'unknown')
  const recent = await env.DB.prepare('SELECT COUNT(*) AS count FROM sign_in_requests WHERE client_hash = ? AND created_at >= ?')
    .bind(client, minuteAgo).first<{ count: number }>()
  if ((recent?.count ?? 0) >= MAX_SIGN_IN_STARTS_PER_MINUTE) {
    return failure(429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and try again.')
  }
  const state = randomUrlToken()
  const verifier = randomUrlToken(48)
  const exchangeSecret = randomUrlToken()
  const expiresAt = new Date(now.getTime() + SIGN_IN_TTL_MS).toISOString()
  await env.DB.prepare(`INSERT INTO sign_in_requests
    (state_hash, exchange_secret_hash, google_verifier, device_name, client_hash, expires_at, created_at, return_url, idle_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), await sha256(exchangeSecret), verifier,
      deviceNameFrom(isRecord(body) ? body.deviceName : undefined), client, expiresAt, nowIso, returnUrl, idleDays)
    .run()
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleCallbackUrl(request, env),
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  })
  const data: SignInStartResult = { authorizationUrl: `${GOOGLE_AUTHORIZE}?${params}`, exchangeSecret, expiresAt }
  return json({ ok: true, data })
}

/**
 * Sign-in shares the connector's Google redirect URI, so no Google Cloud change is needed.
 * Returns null when the state belongs to a Gmail and Drive connection instead.
 */
export async function completeSignIn(request: Request, env: Env, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  if (!state) return null
  const stateHash = await sha256(state)
  const row = await env.DB.prepare('SELECT * FROM sign_in_requests WHERE state_hash = ?')
    .bind(stateHash).first<SignInRow>()
  if (!row) return null
  const nowIso = now.toISOString()
  const claimed = await env.DB.prepare(`UPDATE sign_in_requests SET callback_at = ?
    WHERE state_hash = ? AND callback_at IS NULL AND expires_at > ?`).bind(nowIso, stateHash, nowIso).run()
  const back = row.return_url
  if ((claimed.meta.changes ?? 0) !== 1) return returnToApp(back, { error: 'expired' })
  const code = url.searchParams.get('code')
  if (url.searchParams.has('error') || !code) return returnToApp(back, { error: 'cancelled' })
  const email = await verifiedGoogleEmail(code, row.google_verifier, googleCallbackUrl(request, env), env, now)
  if (!email) return returnToApp(back, { error: 'failed' })
  if (!allowedEmails(env).has(email)) return returnToApp(back, { error: 'not_allowed' })
  const appCode = randomUrlToken()
  await env.DB.prepare('UPDATE sign_in_requests SET code_hash = ?, account_email = ? WHERE state_hash = ?')
    .bind(await sha256(appCode), email, stateHash).run()
  return returnToApp(back, { code: appCode })
}

export async function exchangeSignIn(request: Request, env: Env, now = new Date()): Promise<Response> {
  const body = await readJson(request)
  if (!isRecord(body) || typeof body.code !== 'string' || typeof body.exchangeSecret !== 'string' ||
      !body.code || !body.exchangeSecret || body.code.length > 200 || body.exchangeSecret.length > 200) {
    return failure(400, 'INVALID_REQUEST', 'The sign-in response was incomplete')
  }
  const expired = failure(401, 'AUTH_REQUIRED', 'This sign-in expired. Start again from Settings.')
  const nowIso = now.toISOString()
  const row = await env.DB.prepare('SELECT * FROM sign_in_requests WHERE code_hash = ?')
    .bind(await sha256(body.code)).first<SignInRow>()
  if (!row?.account_email || row.consumed_at || row.expires_at <= nowIso) return expired
  if (row.exchange_secret_hash !== await sha256(body.exchangeSecret)) return expired
  if (!allowedEmails(env).has(row.account_email)) return expired
  const claimed = await env.DB.prepare(`UPDATE sign_in_requests SET consumed_at = ?
    WHERE state_hash = ? AND consumed_at IS NULL`).bind(nowIso, row.state_hash).run()
  if ((claimed.meta.changes ?? 0) !== 1) return expired
  const token = randomUrlToken(36)
  const deviceId = `device-${randomHex(6)}`
  const webOrigin = row.return_url ? new URL(row.return_url).origin : null
  await env.DB.prepare(`INSERT INTO devices (id, name, token_hash, dataset_id, created_at, account_email, web_origin, idle_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(deviceId, row.device_name, await hashToken(token), currentDataset(env), nowIso, row.account_email,
      webOrigin, row.idle_days)
    .run()
  const data: SignInResult = { token, deviceId, deviceName: row.device_name, email: row.account_email }
  return json({ ok: true, data })
}

export async function readSession(env: Env, device: DeviceIdentity): Promise<SessionInfo> {
  const [row, google, googleHealth] = await Promise.all([
    env.DB.prepare('SELECT account_email FROM devices WHERE id = ?')
      .bind(device.deviceId).first<{ account_email: string | null }>(),
    connectorStatus(env, device.datasetId, 'google'),
    healthConnected(env, device.datasetId)
  ])
  return {
    deviceId: device.deviceId,
    deviceName: device.name,
    email: row?.account_email ?? null,
    services: {
      assistant: Boolean(env.OPENROUTER_API_KEY),
      trello: Boolean(env.TRELLO_API_KEY && env.TRELLO_TOKEN),
      voice: Boolean(env.OPENAI_API_KEY),
      google: google.connected,
      canvas: Boolean(env.CANVAS_CALENDAR_URL?.trim()),
      googleHealth,
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_WEBHOOK_SECRET?.trim() && env.TELEGRAM_OWNER_ID?.trim())
    }
  }
}

export async function signOut(env: Env, device: DeviceIdentity, now: string): Promise<void> {
  await env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now, device.deviceId).run()
}
