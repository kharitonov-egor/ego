import type { Env } from './auth'

/** Pushes wait this long at the browser vendor's push service for a browser that is off. */
const TTL_SECONDS = 24 * 3600
const RECORD_SIZE = 4096
const JWT_LIFETIME_SECONDS = 12 * 3600

export interface PushSubscriptionKeys {
  endpoint: string
  /** The browser's P-256 public key, base64url, uncompressed. */
  p256dh: string
  /** The browser's 16-byte auth secret, base64url. */
  auth: string
}

export interface PushMessage {
  title: string
  body: string
  route: string
  tag: string
  urgent: boolean
}

export type PushResult = 'sent' | 'gone' | 'failed'

const encoder = new TextEncoder()

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** WebCrypto wants a plain ArrayBuffer-backed view; this copies into one. */
function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length)
  new Uint8Array(copy).set(bytes)
  return copy
}

/** workers-types calls this field `$public`, but workerd and Node read the standard `public`. */
function ecdhParams(peer: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  const params: { name: 'ECDH'; public: CryptoKey } = { name: 'ECDH', public: peer }
  return params as unknown as SubtleCryptoDeriveKeyAlgorithm
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', buffer(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buffer(salt), info: buffer(info) }, key, length * 8)
  return new Uint8Array(bits)
}

/**
 * Encrypts a push payload for one browser, as RFC 8291 describes: an ephemeral ECDH key, the
 * browser's auth secret, and one aes128gcm record.
 */
export async function encryptPayload(plaintext: Uint8Array, keys: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>): Promise<Uint8Array> {
  const receiver = base64UrlDecode(keys.p256dh)
  const authSecret = base64UrlDecode(keys.auth)
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey) as ArrayBuffer)
  const receiverKey = await crypto.subtle.importKey('raw', buffer(receiver), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams(receiverKey), local.privateKey, 256))
  const ikm = await hkdf(authSecret, shared, concat(encoder.encode('WebPush: info\0'), receiver, localPublic), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const contentKey = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', buffer(contentKey), 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(nonce) }, aes, buffer(concat(plaintext, new Uint8Array([2])))))
  const header = new Uint8Array(21)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, RECORD_SIZE)
  header[20] = localPublic.length
  return concat(header, localPublic, sealed)
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

export function vapidKeys(env: Env): VapidKeys | null {
  const publicKey = env.WEB_PUSH_PUBLIC_KEY?.trim()
  const privateKey = env.WEB_PUSH_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  const subject = env.WEB_PUSH_SUBJECT?.trim() || env.DOCKET_BASE_URL?.trim() || 'https://ego.kharitonovegor.com'
  return { publicKey, privateKey, subject }
}

/** The VAPID header that tells the push service the message comes from the key the browser subscribed with. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSeconds: number): Promise<string> {
  const raw = base64UrlDecode(keys.publicKey)
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', d: keys.privateKey,
    x: base64UrlEncode(raw.slice(1, 33)), y: base64UrlEncode(raw.slice(33, 65)), ext: true
  }
  const signer = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: nowSeconds + JWT_LIFETIME_SECONDS, sub: keys.subject
  })))
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signer, encoder.encode(`${header}.${claims}`)))
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${keys.publicKey}`
}

/** Sends one push. A 404 or 410 means the browser dropped the subscription for good. */
export async function sendPush(subscription: PushSubscriptionKeys, message: PushMessage, keys: VapidKeys, nowMs: number): Promise<PushResult> {
  try {
    const body = await encryptPayload(encoder.encode(JSON.stringify(message)), subscription)
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(subscription.endpoint, keys, Math.floor(nowMs / 1000)),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(TTL_SECONDS),
        urgency: message.urgent ? 'high' : 'normal',
        topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
      },
      body: buffer(body)
    })
    if (response.status === 404 || response.status === 410) return 'gone'
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
