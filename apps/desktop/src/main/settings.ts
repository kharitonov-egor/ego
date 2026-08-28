import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { QuickAddListShortcut } from '../shared/types'
import { parseCachedSnapshot, type MoneySnapshot, type MoneySyncConfigInput, type MoneySyncStatus } from '@ego/core'

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
  openRouterApiKeyEncrypted: string
  transactionImageModel: string
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
    openRouterApiKeyEncrypted: '',
    transactionImageModel: 'openai/gpt-5.6-terra'
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

