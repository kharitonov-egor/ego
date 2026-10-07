import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentKeyCreated, WebPushKey, WebPushTestResult } from '@ego/api-contracts'
import { runScheduledAgent } from '../src/agent-cron'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { base64UrlDecode, base64UrlEncode, encryptPayload, vapidAuthorization } from '../src/web-push'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'browser-device-token-that-is-long-enough-push1'
const API = 'https://ego.example'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123'
let ledger: Ledger | null = null

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

const encoder = new TextEncoder()

function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length)
  new Uint8Array(copy).set(bytes)
  return copy
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buffer(ikm), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buffer(salt), info: buffer(info) }, key, length * 8))
}

interface Browser {
  keys: CryptoKeyPair
  p256dh: string
  auth: string
}

async function browser(): Promise<Browser> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey) as ArrayBuffer)
  return { keys, p256dh: base64UrlEncode(raw), auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) }
}

/** What a browser does with an aes128gcm push body, written out from RFC 8291 independently of the sender. */
async function decrypt(body: Uint8Array, receiver: Browser): Promise<string> {
  const salt = body.slice(0, 16)
  const keyLength = body[20]
  const senderPublic = body.slice(21, 21 + keyLength)
  const ciphertext = body.slice(21 + keyLength)
  const senderKey = await crypto.subtle.importKey('raw', buffer(senderPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const derive = { name: 'ECDH', public: senderKey } as unknown as SubtleCryptoDeriveKeyAlgorithm
  const shared = new Uint8Array(await crypto.subtle.deriveBits(derive, receiver.keys.privateKey, 256))
  const receiverPublic = base64UrlDecode(receiver.p256dh)
  const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...receiverPublic, ...senderPublic])
  const ikm = await hkdf(base64UrlDecode(receiver.auth), shared, info, 32)
  const key = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', buffer(key), 'AES-GCM', false, ['decrypt'])
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(nonce) }, aes, buffer(ciphertext)))
  expect(plain[plain.length - 1]).toBe(2)
  return new TextDecoder().decode(plain.slice(0, -1))
}

async function vapid(): Promise<{ publicKey: string; privateKey: string; verifyKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey
  return { publicKey: base64UrlEncode(raw), privateKey: jwk.d ?? '', verifyKey: pair.publicKey }
}

describe('Web Push crypto', () => {
  it('encrypts a payload that the browser can read back', async () => {
    const receiver = await browser()
    const body = await encryptPayload(encoder.encode('{"title":"Ego","body":"Rent is due"}'), receiver)
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096)
    expect(await decrypt(body, receiver)).toBe('{"title":"Ego","body":"Rent is due"}')
  })

  it('signs a VAPID token for the push service origin', async () => {
    const keys = await vapid()
    const header = await vapidAuthorization(ENDPOINT, { ...keys, subject: 'https://ego.kharitonovegor.com' }, 1_800_000_000)
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, head, claims, signature, k] = match ?? []
    expect(k).toBe(keys.publicKey)
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims)))).toEqual({
      aud: 'https://fcm.googleapis.com', exp: 1_800_043_200, sub: 'https://ego.kharitonovegor.com'
    })
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.verifyKey, buffer(base64UrlDecode(signature)), encoder.encode(`${head}.${claims}`))
    expect(valid).toBe(true)
  })
})

async function environment(withKeys = true): Promise<{ env: Env; receiver: Browser }> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, web_origin, idle_days) VALUES ('device-web', 'Chrome', ?, 'ego', ?, 'https://ego.kharitonovegor.com', 30)`,
    [await hashToken(TOKEN), NOW])
  await exec(ledger.db, `INSERT INTO agent_settings (dataset_id, settings, updated_at) VALUES ('ego', ?, ?)`,
    [JSON.stringify({ timeZone: 'America/New_York', units: 'imperial' }), NOW])
  const keys = await vapid()
  const env: Env = { DB: ledger.db, ...(withKeys ? { WEB_PUSH_PUBLIC_KEY: keys.publicKey, WEB_PUSH_PRIVATE_KEY: keys.privateKey } : {}) }
  return { env, receiver: await browser() }
}

async function call<T>(env: Env, path: string, init: RequestInit = {}): Promise<{ status: number; body: { ok: boolean; data: T; error?: { message: string } } }> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  headers.set('content-type', 'application/json')
  const response = await handle(new Request(`${API}${path}`, { ...init, headers }), env)
  return { status: response.status, body: await response.json() as { ok: boolean; data: T; error?: { message: string } } }
}

async function subscribe(env: Env, receiver: Browser): Promise<void> {
  const saved = await call(env, '/v1/agent/web-push', { method: 'POST', body: JSON.stringify({ endpoint: ENDPOINT, keys: { p256dh: receiver.p256dh, auth: receiver.auth } }) })
  expect(saved.status).toBe(200)
}

async function sendMessage(env: Env, text: string, urgent = false): Promise<void> {
  const key = (await call<AgentKeyCreated>(env, '/v1/agent/keys', { method: 'POST', body: '{}' })).body.data.token
  await handle(new Request(`${API}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_message', arguments: { runId: null, text, urgent } } })
  }), env)
}

function pushService(status = 201): ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>> {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status }))
}

describe('Web Push delivery', () => {
  it('hands out the public key and checks subscriptions', async () => {
    const unset = await environment(false)
    expect((await call<WebPushKey>(unset.env, '/v1/agent/web-push')).body.data.publicKey).toBeNull()
    expect((await call(unset.env, '/v1/agent/web-push', { method: 'POST', body: '{}' })).status).toBe(503)
    ledger?.close()

    const { env, receiver } = await environment()
    expect((await call<WebPushKey>(env, '/v1/agent/web-push')).body.data.publicKey).toBe(env.WEB_PUSH_PUBLIC_KEY)
    const bad = await call(env, '/v1/agent/web-push', { method: 'POST', body: JSON.stringify({ endpoint: 'http://insecure', keys: { p256dh: receiver.p256dh, auth: receiver.auth } }) })
    expect(bad.status).toBe(400)
    await subscribe(env, receiver)
    expect((await call(env, '/v1/agent/web-push', { method: 'DELETE', body: JSON.stringify({ endpoint: ENDPOINT }) })).status).toBe(200)
    const service = pushService()
    vi.stubGlobal('fetch', service)
    expect((await call<WebPushTestResult>(env, '/v1/agent/web-push/test', { method: 'POST', body: '{}' })).body.data).toEqual({ sent: 0, failed: 0 })
  })

  it('pushes a message at once, encrypted, with a VAPID header', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
    const { env, receiver } = await environment()
    await subscribe(env, receiver)
    const service = pushService()
    vi.stubGlobal('fetch', service)
    await sendMessage(env, 'Your package arrived')
    expect(service).toHaveBeenCalledTimes(1)
    const [url, init] = service.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    const headers = init?.headers as Record<string, string>
    expect(headers['content-encoding']).toBe('aes128gcm')
    expect(headers.authorization.startsWith('vapid t=')).toBe(true)
    const payload = JSON.parse(await decrypt(new Uint8Array(init?.body as ArrayBuffer), receiver)) as Record<string, unknown>
    expect(payload).toMatchObject({ title: 'Agent', body: 'Your package arrived', route: '/ai?chat=agent' })

    await runScheduledAgent(env, new Date('2026-10-08T16:15:00Z'))
    expect(service).toHaveBeenCalledTimes(1)
  })

  it('waits for quiet hours to end, honors the Web switch, and drops gone subscriptions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T03:30:00Z'))
    const { env, receiver } = await environment()
    await subscribe(env, receiver)
    const service = pushService(410)
    vi.stubGlobal('fetch', service)
    await sendMessage(env, 'Late news')
    expect(service).not.toHaveBeenCalled()
    await runScheduledAgent(env, new Date('2026-10-08T11:45:00Z'))
    expect(service).not.toHaveBeenCalled()
    await runScheduledAgent(env, new Date('2026-10-08T12:00:00Z'))
    expect(service).toHaveBeenCalledTimes(1)
    const row = await env.DB.prepare('SELECT revoked_at FROM web_push_subscriptions').first<{ revoked_at: string | null }>()
    expect(row?.revoked_at).not.toBeNull()

    await subscribe(env, receiver)
    await exec(env.DB, `UPDATE agent_settings SET settings = ? WHERE dataset_id = 'ego'`,
      [JSON.stringify({ timeZone: 'America/New_York', units: 'imperial', quietStart: '22:00', quietEnd: '08:00', dailyCap: 6, devices: { phone: true, desktop: true, web: false }, proposalDays: 7, trusted: [] })])
    vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))
    await sendMessage(env, 'Not for the browser')
    expect(service).toHaveBeenCalledTimes(1)
  })
})
