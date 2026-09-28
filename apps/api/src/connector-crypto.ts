import type { Env } from './auth'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

interface KeyMaterial {
  version: string
  key: CryptoKey
}

async function importVersionedKey(secret: string | undefined): Promise<KeyMaterial | null> {
  if (!secret) return null
  const separator = secret.indexOf(':')
  if (separator < 1) throw new Error('CONNECTOR_TOKEN_KEY must use version:base64 format')
  const version = secret.slice(0, separator)
  const bytes = fromBase64(secret.slice(separator + 1))
  if (bytes.byteLength !== 32) throw new Error('CONNECTOR_TOKEN_KEY must contain 32 bytes')
  return {
    version,
    key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
}

export async function encryptConnectorToken(
  value: string,
  env: Pick<Env, 'CONNECTOR_TOKEN_KEY'>
): Promise<{ encrypted: string; keyVersion: string }> {
  const material = await importVersionedKey(env.CONNECTOR_TOKEN_KEY)
  if (!material) throw new Error('Connector token encryption is not configured')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, material.key, encoder.encode(value))
  return {
    encrypted: `${material.version}.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`,
    keyVersion: material.version
  }
}

export async function decryptConnectorToken(
  encrypted: string,
  env: Pick<Env, 'CONNECTOR_TOKEN_KEY' | 'CONNECTOR_TOKEN_KEY_PREVIOUS'>
): Promise<string> {
  const [version, ivText, ciphertextText, extra] = encrypted.split('.')
  if (!version || !ivText || !ciphertextText || extra !== undefined) throw new Error('Invalid encrypted token')
  const candidates = await Promise.all([
    importVersionedKey(env.CONNECTOR_TOKEN_KEY),
    importVersionedKey(env.CONNECTOR_TOKEN_KEY_PREVIOUS)
  ])
  const material = candidates.find((candidate) => candidate?.version === version)
  if (!material) throw new Error('The connector token key version is unavailable')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivText) },
    material.key,
    fromBase64(ciphertextText)
  )
  return decoder.decode(plaintext)
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return base64Url(new Uint8Array(digest))
}

export function randomUrlToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}
