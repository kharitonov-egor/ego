import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashToken, type Env } from '../src/auth'
import { decryptConnectorToken, encryptConnectorToken } from '../src/connector-crypto'
import { GOOGLE_SCOPES, isAllowedWisprUrl } from '../src/connectors'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN_A = 'desktop-device-token-that-is-long-enough-aaaa'
const TOKEN_B = 'desktop-device-token-that-is-long-enough-bbbb'
const KEY_V1 = `v1:${Buffer.alloc(32, 1).toString('base64')}`
const KEY_V2 = `v2:${Buffer.alloc(32, 2).toString('base64')}`
let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

async function environment(): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-a', 'A', ?, 'dataset-a', ?)`, [await hashToken(TOKEN_A), NOW])
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-b', 'B', ?, 'dataset-b', ?)`, [await hashToken(TOKEN_B), NOW])
  return {
    DB: ledger.db,
    CONNECTOR_TOKEN_KEY: KEY_V1,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    PUBLIC_BASE_URL: 'https://ego.example'
  }
}

function authorized(path: string, method = 'GET', token = TOKEN_A, body?: unknown): Request {
  return new Request(`https://ego.example${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

describe('connector token encryption', () => {
  it('decrypts an old key after rotation and writes with the current version', async () => {
    const first = await encryptConnectorToken('refresh-secret', { CONNECTOR_TOKEN_KEY: KEY_V1 })
    expect(first.keyVersion).toBe('v1')
    expect(first.encrypted).not.toContain('refresh-secret')
    expect(await decryptConnectorToken(first.encrypted, {
      CONNECTOR_TOKEN_KEY: KEY_V2,
      CONNECTOR_TOKEN_KEY_PREVIOUS: KEY_V1
    })).toBe('refresh-secret')
    expect((await encryptConnectorToken('next-secret', { CONNECTOR_TOKEN_KEY: KEY_V2 })).keyVersion).toBe('v2')
  })
})

describe('Google connector OAuth', () => {
  it('requests only the declared identity and read-only scopes', async () => {
    const env = await environment()
    const response = await handle(authorized('/v1/connectors/google/start', 'POST', TOKEN_A, {}), env)
    expect(response.status).toBe(200)
    const payload = await response.json() as any
    const authorization = new URL(payload.data.authorizationUrl)
    expect(authorization.searchParams.get('scope')?.split(' ')).toEqual(GOOGLE_SCOPES)
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('consumes state once and attaches the connector to the requesting dataset', async () => {
    const env = await environment()
    const started = await handle(authorized('/v1/connectors/google/start', 'POST', TOKEN_A, {}), env)
    const startPayload = await started.json() as any
    const state = new URL(startPayload.data.authorizationUrl).searchParams.get('state')!
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/token')) return new Response(JSON.stringify({
        access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600,
        scope: GOOGLE_SCOPES.join(' ')
      }), { status: 200 })
      return new Response(JSON.stringify({ emailAddress: 'person@example.com' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const callbackUrl = `/v1/connectors/google/callback?state=${encodeURIComponent(state)}&code=code-1`
    expect((await handle(authorized(callbackUrl), env)).status).toBe(200)
    expect((await handle(authorized(callbackUrl), env)).status).toBe(400)

    const ownStatus = await (await handle(authorized('/v1/connectors/google/status'), env)).json() as any
    const otherStatus = await (await handle(authorized('/v1/connectors/google/status', 'GET', TOKEN_B), env)).json() as any
    expect(ownStatus.data).toMatchObject({ connected: true, accountLabel: 'person@example.com' })
    expect(otherStatus.data.connected).toBe(false)
    const stored = await env.DB.prepare(`SELECT encrypted_refresh_token FROM connector_accounts
      WHERE dataset_id = 'dataset-a'`).first<{ encrypted_refresh_token: string }>()
    expect(stored?.encrypted_refresh_token).not.toContain('refresh-secret')
  })
})

describe('Wispr URL policy', () => {
  it('allows only the provider MCP and OAuth HTTPS endpoints', () => {
    expect(isAllowedWisprUrl('https://api.wisprflow.ai/connect/mcp')).toBe(true)
    expect(isAllowedWisprUrl('https://mcp-auth.wisprflow.com/oauth2/authorize')).toBe(true)
    expect(isAllowedWisprUrl('http://api.wisprflow.ai/connect/mcp')).toBe(false)
    expect(isAllowedWisprUrl('https://api.wisprflow.ai.evil.example/mcp')).toBe(false)
    expect(isAllowedWisprUrl('https://mcp-auth.wisprflow.com.evil.example/oauth2/token')).toBe(false)
    expect(isAllowedWisprUrl('https://127.0.0.1/mcp')).toBe(false)
  })
})
