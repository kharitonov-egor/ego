import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  BuildStage,
  IpcApi,
  QuickAddListShortcut,
  QuickAddPayload
} from '@ego/ui/platform/types'
import type {
  AssistantStreamMessage, LedgerEvent, MediaProgress, RemoteApi, RemoteApiMethod, SignInOutcome
} from '@ego/ui/platform/local'

const api: IpcApi = {
  platform: 'desktop',
  localAll: (transaction, sql, params) => ipcRenderer.invoke('local-all', transaction, sql, params),
  localRun: (transaction, sql, params) => ipcRenderer.invoke('local-run', transaction, sql, params),
  localBegin: () => ipcRenderer.invoke('local-begin'),
  localFinish: (transaction, commit) => ipcRenderer.invoke('local-finish', transaction, commit),
  ledgerState: () => ipcRenderer.invoke('ledger-state'),
  ledgerSync: () => ipcRenderer.invoke('ledger-sync'),
  onLedgerEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, ledgerEvent: LedgerEvent): void => callback(ledgerEvent)
    ipcRenderer.on('ledger-event', handler)
    return () => ipcRenderer.removeListener('ledger-event', handler)
  },
  apiCall: <K extends RemoteApiMethod>(method: K, ...args: Parameters<RemoteApi[K]>) =>
    ipcRenderer.invoke('api-call', method, args) as ReturnType<RemoteApi[K]>,
  assistantStream: (streamId, kind, request) => ipcRenderer.invoke('assistant-stream', streamId, kind, request),
  onAssistantEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: AssistantStreamMessage): void => callback(message)
    ipcRenderer.on('assistant-event', handler)
    return () => ipcRenderer.removeListener('assistant-event', handler)
  },
  signInWithGoogle: (apiUrl) => ipcRenderer.invoke('auth-google', apiUrl),
  signInWithToken: (apiUrl, token) => ipcRenderer.invoke('auth-device-token', apiUrl, token),
  signOut: () => ipcRenderer.invoke('auth-sign-out'),
  onSignInFinished: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, outcome: SignInOutcome): void => callback(outcome)
    ipcRenderer.on('sign-in-finished', handler)
    return () => ipcRenderer.removeListener('sign-in-finished', handler)
  },
  mediaStage: (input) => ipcRenderer.invoke('media-stage', input),
  mediaStageFile: (input) => ipcRenderer.invoke('media-stage-file', input),
  mediaDeleteStaged: (paths) => ipcRenderer.invoke('media-delete-staged', paths),
  mediaOpen: (input) => ipcRenderer.invoke('media-open', input),
  onMediaProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: MediaProgress): void => callback(progress)
    ipcRenderer.on('media-progress', handler)
    return () => ipcRenderer.removeListener('media-progress', handler)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  notify: (input) => ipcRenderer.send('notify', input),
  pushState: async () => ({ supported: false, permission: 'default', endpoint: null }),
  pushSubscribe: async () => ({ ok: false, message: 'Ego on Windows shows notifications from the tray.' }),
  pushUnsubscribe: async () => null,
  onNavigate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, route: string): void => callback(route)
    ipcRenderer.on('navigate', handler)
    return () => ipcRenderer.removeListener('navigate', handler)
  },
  preferenceGet: (key) => ipcRenderer.invoke('preference-get', key),
  preferenceSet: (key, value) => ipcRenderer.invoke('preference-set', key, value),

  moneyGetLedgerConfig: () => ipcRenderer.invoke('money-get-ledger-config'),
  liveCreateSession: (sdp) => ipcRenderer.invoke('live-create-session', sdp),
  liveExecuteTool: (input) => ipcRenderer.invoke('live-execute-tool', input),
  connectorGetStatus: (provider) => ipcRenderer.invoke('connector-get-status', provider),
  connectorStartGoogle: () => ipcRenderer.invoke('connector-start-google'),
  connectorStartWispr: (serverUrl) => ipcRenderer.invoke('connector-start-wispr', serverUrl),
  connectorDisconnect: (provider) => ipcRenderer.invoke('connector-disconnect', provider),
  onLiveSessionStopRequested: (callback) => {
    const handler = (): void => callback()
    ipcRenderer.on('live-session-stop-requested', handler)
    return () => ipcRenderer.removeListener('live-session-stop-requested', handler)
  },
  getLivePreferences: () => ipcRenderer.invoke('live-get-preferences'),
  setLivePreferences: (preferences) => ipcRenderer.invoke('live-set-preferences', preferences),
  getTransactionImageSettings: () => ipcRenderer.invoke('transaction-image-get-settings'),
  setTransactionImageSettings: (input) => ipcRenderer.invoke('transaction-image-set-settings', input),
  analyzeTransactionImage: (input) => ipcRenderer.invoke('transaction-image-analyze', input),

  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled: boolean) => ipcRenderer.invoke('set-auto-start', enabled),

  getQuickAddHotkey: () => ipcRenderer.invoke('get-quick-add-hotkey'),
  setQuickAddHotkey: (hotkey: string) => ipcRenderer.invoke('set-quick-add-hotkey', hotkey),
  getToolPaletteHotkey: () => ipcRenderer.invoke('get-tool-palette-hotkey'),
  setToolPaletteHotkey: (hotkey: string) => ipcRenderer.invoke('set-tool-palette-hotkey', hotkey),

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

  resizeNotification: (height: number) => ipcRenderer.send('notification-resize', height),

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

  hideToolPalette: () => ipcRenderer.send('tool-palette-hide'),
  openClaude: () => ipcRenderer.invoke('tool-open-claude'),
  ocrClipboardImage: () => ipcRenderer.invoke('tool-ocr-clipboard'),
  ocrImageFile: () => ipcRenderer.invoke('tool-ocr-file'),
  copyToolText: (text: string) => ipcRenderer.invoke('tool-copy-text', text),
  getMediaDownloaderStatus: () => ipcRenderer.invoke('media-downloader-status'),
  downloadMedia: (input) => ipcRenderer.invoke('media-download', input),
  openMediaDownloads: (savedFile?: string) =>
    ipcRenderer.invoke('media-open-downloads', savedFile),
  onToolPaletteFocus: (callback: (clipboardText: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, clipboardText: string): void =>
      callback(clipboardText ?? '')
    ipcRenderer.on('tool-palette-focus', handler)
    return () => ipcRenderer.removeListener('tool-palette-focus', handler)
  },
  onMediaDownloadProgress: (callback: (line: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, line: string): void => callback(line)
    ipcRenderer.on('media-download-progress', handler)
    return () => ipcRenderer.removeListener('media-download-progress', handler)
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
