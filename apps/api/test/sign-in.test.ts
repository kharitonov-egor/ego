import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BootstrapData, SessionInfo, SignInResult, SignInStartResult } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, addTransaction, exec, expense, seedLedger, type Ledger } from './helpers'

const EXISTING_TOKEN = 'phone-device-token-that-is-long-enough-aaaaaa'
let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

async function payload<T>(response: Response): Promise<Envelope<T>> {
  return await response.json() as Envelope<T>
}

async function environment(overrides: Partial<Env> = {}): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-existing', 'Desktop', ?, 'ego', ?)`, [await hashToken(EXISTING_TOKEN), NOW])
  return {
    DB: ledger.db,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    PUBLIC_BASE_URL: 'https://ego.example',
    ALLOWED_EMAILS: 'Me@Example.com, other@example.com',
    ...overrides
  }
}

function post(path: string, body: unknown, ip = '198.51.100.7'): Request {
  return new Request(`https://ego.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body)
  })
}

function authorized(path: string, token: string, method = 'GET'): Request {
  return new Request(`https://ego.example${path}`, { method, headers: { authorization: `Bearer ${token}` } })
}

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`
}

function googleAnswers(claims: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    access_token: 'access', id_token: idToken(claims), expires_in: 3600
  }), { status: 200 })))
}

const validClaims = {
  iss: 'https://accounts.google.com',
  aud: 'google-client',
  exp: Math.floor(Date.now() / 1000) + 600,
  email: 'me@example.com',
  email_verified: true
}

async function start(env: Env, deviceName = 'Pixel 9'): Promise<{ state: string; exchangeSecret: string; url: URL }> {
  const response = await handle(post('/v1/auth/google/start', { deviceName }), env)
  expect(response.status).toBe(200)
  const body = await payload<SignInStartResult>(response)
  const url = new URL(body.data.authorizationUrl)
  return { state: url.searchParams.get('state') ?? '', exchangeSecret: body.data.exchangeSecret, url }
}

async function callback(env: Env, state: string, code = 'google-code'): Promise<URL> {
  const response = await handle(new Request(
    `https://ego.example/v1/connectors/google/callback?state=${encodeURIComponent(state)}&code=${code}`), env)
  expect(response.status).toBe(302)
  return new URL(response.headers.get('location') ?? '')
}

async function signIn(env: Env): Promise<SignInResult> {
  const started = await start(env)
  googleAnswers(validClaims)
  const returned = await callback(env, started.state)
  const exchanged = await handle(post('/v1/auth/exchange', {
    code: returned.searchParams.get('code'), exchangeSecret: started.exchangeSecret
  }), env)
  expect(exchanged.status).toBe(200)
  return (await payload<SignInResult>(exchanged)).data
}

describe('Google sign-in', () => {
  it('stays off until an allowed account is configured', async () => {
    const env = await environment({ ALLOWED_EMAILS: ' ' })
    const response = await handle(post('/v1/auth/google/start', {}), env)
    expect(response.status).toBe(503)
  })

  it('asks Google for identity only, with PKCE, through the existing callback', async () => {
    const env = await environment()
    const { url, exchangeSecret } = await start(env)
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('openid email')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe('https://ego.example/v1/connectors/google/callback')
    expect(url.toString()).not.toContain(exchangeSecret)
  })

  it('enrols a device for an allowed account and the new token reads the ledger', async () => {
    const env = await environment()
    const result = await signIn(env)
    expect(result.email).toBe('me@example.com')
    expect(result.deviceName).toBe('Pixel 9')
    expect(result.token.length).toBeGreaterThanOrEqual(32)
    const reference = await handle(authorized('/v1/reference', result.token), env)
    expect(reference.status).toBe(200)
    const stored = await env.DB.prepare('SELECT dataset_id, account_email, token_hash FROM devices WHERE id = ?')
      .bind(result.deviceId).first<{ dataset_id: string; account_email: string; token_hash: string }>()
    expect(stored?.dataset_id).toBe('ego')
    expect(stored?.account_email).toBe('me@example.com')
    expect(stored?.token_hash).not.toBe(result.token)
  })

  it('sends a Google account outside the allowlist back without a code', async () => {
    const env = await environment()
    const { state } = await start(env)
    googleAnswers({ ...validClaims, email: 'stranger@example.com' })
    const returned = await callback(env, state)
    expect(returned.protocol).toBe('ego:')
    expect(returned.searchParams.get('error')).toBe('not_allowed')
    expect(returned.searchParams.has('code')).toBe(false)
  })

  it('rejects an unverified email, a foreign audience, and an expired token', async () => {
    for (const claims of [
      { ...validClaims, email_verified: false },
      { ...validClaims, aud: 'someone-else' },
      { ...validClaims, exp: Math.floor(Date.now() / 1000) - 10 }
    ]) {
      const env = await environment()
      const { state } = await start(env)
      googleAnswers(claims)
      expect((await callback(env, state)).searchParams.get('error')).toBe('failed')
      ledger?.close()
      ledger = null
    }
  })

  it('reports a cancelled consent screen', async () => {
    const env = await environment()
    const { state } = await start(env)
    const response = await handle(new Request(
      `https://ego.example/v1/connectors/google/callback?state=${state}&error=access_denied`), env)
    expect(new URL(response.headers.get('location') ?? '').searchParams.get('error')).toBe('cancelled')
  })

  it('redeems a code once and only with the matching secret', async () => {
    const env = await environment()
    const { state, exchangeSecret } = await start(env)
    googleAnswers(validClaims)
    const code = (await callback(env, state)).searchParams.get('code')
    const wrong = await handle(post('/v1/auth/exchange', { code, exchangeSecret: 'guessed-secret' }), env)
    expect(wrong.status).toBe(401)
    const right = await handle(post('/v1/auth/exchange', { code, exchangeSecret }), env)
    expect(right.status).toBe(200)
    const again = await handle(post('/v1/auth/exchange', { code, exchangeSecret }), env)
    expect(again.status).toBe(401)
  })

  it('accepts a Google callback for a state only once', async () => {
    const env = await environment()
    const { state } = await start(env)
    googleAnswers(validClaims)
    expect((await callback(env, state)).searchParams.has('code')).toBe(true)
    expect((await callback(env, state)).searchParams.get('error')).toBe('expired')
  })

  it('leaves connector states to the connector flow', async () => {
    const env = await environment()
    const response = await handle(new Request(
      'https://ego.example/v1/connectors/google/callback?state=unknown&code=x'), env)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('limits how many sign-ins one address can start in a minute, without blocking others', async () => {
    const env = await environment()
    for (let index = 0; index < 10; index += 1) {
      expect((await handle(post('/v1/auth/google/start', {}), env)).status).toBe(200)
    }
    expect((await handle(post('/v1/auth/google/start', {}), env)).status).toBe(429)
    expect((await handle(post('/v1/auth/google/start', {}, '203.0.113.9'), env)).status).toBe(200)
  })
})

describe('session', () => {
  it('reports the account and which services the server holds keys for', async () => {
    const env = await environment({ OPENROUTER_API_KEY: 'or-key', TRELLO_API_KEY: 'k' })
    const result = await signIn(env)
    const response = await handle(authorized('/v1/session', result.token), env)
    const session = (await payload<SessionInfo>(response)).data
    expect(session.email).toBe('me@example.com')
    expect(session.services).toEqual({ assistant: true, trello: false, voice: false, google: false, canvas: false, googleHealth: false })
    expect(JSON.stringify(session)).not.toContain('or-key')
  })

  it('signs out by revoking only this device', async () => {
    const env = await environment()
    const result = await signIn(env)
    expect((await handle(authorized('/v1/session', result.token, 'DELETE'), env)).status).toBe(200)
    expect((await handle(authorized('/v1/reference', result.token), env)).status).toBe(401)
    expect((await handle(authorized('/v1/reference', EXISTING_TOKEN), env)).status).toBe(200)
  })
})

describe('bootstrap', () => {
  it('returns every live record with receipt items and budget allocations', async () => {
    const env = await environment()
    if (!ledger) throw new Error('ledger missing')
    await addTransaction(ledger, expense('tx-1', '2026-09-01', 4220))
    await addTransaction(ledger, expense('tx-gone', '2026-09-02', 100))
    await exec(ledger.db, "UPDATE transactions SET deleted_at = ? WHERE id = 'tx-gone'", [NOW])
    await exec(ledger.db, `INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
      subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at)
      VALUES ('p-1', 'tx-1', 'Publix', '2026-09-01', 'USD', 4000, 0, 220, 0, 4220, ?, ?)`, [NOW, NOW])
    await exec(ledger.db, `INSERT INTO receipt_items (id, purchase_id, position, name, quantity,
      unit_price_cents, gross_price_cents, discount_cents, line_total_cents)
      VALUES ('i-2', 'p-1', 1, 'Bread', 1, 400, 400, 0, 400), ('i-1', 'p-1', 0, 'Milk', 1, 3600, 3600, 0, 3600)`)
    await exec(ledger.db, `INSERT INTO budgets (id, month, planned_income_cents, created_at, updated_at)
      VALUES ('b-1', '2026-09', 500000, ?, ?)`, [NOW, NOW])
    await exec(ledger.db, `INSERT INTO budget_allocations (id, budget_id, category_id, amount_cents)
      VALUES ('a-1', 'b-1', 'cat-food', 60000)`)
    const response = await handle(authorized('/v1/bootstrap', EXISTING_TOKEN), env)
    const data = (await payload<BootstrapData>(response)).data
    expect(data.accounts.map((item) => item.id)).toEqual(['acc-check', 'acc-savings', 'acc-old'])
    expect(data.transactions.map((item) => item.id)).toEqual(['tx-1'])
    expect(data.purchases[0].items.map((item) => item.name)).toEqual(['Milk', 'Bread'])
    expect(data.purchases[0].revision).toBe(1)
    expect(data.budgets[0].allocations).toEqual([
      { id: 'a-1', budgetId: 'b-1', categoryId: 'cat-food', amountCents: 60000 }
    ])
  })
})
