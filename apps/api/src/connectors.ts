import type {
  ConnectorStatus,
  GoogleConnectorStartResult,
  WisprConnectorStartInput
} from '@ego/api-contracts'
import type { DeviceIdentity } from '@ego/api-contracts'
import type { Env } from './auth'
import { decryptConnectorToken, encryptConnectorToken, randomUrlToken, sha256 } from './connector-crypto'

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
] as const

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const OAUTH_TTL_MS = 10 * 60_000

interface ConnectorRow {
  encrypted_refresh_token: string
  granted_scopes: string
  account_label: string | null
  revoked_at: string | null
  server_url?: string | null
  token_endpoint?: string | null
  oauth_client_id?: string | null
  allowed_tools?: string | null
}

interface OAuthStateRow {
  provider: 'google' | 'wispr'
  dataset_id: string
  device_id: string
  pkce_verifier: string
  redirect_uri: string
  expires_at: string
  consumed_at: string | null
  server_url?: string | null
  token_endpoint?: string | null
  oauth_client_id?: string | null
}

interface OAuthMetadata {
  authorization_endpoint?: string
  token_endpoint?: string
  registration_endpoint?: string
  scopes_supported?: string[]
}

interface ProtectedResourceMetadata {
  authorization_servers?: string[]
}

const WISPR_ALLOWED_HOSTS = new Set(['api.wisprflow.ai', 'mcp-auth.wisprflow.com'])
const WISPR_READ_TOOL = /(^|[_-])(get|list|read|search|find|resolve|fetch)([_-]|$)/i
const WISPR_WRITE_TOOL = /(^|[_-])(create|update|delete|remove|write|edit|send|record)([_-]|$)/i

export function isAllowedWisprUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.port === '' || url.port === '443') && WISPR_ALLOWED_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  let response: Response
  try { response = await fetch(url, { ...init, redirect: 'error' }) } catch { return null }
  if (!response.ok) return null
  try { return await response.json() as T } catch { return null }
}

async function discoverWispr(serverUrl: string): Promise<{
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scopes: string[]
} | null> {
  const server = new URL(serverUrl)
  const protectedMetadataUrls = [
    `${server.origin}/.well-known/oauth-protected-resource${server.pathname}`,
    `${server.origin}/.well-known/oauth-protected-resource`
  ]
  let protectedMetadata: ProtectedResourceMetadata | null = null
  for (const url of protectedMetadataUrls) {
    protectedMetadata = await fetchJson<ProtectedResourceMetadata>(url)
    if (protectedMetadata?.authorization_servers?.[0]) break
  }
  const issuer = protectedMetadata?.authorization_servers?.[0] ?? server.origin
  if (!isAllowedWisprUrl(issuer)) return null
  const issuerUrl = new URL(issuer)
  const metadata = await fetchJson<OAuthMetadata>(`${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`)
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) return null
  if (![metadata.authorization_endpoint, metadata.token_endpoint, metadata.registration_endpoint].every(isAllowedWisprUrl)) return null
  return {
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
    registrationEndpoint: metadata.registration_endpoint,
    scopes: Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.filter((item) => typeof item === 'string') : []
  }
}

function wisprCallbackUrl(request: Request, env: Env): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? new URL(request.url).origin
  return `${base}/v1/connectors/wispr/callback`
}

async function parseRequestJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { return null }
}

export async function startWisprConnector(
  request: Request,
  env: Env,
  device: DeviceIdentity,
  now = new Date()
): Promise<Response> {
  if (!env.CONNECTOR_TOKEN_KEY) {
    return json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Connector token encryption is not configured' } }, 503)
  }
  await env.DB.prepare('DELETE FROM connector_oauth_states WHERE expires_at <= ?').bind(now.toISOString()).run()
  const body = await parseRequestJson(request) as WisprConnectorStartInput | null
  if (!body || Object.keys(body).length !== 1 || !isAllowedWisprUrl(body.serverUrl)) {
    return json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Enter the HTTPS Wispr Flow MCP server URL' } }, 400)
  }
  const discovery = await discoverWispr(body.serverUrl)
  if (!discovery) {
    return json({ ok: false, error: { code: 'DISCOVERY_FAILED', message: 'Ego could not verify that Wispr Flow server' } }, 400)
  }
  const redirectUri = wisprCallbackUrl(request, env)
  const registration = await fetchJson<{ client_id?: string }>(discovery.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Ego',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code']
    })
  })
  if (!registration?.client_id || registration.client_id.length > 500) {
    return json({ ok: false, error: { code: 'REGISTRATION_FAILED', message: 'Wispr Flow did not register Ego' } }, 502)
  }
  const state = randomUrlToken()
  const verifier = randomUrlToken(48)
  const expiresAt = new Date(now.getTime() + OAUTH_TTL_MS).toISOString()
  await env.DB.prepare(`INSERT INTO connector_oauth_states
    (state_hash, provider, dataset_id, device_id, pkce_verifier, server_url, token_endpoint,
      authorization_endpoint, oauth_client_id, redirect_uri, expires_at, created_at)
    VALUES (?, 'wispr', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), device.datasetId, device.deviceId, verifier, body.serverUrl,
      discovery.tokenEndpoint, discovery.authorizationEndpoint, registration.client_id,
      redirectUri, expiresAt, now.toISOString()).run()
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256'
  })
  if (discovery.scopes.length > 0) params.set('scope', discovery.scopes.join(' '))
  return json({
    ok: true,
    data: { authorizationUrl: `${discovery.authorizationEndpoint}?${params}`, expiresAt }
  })
}

function parseMcpJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown> } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      try { return JSON.parse(line.slice(5).trim()) as Record<string, unknown> } catch { continue }
    }
    return null
  }
}

async function wisprMcpRequest(
  serverUrl: string,
  accessToken: string,
  message: Record<string, unknown>,
  sessionId?: string,
  protocolVersion = '2025-11-25'
): Promise<{ response: Response; payload: Record<string, unknown> | null } | null> {
  try {
    const response = await fetch(serverUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': protocolVersion,
        ...(sessionId ? { 'mcp-session-id': sessionId } : {})
      },
      body: JSON.stringify(message)
    })
    if (!response.ok) return null
    return { response, payload: parseMcpJson(await response.text()) }
  } catch {
    return null
  }
}

async function listWisprTools(serverUrl: string, accessToken: string): Promise<string[] | null> {
  if (!isAllowedWisprUrl(serverUrl)) return null
  const initialized = await wisprMcpRequest(serverUrl, accessToken, {
    jsonrpc: '2.0',
    id: 'initialize',
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'Ego', version: '0.1.0' }
    }
  })
  const initialization = initialized?.payload?.result as { protocolVersion?: string } | undefined
  if (!initialized || !initialization?.protocolVersion) return null
  const sessionId = initialized.response.headers.get('mcp-session-id') ?? undefined
  const protocolVersion = initialization.protocolVersion
  await wisprMcpRequest(serverUrl, accessToken, {
    jsonrpc: '2.0', method: 'notifications/initialized', params: {}
  }, sessionId, protocolVersion)
  const names: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 5; page += 1) {
    const listed = await wisprMcpRequest(serverUrl, accessToken, {
      jsonrpc: '2.0', id: `tools-${page}`, method: 'tools/list', params: cursor ? { cursor } : {}
    }, sessionId, protocolVersion)
    const result = listed?.payload?.result as { tools?: Array<{ name?: string }>; nextCursor?: string } | undefined
    if (!result?.tools) return null
    names.push(...result.tools.map((tool) => tool.name).filter((name): name is string => typeof name === 'string'))
    cursor = result.nextCursor
    if (!cursor) break
  }
  const allowed = names.filter((name) => WISPR_READ_TOOL.test(name) && !WISPR_WRITE_TOOL.test(name))
  return allowed.length > 0 ? allowed : null
}

export async function completeWisprConnector(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!state || !code || url.searchParams.has('error')) return html('The Wispr authorization response was incomplete.', false)
  const stateHash = await sha256(state)
  const row = await env.DB.prepare(`SELECT provider, dataset_id, device_id, pkce_verifier, redirect_uri,
    expires_at, consumed_at, server_url, token_endpoint, oauth_client_id
    FROM connector_oauth_states WHERE state_hash = ?`).bind(stateHash).first<OAuthStateRow>()
  const now = new Date().toISOString()
  if (!row || row.provider !== 'wispr' || row.consumed_at || row.expires_at <= now ||
      !row.server_url || !row.token_endpoint || !row.oauth_client_id ||
      !isAllowedWisprUrl(row.server_url) || !isAllowedWisprUrl(row.token_endpoint)) {
    return html('This Wispr authorization link expired or was already used.', false)
  }
  const claimed = await env.DB.prepare(`UPDATE connector_oauth_states SET consumed_at = ?
    WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`).bind(now, stateHash, now).run()
  if ((claimed.meta.changes ?? 0) !== 1) return html('This Wispr authorization link was already used.', false)
  const token = await fetchJson<GoogleTokenResponse>(row.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: row.oauth_client_id,
      redirect_uri: row.redirect_uri,
      code_verifier: row.pkce_verifier
    })
  })
  if (!token?.access_token || !token.refresh_token) return html('Wispr Flow did not return a renewable connection.', false)
  const allowedTools = await listWisprTools(row.server_url, token.access_token)
  if (!allowedTools) return html('Ego could not find the documented read-only Wispr Flow tools.', false)
  const protectedToken = await encryptConnectorToken(token.refresh_token, env)
  const expiresAt = new Date(Date.now() + Math.max(0, token.expires_in ?? 0) * 1000).toISOString()
  await env.DB.prepare(`INSERT INTO connector_accounts
    (id, dataset_id, provider, encrypted_refresh_token, token_key_version, granted_scopes,
      account_label, server_url, token_endpoint, oauth_client_id, allowed_tools,
      access_expires_at, created_at, updated_at, revoked_at)
    VALUES (?, ?, 'wispr', ?, ?, ?, 'Wispr Flow', ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(dataset_id, provider) DO UPDATE SET
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_key_version = excluded.token_key_version,
      granted_scopes = excluded.granted_scopes,
      server_url = excluded.server_url,
      token_endpoint = excluded.token_endpoint,
      oauth_client_id = excluded.oauth_client_id,
      allowed_tools = excluded.allowed_tools,
      access_expires_at = excluded.access_expires_at,
      updated_at = excluded.updated_at,
      revoked_at = NULL`)
    .bind(`wispr-${row.dataset_id}`, row.dataset_id, protectedToken.encrypted, protectedToken.keyVersion,
      JSON.stringify(parseScopes(token.scope)), row.server_url, row.token_endpoint, row.oauth_client_id,
      JSON.stringify(allowedTools), expiresAt, now, now).run()
  return html('Ego can now read your Wispr Flow meetings and notes.', true)
}

export async function wisprToolConfiguration(env: Env, datasetId: string): Promise<{
  serverUrl: string
  accessToken: string
  allowedTools: string[]
} | null> {
  const row = await env.DB.prepare(`SELECT encrypted_refresh_token, granted_scopes, account_label,
    revoked_at, server_url, token_endpoint, oauth_client_id, allowed_tools
    FROM connector_accounts WHERE dataset_id = ? AND provider = 'wispr'`)
    .bind(datasetId).first<ConnectorRow>()
  if (!row || row.revoked_at || !row.server_url || !row.token_endpoint || !row.oauth_client_id ||
      !isAllowedWisprUrl(row.server_url) || !isAllowedWisprUrl(row.token_endpoint)) return null
  let refreshToken: string
  try { refreshToken = await decryptConnectorToken(row.encrypted_refresh_token, env) } catch { return null }
  const token = await fetchJson<GoogleTokenResponse>(row.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: row.oauth_client_id })
  })
  if (!token?.access_token) {
    const now = new Date().toISOString()
    await env.DB.prepare(`UPDATE connector_accounts SET revoked_at = ?, updated_at = ?
      WHERE dataset_id = ? AND provider = 'wispr'`).bind(now, now, datasetId).run()
    return null
  }
  try {
    const protectedToken = await encryptConnectorToken(token.refresh_token ?? refreshToken, env)
    const refreshedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + Math.max(0, token.expires_in ?? 0) * 1000).toISOString()
    await env.DB.prepare(`UPDATE connector_accounts SET encrypted_refresh_token = ?, token_key_version = ?,
      access_expires_at = ?, updated_at = ? WHERE dataset_id = ? AND provider = 'wispr'`)
      .bind(protectedToken.encrypted, protectedToken.keyVersion, expiresAt, refreshedAt, datasetId).run()
  } catch {
    return null
  }
  let allowedTools: string[] = []
  try { allowedTools = JSON.parse(row.allowed_tools ?? '[]') as string[] } catch { return null }
  if (!allowedTools.every((name) => typeof name === 'string' && WISPR_READ_TOOL.test(name) && !WISPR_WRITE_TOOL.test(name))) return null
  return { serverUrl: row.server_url, accessToken: token.access_token, allowedTools }
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function html(message: string, success: boolean): Response {
  const title = success ? 'Connection complete' : 'Connection failed'
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body style="font:16px system-ui;background:#111827;color:#f9fafb;padding:48px"><main style="max-width:520px;margin:auto"><h1>${title}</h1><p>${message}</p><p>You can close this window and return to Ego.</p></main></body></html>`, {
    status: success ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function callbackUrl(request: Request, env: Env): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? new URL(request.url).origin
  return `${base}/v1/connectors/google/callback`
}

function parseScopes(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/\s+/).filter(Boolean).map((scope) =>
    scope === 'https://www.googleapis.com/auth/userinfo.email' ? 'email' : scope
  ))].sort()
}

function hasExactGoogleScopes(value: string | undefined): boolean {
  const actual = parseScopes(value)
  const expected = [...GOOGLE_SCOPES].sort()
  return actual.length === expected.length && expected.every((scope, index) => actual[index] === scope)
}

async function exchangeGoogleToken(body: URLSearchParams, env: Env): Promise<GoogleTokenResponse | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
  body.set('client_id', env.GOOGLE_CLIENT_ID)
  body.set('client_secret', env.GOOGLE_CLIENT_SECRET)
  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  try {
    return await response.json() as GoogleTokenResponse
  } catch {
    return null
  }
}

export async function startGoogleConnector(
  request: Request,
  env: Env,
  device: DeviceIdentity,
  now = new Date()
): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CONNECTOR_TOKEN_KEY) {
    return json({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Google connection is not configured' } }, 503)
  }
  await env.DB.prepare('DELETE FROM connector_oauth_states WHERE expires_at <= ?').bind(now.toISOString()).run()
  const state = randomUrlToken()
  const verifier = randomUrlToken(48)
  const challenge = await sha256(verifier)
  const redirectUri = callbackUrl(request, env)
  const expiresAt = new Date(now.getTime() + OAUTH_TTL_MS).toISOString()
  await env.DB.prepare(`INSERT INTO connector_oauth_states
    (state_hash, provider, dataset_id, device_id, pkce_verifier, redirect_uri, expires_at, created_at)
    VALUES (?, 'google', ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), device.datasetId, device.deviceId, verifier, redirectUri, expiresAt, now.toISOString())
    .run()
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    include_granted_scopes: 'false'
  })
  const data: GoogleConnectorStartResult = {
    authorizationUrl: `${GOOGLE_AUTHORIZE}?${params.toString()}`,
    expiresAt
  }
  return json({ ok: true, data })
}

export async function completeGoogleConnector(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!state || !code || url.searchParams.has('error')) return html('The authorization response was incomplete.', false)
  const row = await env.DB.prepare(`SELECT provider, dataset_id, device_id, pkce_verifier, redirect_uri,
    expires_at, consumed_at FROM connector_oauth_states WHERE state_hash = ?`)
    .bind(await sha256(state)).first<OAuthStateRow>()
  const now = new Date().toISOString()
  if (!row || row.provider !== 'google' || row.consumed_at || row.expires_at <= now) {
    return html('This authorization link expired or was already used.', false)
  }
  const claimed = await env.DB.prepare(`UPDATE connector_oauth_states SET consumed_at = ?
    WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`)
    .bind(now, await sha256(state), now).run()
  if ((claimed.meta.changes ?? 0) !== 1) return html('This authorization link was already used.', false)
  const token = await exchangeGoogleToken(new URLSearchParams({
    code,
    redirect_uri: row.redirect_uri,
    grant_type: 'authorization_code',
    code_verifier: row.pkce_verifier
  }), env)
  if (!token?.access_token || !token.refresh_token || !hasExactGoogleScopes(token.scope)) {
    return html('Google did not grant the exact read-only access Ego requested.', false)
  }
  let profile: { emailAddress?: string }
  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${token.access_token}` }
    })
    if (!response.ok) return html('Ego could not verify the Google account.', false)
    profile = await response.json() as { emailAddress?: string }
  } catch {
    return html('Ego could not verify the Google account.', false)
  }
  const protectedToken = await encryptConnectorToken(token.refresh_token, env)
  const expiresAt = new Date(Date.now() + Math.max(0, token.expires_in ?? 0) * 1000).toISOString()
  await env.DB.prepare(`INSERT INTO connector_accounts
    (id, dataset_id, provider, encrypted_refresh_token, token_key_version, granted_scopes,
      account_label, access_expires_at, created_at, updated_at, revoked_at)
    VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(dataset_id, provider) DO UPDATE SET
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_key_version = excluded.token_key_version,
      granted_scopes = excluded.granted_scopes,
      account_label = excluded.account_label,
      access_expires_at = excluded.access_expires_at,
      updated_at = excluded.updated_at,
      revoked_at = NULL`)
    .bind(`google-${row.dataset_id}`, row.dataset_id, protectedToken.encrypted, protectedToken.keyVersion,
      JSON.stringify(parseScopes(token.scope)), profile.emailAddress ?? null, expiresAt, now, now)
    .run()
  return html('Ego can now read Gmail and Google Drive when you enable those tools.', true)
}

export async function connectorStatus(env: Env, datasetId: string, provider: 'google' | 'wispr'): Promise<ConnectorStatus> {
  const row = await env.DB.prepare(`SELECT encrypted_refresh_token, granted_scopes, account_label, revoked_at
    FROM connector_accounts WHERE dataset_id = ? AND provider = ?`)
    .bind(datasetId, provider).first<ConnectorRow>()
  let scopes: string[] = []
  try { scopes = row ? JSON.parse(row.granted_scopes) as string[] : [] } catch { scopes = [] }
  return {
    provider,
    connected: Boolean(row && !row.revoked_at),
    accountLabel: row?.account_label ?? null,
    scopes,
    readOnly: true,
    revoked: Boolean(row?.revoked_at)
  }
}

export async function disconnectConnector(env: Env, datasetId: string, provider: 'google' | 'wispr'): Promise<void> {
  if (provider === 'google') {
    const row = await env.DB.prepare(`SELECT encrypted_refresh_token, granted_scopes, account_label, revoked_at
      FROM connector_accounts WHERE dataset_id = ? AND provider = 'google'`)
      .bind(datasetId).first<ConnectorRow>()
    if (row) {
      try {
        const token = await decryptConnectorToken(row.encrypted_refresh_token, env)
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token })
        })
      } catch {
        // Local removal still wins if Google is offline or already revoked the grant.
      }
    }
  }
  await env.DB.prepare('DELETE FROM connector_accounts WHERE dataset_id = ? AND provider = ?')
    .bind(datasetId, provider).run()
}

export async function googleAccessToken(env: Env, datasetId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT encrypted_refresh_token, granted_scopes, account_label, revoked_at
    FROM connector_accounts WHERE dataset_id = ? AND provider = 'google'`)
    .bind(datasetId).first<ConnectorRow>()
  if (!row || row.revoked_at) return null
  let refreshToken: string
  try {
    refreshToken = await decryptConnectorToken(row.encrypted_refresh_token, env)
  } catch {
    return null
  }
  const token = await exchangeGoogleToken(new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }), env)
  if (!token?.access_token) {
    await env.DB.prepare(`UPDATE connector_accounts SET revoked_at = ?, updated_at = ?
      WHERE dataset_id = ? AND provider = 'google'`).bind(new Date().toISOString(), new Date().toISOString(), datasetId).run()
    return null
  }
  try {
    const protectedToken = await encryptConnectorToken(token.refresh_token ?? refreshToken, env)
    const refreshedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + Math.max(0, token.expires_in ?? 0) * 1000).toISOString()
    await env.DB.prepare(`UPDATE connector_accounts SET encrypted_refresh_token = ?, token_key_version = ?,
      access_expires_at = ?, updated_at = ? WHERE dataset_id = ? AND provider = 'google'`)
      .bind(protectedToken.encrypted, protectedToken.keyVersion, expiresAt, refreshedAt, datasetId).run()
  } catch {
    return null
  }
  return token.access_token
}

export { GOOGLE_SCOPES }
