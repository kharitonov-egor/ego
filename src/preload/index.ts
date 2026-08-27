import { contextBridge, ipcRenderer } from 'electron'
import type {
  BuildStage,
  IpcApi,
  QuickAddListShortcut,
  QuickAddPayload
} from '../shared/types'

const api: IpcApi = {
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),

  getQuickAddHotkey: () => ipcRenderer.invoke('get-quick-add-hotkey'),
  setQuickAddHotkey: (hotkey: string) => ipcRenderer.invoke('set-quick-add-hotkey', hotkey),

  getWebhookUrl: () => ipcRenderer.invoke('get-webhook-url'),
  setWebhookUrl: (url: string) => ipcRenderer.invoke('set-webhook-url', url),
  getWebhookEnabled: () => ipcRenderer.invoke('get-webhook-enabled'),
  setWebhookEnabled: (enabled: boolean) => ipcRenderer.invoke('set-webhook-enabled', enabled),

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
