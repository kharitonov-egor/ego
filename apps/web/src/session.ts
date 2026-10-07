import { normalizeApiUrl } from '@ego/local/api-client'
import type { SignedInAccount } from '@ego/ui/platform/local'

export interface WebSession {
  apiUrl: string
  token: string
  account: SignedInAccount | null
  /** False for a computer someone else uses: the token and the ledger copy live in this tab only. */
  remember: boolean
}

/** A Google sign-in that left for Google's page and has not come back yet. */
export interface PendingSignIn {
  apiUrl: string
  exchangeSecret: string
  expiresAt: string
  remember: boolean
}

const SESSION_KEY = 'ego.session'
const PENDING_KEY = 'ego.sign-in'
const PREFERENCE_PREFIX = 'ego.preference.'

export const DEFAULT_API_URL = normalizeApiUrl(import.meta.env.VITE_EGO_API_URL ?? '')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJson(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function accountFrom(value: unknown): SignedInAccount | null {
  if (!isRecord(value) || typeof value.deviceId !== 'string' || typeof value.deviceName !== 'string') return null
  return { deviceId: value.deviceId, deviceName: value.deviceName, email: typeof value.email === 'string' ? value.email : null }
}

function sessionFrom(value: unknown, remember: boolean): WebSession | null {
  if (!isRecord(value) || typeof value.apiUrl !== 'string' || typeof value.token !== 'string' || !value.token) return null
  return { apiUrl: value.apiUrl, token: value.token, account: accountFrom(value.account), remember }
}

/** A tab-only sign-in wins over a kept one, since it is the one this tab chose. */
export function loadSession(): WebSession | null {
  return sessionFrom(readJson(sessionStorage, SESSION_KEY), false) ?? sessionFrom(readJson(localStorage, SESSION_KEY), true)
}

export function saveSession(session: WebSession): void {
  const stored = JSON.stringify({ apiUrl: session.apiUrl, token: session.token, account: session.account })
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
  ;(session.remember ? localStorage : sessionStorage).setItem(SESSION_KEY, stored)
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(SESSION_KEY)
}

export function savePendingSignIn(pending: PendingSignIn): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
}

/** Read once: the exchange secret is useless after its one code is redeemed. */
export function takePendingSignIn(): PendingSignIn | null {
  const value = readJson(sessionStorage, PENDING_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  if (!isRecord(value) || typeof value.apiUrl !== 'string' || typeof value.exchangeSecret !== 'string' ||
      typeof value.expiresAt !== 'string') return null
  return { apiUrl: value.apiUrl, exchangeSecret: value.exchangeSecret, expiresAt: value.expiresAt, remember: value.remember !== false }
}

export function getPreference(key: string): string | null {
  return localStorage.getItem(`${PREFERENCE_PREFIX}${key}`)
}

export function setPreference(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(`${PREFERENCE_PREFIX}${key}`)
  else localStorage.setItem(`${PREFERENCE_PREFIX}${key}`, value)
}

/** What the device list shows for this browser, like "Chrome on Windows". */
export function browserName(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /Firefox\//.test(agent) ? 'Firefox'
      : /Chrome\//.test(agent) ? 'Chrome'
        : /Safari\//.test(agent) ? 'Safari'
          : 'Browser'
  const system = /Windows/.test(agent) ? 'Windows'
    : /Mac OS X/.test(agent) ? 'macOS'
      : /Android/.test(agent) ? 'Android'
        : /iPhone|iPad/.test(agent) ? 'iOS'
          : /Linux/.test(agent) ? 'Linux'
            : null
  return system ? `${browser} on ${system}` : browser
}
