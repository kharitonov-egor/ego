import { contextBridge, ipcRenderer } from 'electron'
import type {
  BuildStage,
  IpcApi,
  QuickAddListShortcut,
  QuickAddPayload
} from '../shared/types'

const api: IpcApi = {
  moneyGetSyncStatus: () => ipcRenderer.invoke('money-get-sync-status'),
  moneySetSyncConfig: (input) => ipcRenderer.invoke('money-set-sync-config', input),
  moneyTestConnection: () => ipcRenderer.invoke('money-test-connection'),
  moneyGetSnapshot: () => ipcRenderer.invoke('money-get-snapshot'),
  moneyCreateAccount: (input) => ipcRenderer.invoke('money-create-account', input),
  moneyUpdateAccount: (id, input) => ipcRenderer.invoke('money-update-account', id, input),
  moneyArchiveAccount: (id, input) => ipcRenderer.invoke('money-archive-account', id, input),
  moneyCreateCategory: (input) => ipcRenderer.invoke('money-create-category', input),
  moneyUpdateCategory: (id, input) => ipcRenderer.invoke('money-update-category', id, input),
  moneyArchiveCategory: (id, input) => ipcRenderer.invoke('money-archive-category', id, input),
  moneyCreateTransaction: (input) => ipcRenderer.invoke('money-create-transaction', input),
  moneyUpdateTransaction: (id, input) => ipcRenderer.invoke('money-update-transaction', id, input),
  moneyDeleteTransaction: (id) => ipcRenderer.invoke('money-delete-transaction', id),

  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),

  getQuickAddHotkey: () => ipcRenderer.invoke('get-quick-add-hotkey'),
  setQuickAddHotkey: (hotkey: string) => ipcRenderer.invoke('set-quick-add-hotkey', hotkey),

  getTrelloApiKey: () => ipcRenderer.invoke('get-trello-api-key'),
  setTrelloApiKey: (value: string) => ipcRenderer.invoke('set-trello-api-key', value),
  getTrelloToken: () => ipcRenderer.invoke('get-trello-token'),
  setTrelloToken: (value: string) => ipcRenderer.invoke('set-trello-token', value),
  getTrelloBoardId: () => ipcRenderer.invoke('get-trello-board-id'),
  setTrelloBoardId: (value: string) => ipcRenderer.invoke('set-trello-board-id', value),
  getTrelloListId: () => ipcRenderer.invoke('get-trello-list-id'),
  setTrelloListId: (value: string) => ipcRenderer.invoke('set-trello-list-id', value),
  listTrelloBoards: () => ipcRenderer.invoke('trello-list-boards'),
  listTrelloLists: (boardId: string) => ipcRenderer.invoke('trello-list-lists', boardId),

  getQuickAddListShortcuts: () => ipcRenderer.invoke('get-quick-add-list-shortcuts'),
  setQuickAddListShortcuts: (shortcuts: QuickAddListShortcut[]) =>
    ipcRenderer.invoke('set-quick-add-list-shortcuts', shortcuts),

  submitQuickAdd: (payload: QuickAddPayload) => ipcRenderer.invoke('quick-add-submit', payload),
  cancelQuickAdd: () => ipcRenderer.send('quick-add-cancel'),
  setQuickAddPreview: (expanded: boolean, aspectRatio?: number) =>
    ipcRenderer.send('quick-add-set-preview', expanded, aspectRatio),
  onQuickAddFocus: (callback: (shortcuts: QuickAddListShortcut[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, shortcuts: QuickAddListShortcut[]) =>
      callback(shortcuts ?? [])
    ipcRenderer.on('quick-add-focus', handler)
    return () => ipcRenderer.removeListener('quick-add-focus', handler)
  },

  buildAndInstall: () => ipcRenderer.invoke('build-and-install'),
  onBuildProgress: (callback: (stage: BuildStage) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, stage: BuildStage) => callback(stage)
    ipcRenderer.on('build-progress', handler)
    return () => ipcRenderer.removeListener('build-progress', handler)
  },

  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', url),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close')
}

contextBridge.exposeInMainWorld('api', api)
