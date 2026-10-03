import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { QuickAddListShortcut } from '../shared/types'
import type { SignedInAccount } from '../shared/local'
import {
  DEFAULT_LIVE_PREFERENCES,
  isLivePreferences,
  type LivePreferences,
  type T3Session
} from '@ego/core'

interface AppSettings {
  quickAddHotkey: string
  toolPaletteHotkey: string
  trelloApiKey: string
  trelloToken: string
  trelloBoardId: string
  trelloListId: string
  quickAddListShortcuts: QuickAddListShortcut[]
  moneyApiUrl: string
  moneyDeviceTokenEncrypted: string
  openRouterApiKeyEncrypted: string
  transactionImageModel: string
  t3Origin: string
  t3TokenEncrypted: string
  t3TokenExpiresAt: number
  t3NotifyEnabled: boolean
  livePreferences: LivePreferences
  account: SignedInAccount | null
  /** What the renderer would keep in SecureStore on the phone: small JSON values under `ego.*` keys. */
  preferences: Record<string, string>
}

/**
 * Secrets live in .env.local (gitignored) so the public repo never carries them.
 * They only seed the store the first time; the Settings UI is the source of truth after that.
 */
const seed = {
  trelloApiKey: import.meta.env.MAIN_VITE_TRELLO_API_KEY ?? '',
  trelloToken: import.meta.env.MAIN_VITE_TRELLO_TOKEN ?? '',
  trelloBoardId: import.meta.env.MAIN_VITE_TRELLO_BOARD_ID ?? '',
  trelloListId: import.meta.env.MAIN_VITE_TRELLO_LIST_ID ?? ''
}

const store = new Store<AppSettings>({
  name: 'ego-settings',
  defaults: {
    quickAddHotkey: 'Alt+N',
    toolPaletteHotkey: 'Alt+S',
    trelloApiKey: seed.trelloApiKey,
    trelloToken: seed.trelloToken,
    trelloBoardId: seed.trelloBoardId,
    trelloListId: seed.trelloListId,
    quickAddListShortcuts: [],
    moneyApiUrl: '',
    moneyDeviceTokenEncrypted: '',
    openRouterApiKeyEncrypted: '',
    transactionImageModel: 'openai/gpt-5.6-terra',
    t3Origin: '',
    t3TokenEncrypted: '',
    t3TokenExpiresAt: 0,
    t3NotifyEnabled: true,
    livePreferences: DEFAULT_LIVE_PREFERENCES,
    account: null,
    preferences: {}
  }
})

/** A build can carry the Worker address, so a fresh install needs only the sign-in button. */
const BUILD_API_URL = (import.meta.env.MAIN_VITE_EGO_API_URL ?? '').trim().replace(/\/+$/, '')

function encrypt(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return ''
  return safeStorage.encryptString(value).toString('base64')
}

function decrypt(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

export function getLedgerConfig(): { url: string; hasToken: boolean } {
  return { url: store.get('moneyApiUrl') || BUILD_API_URL, hasToken: Boolean(store.get('moneyDeviceTokenEncrypted')) }
}

export function getLedgerToken(): string {
  return decrypt(store.get('moneyDeviceTokenEncrypted'))
}

export function setLedgerConfig(input: { url: string; token?: string }): void {
  store.set('moneyApiUrl', input.url.trim())
  if (input.token !== undefined) {
    store.set('moneyDeviceTokenEncrypted', input.token.length > 0 ? encrypt(input.token) : '')
  }
}

export function getAccount(): SignedInAccount | null {
  return store.get('account')
}

export function setAccount(account: SignedInAccount | null): void {
  store.set('account', account)
}

const PREFERENCE_KEY = /^ego\.[a-z0-9.-]{1,64}$/i
const PREFERENCE_LIMIT = 64 * 1024

export function getPreference(key: string): string | null {
  if (!PREFERENCE_KEY.test(key)) return null
  return store.get('preferences')[key] ?? null
}

export function setPreference(key: string, value: string | null): void {
  if (!PREFERENCE_KEY.test(key)) return
  const next = { ...store.get('preferences') }
  if (value === null) delete next[key]
  else if (value.length <= PREFERENCE_LIMIT) next[key] = value
  else return
  store.set('preferences', next)
}

export function getLivePreferences(): LivePreferences {
  const preferences = store.get('livePreferences')
  return isLivePreferences(preferences) ? preferences : { ...DEFAULT_LIVE_PREFERENCES }
}

export function setLivePreferences(preferences: LivePreferences): LivePreferences {
  if (!isLivePreferences(preferences)) return getLivePreferences()
  const next = { ...preferences, customInstructions: preferences.customInstructions.trim() }
  store.set('livePreferences', next)
  return next
}

export function getTransactionImageSettings(): { hasApiKey: boolean; model: string } {
  return {
    hasApiKey: Boolean(decrypt(store.get('openRouterApiKeyEncrypted'))),
    model: store.get('transactionImageModel')
  }
}

export function getOpenRouterApiKey(): string {
  return decrypt(store.get('openRouterApiKeyEncrypted'))
}

export function setTransactionImageSettings(input: { apiKey?: string; model: string }): void {
  if (!input || typeof input.model !== 'string' || !input.model.trim()) return
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    store.set('openRouterApiKeyEncrypted', encrypt(input.apiKey.trim()))
  }
  store.set('transactionImageModel', input.model.trim())
}

export function getT3Session(): T3Session | null {
  const origin = store.get('t3Origin')
  const token = decrypt(store.get('t3TokenEncrypted'))
  if (!origin || !token) return null
  return { origin, token, expiresAt: store.get('t3TokenExpiresAt') }
}

export function setT3Session(session: T3Session | null): void {
  store.set('t3Origin', session?.origin ?? '')
  store.set('t3TokenEncrypted', session ? encrypt(session.token) : '')
  store.set('t3TokenExpiresAt', session?.expiresAt ?? 0)
}

export function getT3NotifyEnabled(): boolean {
  return store.get('t3NotifyEnabled')
}

export function setT3NotifyEnabled(enabled: boolean): void {
  store.set('t3NotifyEnabled', enabled)
}

export function getQuickAddHotkey(): string {
  return store.get('quickAddHotkey')
}

export function setQuickAddHotkey(hotkey: string): void {
  store.set('quickAddHotkey', hotkey)
}

export function getToolPaletteHotkey(): string {
  return store.get('toolPaletteHotkey')
}

export function setToolPaletteHotkey(hotkey: string): void {
  store.set('toolPaletteHotkey', hotkey)
}

export function getTrelloApiKey(): string {
  return store.get('trelloApiKey')
}

export function setTrelloApiKey(value: string): void {
  store.set('trelloApiKey', value)
}

export function getTrelloToken(): string {
  return store.get('trelloToken')
}

export function setTrelloToken(value: string): void {
  store.set('trelloToken', value)
}

export function getTrelloBoardId(): string {
  return store.get('trelloBoardId')
}

export function setTrelloBoardId(value: string): void {
  store.set('trelloBoardId', value)
}

export function getTrelloListId(): string {
  return store.get('trelloListId')
}

export function setTrelloListId(value: string): void {
  store.set('trelloListId', value)
}

export function getQuickAddListShortcuts(): QuickAddListShortcut[] {
  return store.get('quickAddListShortcuts')
}

export function setQuickAddListShortcuts(shortcuts: QuickAddListShortcut[]): void {
  store.set('quickAddListShortcuts', shortcuts)
}
