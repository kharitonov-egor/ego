import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { QuickAddListShortcut } from '../shared/types'
import { parseCachedSnapshot, type MoneySnapshot, type MoneySyncConfigInput, type MoneySyncStatus, type T3Session } from '@ego/core'

interface AppSettings {
  quickAddHotkey: string
  trelloApiKey: string
  trelloToken: string
  trelloBoardId: string
  trelloListId: string
  quickAddListShortcuts: QuickAddListShortcut[]
  moneyAccountId: string
  moneyDatabaseId: string
  moneyApiTokenEncrypted: string
  moneyCacheEncrypted: string
  moneyApiUrl: string
  moneyDeviceTokenEncrypted: string
  openRouterApiKeyEncrypted: string
  transactionImageModel: string
  t3Origin: string
  t3TokenEncrypted: string
  t3TokenExpiresAt: number
  t3NotifyEnabled: boolean
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
    trelloApiKey: seed.trelloApiKey,
    trelloToken: seed.trelloToken,
    trelloBoardId: seed.trelloBoardId,
    trelloListId: seed.trelloListId,
    quickAddListShortcuts: [],
    moneyAccountId: '',
    moneyDatabaseId: '',
    moneyApiTokenEncrypted: '',
    moneyCacheEncrypted: '',
    moneyApiUrl: '',
    moneyDeviceTokenEncrypted: '',
    openRouterApiKeyEncrypted: '',
    transactionImageModel: 'openai/gpt-5.6-terra',
    t3Origin: '',
    t3TokenEncrypted: '',
    t3TokenExpiresAt: 0,
    t3NotifyEnabled: true
  }
})

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

export function getMoneySyncStatus(): MoneySyncStatus {
  const accountId = store.get('moneyAccountId')
  const databaseId = store.get('moneyDatabaseId')
  const hasApiToken = Boolean(decrypt(store.get('moneyApiTokenEncrypted')))
  return {
    configured: Boolean(accountId && databaseId && hasApiToken),
    accountId,
    databaseId,
    hasApiToken
  }
}

export function getMoneyApiToken(): string {
  return decrypt(store.get('moneyApiTokenEncrypted'))
}

export function setMoneySyncConfig(input: MoneySyncConfigInput): void {
  store.set('moneyAccountId', input.accountId.trim())
  store.set('moneyDatabaseId', input.databaseId.trim())
  if (input.apiToken !== undefined && input.apiToken.length > 0) {
    store.set('moneyApiTokenEncrypted', encrypt(input.apiToken))
  }
}

export function getLedgerConfig(): { url: string; hasToken: boolean } {
  return { url: store.get('moneyApiUrl'), hasToken: Boolean(store.get('moneyDeviceTokenEncrypted')) }
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

export function getMoneyCache(): MoneySnapshot | null {
  return parseCachedSnapshot(decrypt(store.get('moneyCacheEncrypted')))
}

export function setMoneyCache(snapshot: MoneySnapshot): void {
  store.set('moneyCacheEncrypted', encrypt(JSON.stringify(snapshot)))
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

