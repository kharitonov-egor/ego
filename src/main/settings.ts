import Store from 'electron-store'
import type { QuickAddListShortcut } from '../shared/types'

interface AppSettings {
  quickAddHotkey: string
  trelloApiKey: string
  trelloToken: string
  trelloBoardId: string
  trelloListId: string
  quickAddListShortcuts: QuickAddListShortcut[]
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
    quickAddListShortcuts: []
  }
})

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

