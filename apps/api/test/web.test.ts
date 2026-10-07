import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceList, SignInResult, SignInStartResult } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import worker from '../src/index'
import { handle } from '../src/router'
import { connectReturn, webSignInReturn } from '../src/web'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const APP_TOKEN = 'desktop-device-token-that-is-long-enough-aaaa'
const OTHER_DATASET_TOKEN = 'other-dataset-token-that-is-long-enough-bbbb'
const WEB = 'https://ego.kharitonovegor.com'
const DAY_MS = 86_400_000
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
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, last_seen_at)
    VALUES ('device-desktop', 'Desktop', ?, 'ego', ?, ?)`, [await hashToken(APP_TOKEN), NOW, NOW])
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-elsewhere', 'Elsewhere', ?, 'other', ?)`, [await hashToken(OTHER_DATASET_TOKEN), NOW])
  return {
    DB: ledger.db,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    PUBLIC_BASE_URL: 'https://api.example',
    ALLOWED_EMAILS: 'me@example.com',
    WEB_ORIGINS: `${WEB}, http://localhost:5173, http://insecure.example`,
    ...overrides
  }
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7', ...headers },
    body: JSON.stringify(body)
  })
}

function authorized(path: string, token: string, method = 'GET'): Request {
  return new Request(`https://api.example${path}`, { method, headers: { authorization: `Bearer ${token}` } })
}

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`
}

function googleAnswers(): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    access_token: 'access',
    id_token: idToken({
      iss: 'https://accounts.google.com', aud: 'google-client', exp: Math.floor(Date.now() / 1000) + 600,
      email: 'me@example.com', email_verified: true
    }),
    expires_in: 3600
  }), { status: 200 })))
}

async function webSignIn(env: Env, remember?: boolean): Promise<{ returned: URL; result: SignInResult }> {
  const started = await handle(post('/v1/auth/google/start', {
    deviceName: 'Chrome on Windows', returnUrl: `${WEB}/auth`, ...(remember === undefined ? {} : { remember })
  }), env)
  expect(started.status).toBe(200)
  const { authorizationUrl, exchangeSecret } = (await payload<SignInStartResult>(started)).data
  const state = new URL(authorizationUrl).searchParams.get('state') ?? ''
  googleAnswers()
  const callback = await handle(new Request(
    `https://api.example/v1/connectors/google/callback?state=${encodeURIComponent(state)}&code=google-code`), env)
  const returned = new URL(callback.headers.get('location') ?? '')
  const exchanged = await handle(post('/v1/auth/exchange', { code: returned.searchParams.get('code'), exchangeSecret }), env)
  expect(exchanged.status).toBe(200)
  return { returned, result: (await payload<SignInResult>(exchanged)).data }
}

async function ageDevice(env: Env, deviceId: string, days: number): Promise<void> {
  const then = new Date(Date.now() - days * DAY_MS).toISOString()
  await exec(env.DB, 'UPDATE devices SET created_at = ?, last_seen_at = ? WHERE id = ?', [then, then, deviceId])
}

const context = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext

describe('web sign-in', () => {
  it('comes back to the web page and enrols a browser that lapses after 30 idle days', async () => {
    const env = await environment()
    const { returned, result } = await webSignIn(env)
    expect(returned.origin + returned.pathname).toBe(`${WEB}/auth`)
    const stored = await env.DB.prepare('SELECT web_origin, idle_days FROM devices WHERE id = ?')
      .bind(result.deviceId).first<{ web_origin: string; idle_days: number }>()
    expect(stored).toEqual({ web_origin: WEB, idle_days: 30 })
    expect((await handle(authorized('/v1/reference', result.token), env)).status).toBe(200)
  })

  it('gives a tab-only sign-in one idle day', async () => {
    const env = await environment()
    const { result } = await webSignIn(env, false)
    const stored = await env.DB.prepare('SELECT idle_days FROM devices WHERE id = ?')
      .bind(result.deviceId).first<{ idle_days: number }>()
    expect(stored?.idle_days).toBe(1)
  })

  it('refuses a return address outside WEB_ORIGINS, over plain http, or off the sign-in path', async () => {
    const env = await environment()
    for (const returnUrl of ['https://evil.example/auth', 'http://insecure.example/auth', `${WEB}/other`, `${WEB}/auth?next=x`, 42]) {
      const response = await handle(post('/v1/auth/google/start', { deviceName: 'Chrome', returnUrl }), env)
      expect(response.status).toBe(400)
    }
    expect(webSignInReturn(env, 'http://localhost:5173/auth')).toBe('http://localhost:5173/auth')
  })

  it('stops accepting a browser token after 30 days without use and keeps app tokens', async () => {
    const env = await environment()
    const { result } = await webSignIn(env)
    await ageDevice(env, result.deviceId, 31)
    await ageDevice(env, 'device-desktop', 400)
    expect((await handle(authorized('/v1/reference', result.token), env)).status).toBe(401)
    expect((await handle(authorized('/v1/reference', APP_TOKEN), env)).status).toBe(200)
  })

  it('sends Health and Calendar consent back to the page a browser started from', async () => {
    const env = await environment()
    const { result } = await webSignIn(env)
    expect(await connectReturn(env, result.deviceId, 'ego://health', '/health')).toBe(`${WEB}/health`)
    expect(await connectReturn(env, 'device-desktop', 'ego://health', '/health')).toBe('ego://health')
    expect(await connectReturn({ ...env, WEB_ORIGINS: '' }, result.deviceId, 'ego://calendar', '/calendar')).toBe('ego://calendar')
  })
})

describe('CORS', () => {
  it('answers a preflight only for the web app', async () => {
    const env = await environment()
    const asked = (origin: string): Request => new Request('https://api.example/v1/reference', {
      method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' }
    })
    const allowed = await worker.fetch(asked(WEB), env, context)
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(WEB)
    expect(allowed.headers.get('access-control-allow-headers')).toContain('authorization')
    expect((await worker.fetch(asked('https://evil.example'), env, context)).status).toBe(403)
  })

  it('labels responses for the web app and leaves other callers alone', async () => {
    const env = await environment()
    const request = (origin?: string): Request => new Request('https://api.example/v1/reference', {
      headers: { authorization: `Bearer ${APP_TOKEN}`, ...(origin ? { origin } : {}) }
    })
    const fromWeb = await worker.fetch(request(WEB), env, context)
    expect(fromWeb.status).toBe(200)
    expect(fromWeb.headers.get('access-control-allow-origin')).toBe(WEB)
    expect((await worker.fetch(request('https://evil.example'), env, context)).headers.has('access-control-allow-origin')).toBe(false)
    expect((await worker.fetch(request(), env, context)).headers.has('access-control-allow-origin')).toBe(false)
  })
})

describe('devices', () => {
  it('lists the dataset devices that still work, marking this one and the browsers', async () => {
    const env = await environment()
    const { result } = await webSignIn(env)
    const response = await handle(authorized('/v1/devices', APP_TOKEN), env)
    const { devices } = (await payload<DeviceList>(response)).data
    expect(devices.map((device) => device.id).sort()).toEqual([result.deviceId, 'device-desktop'].sort())
    const desktop = devices.find((device) => device.id === 'device-desktop')
    const browser = devices.find((device) => device.id === result.deviceId)
    expect(desktop).toMatchObject({ current: true, browser: false, expiresAt: null })
    expect(browser).toMatchObject({ current: false, browser: true, email: 'me@example.com' })
    expect(browser?.expiresAt).toBeTruthy()
  })

  it('leaves out a browser that already lapsed', async () => {
    const env = await environment()
    const { result } = await webSignIn(env)
    await ageDevice(env, result.deviceId, 31)
    const { devices } = (await payload<DeviceList>(await handle(authorized('/v1/devices', APP_TOKEN), env))).data
    expect(devices.map((device) => device.id)).toEqual(['device-desktop'])
  })

  it('revokes another device in the same dataset only', async () => {
    const env = await environment()
    const { result } = await webSignIn(env)
    expect((await handle(authorized(`/v1/devices/${result.deviceId}`, APP_TOKEN, 'DELETE'), env)).status).toBe(200)
    expect((await handle(authorized('/v1/reference', result.token), env)).status).toBe(401)
    expect((await handle(authorized('/v1/devices/device-elsewhere', APP_TOKEN, 'DELETE'), env)).status).toBe(404)
    expect((await handle(authorized('/v1/reference', OTHER_DATASET_TOKEN), env)).status).toBe(200)
  })
})

describe('receipt photos', () => {
  const image = { base64: 'aGVsbG8=', mimeType: 'image/png', categories: [{ id: 'cat-food', name: 'Food', kind: 'expense' }] }

  it('needs the Worker to hold an OpenRouter key', async () => {
    const env = await environment()
    const response = await handle(post('/v1/money/receipt-image', image, { authorization: `Bearer ${APP_TOKEN}` }), env)
    expect(response.status).toBe(503)
  })

  it('reads the photo with the Worker key and returns the draft', async () => {
    const env = await environment({ OPENROUTER_API_KEY: 'or-key', RECEIPT_MODEL: 'test/model' })
    const draft = {
      kind: 'expense', counterparty: 'Publix', date: '2026-10-01', currency: 'USD', amountCents: 4200,
      notes: '', categoryId: 'cat-food', receipt: null
    }
    const openRouter = vi.fn(async (_url: string, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { model: string }
      expect(sent.model).toBe('test/model')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer or-key')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', openRouter)
    const response = await handle(post('/v1/money/receipt-image', image, { authorization: `Bearer ${APP_TOKEN}` }), env)
    expect(response.status).toBe(200)
    expect((await payload<typeof draft>(response)).data).toEqual(draft)
  })

  it('refuses a body without categories', async () => {
    const env = await environment({ OPENROUTER_API_KEY: 'or-key' })
    const response = await handle(post('/v1/money/receipt-image', { base64: 'aGVsbG8=', mimeType: 'image/png' },
      { authorization: `Bearer ${APP_TOKEN}` }), env)
    expect(response.status).toBe(400)
  })
})
