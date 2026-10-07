export type {
  ListShortcut as QuickAddListShortcut,
  TrelloBoardSummary,
  TrelloListSummary,
  TrelloResult
} from '@ego/core'

import type { ListShortcut, TrelloBoardSummary, TrelloListSummary, TrelloResult } from '@ego/core'
import type {
  TransactionImageAnalysisResult,
  LivePreferences
} from '@ego/core'
import type {
  ApiResult,
  ConnectorStatus,
  LiveToolExecuteRequest,
  LiveToolExecuteResult,
  WebPushSubscriptionInput
} from '@ego/api-contracts'
import type { SqlParam, SqlResult } from '@ego/local/database/types'
import type {
  AssistantStreamKind, AssistantStreamMessage, AssistantStreamRequests, LedgerEvent, LedgerState, MediaFileInput,
  MediaOpenInput, MediaPathInput, MediaProgress, NotifyInput, RemoteApi, RemoteApiMethod, SignInOutcome, StagedMedia
} from './local'

export type { LivePreferences } from '@ego/core'

export type BuildStage = 'compiling' | 'packaging' | 'installing' | 'done' | 'error'

export interface BuildResult {
  success: boolean
  error?: string
}

export interface QuickAddImage {
  name: string
  mimeType: string
  data: ArrayBuffer
}

export interface QuickAddPayload {
  title: string
  description: string
  images: QuickAddImage[]
  listId?: string
}

export interface QuickAddResult {
  ok: boolean
  detail?: string
}

export interface TransactionImageSettings {
  hasApiKey: boolean
  model: string
}

export interface TransactionImageSettingsInput {
  apiKey?: string
  model: string
}

export interface DesktopTransactionImageInput {
  base64: string
  mimeType: string
  categories: import('@ego/core').ImageAnalysisCategory[]
}

export type OcrResult =
  | { ok: true; text: string }
  | { ok: false; detail: string }

export interface MediaDownloaderStatus {
  available: boolean
  version?: string
  ffmpegAvailable: boolean
}

export interface MediaDownloadInput {
  url: string
  format: 'video' | 'audio'
}

export type MediaDownloadResult =
  | { ok: true; outputDirectory: string; savedFile?: string }
  | { ok: false; detail: string }

export interface LedgerConfig {
  url: string
  hasToken: boolean
}

export type LiveCreateSessionResult =
  | { ok: true; sessionId: string; sdp: string }
  | { ok: false; code: string; message: string }

export type DesktopApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string }

export interface PushState {
  supported: boolean
  permission: 'default' | 'granted' | 'denied'
  /** Where the push service reaches this browser, or null while it is not subscribed. */
  endpoint: string | null
}

export type PushSubscribeResult =
  | { ok: true; subscription: WebPushSubscriptionInput }
  | { ok: false; message: string }

export interface SignInOptions {
  /** Web only: false keeps the copy and the token in this tab, gone when it closes. */
  remember?: boolean
}

export interface IpcApi {
  /** Which host runs the screens. The web hides what only the desktop app can do. */
  platform: 'desktop' | 'web'
  localAll: (transaction: number | null, sql: string, params: SqlParam[]) => Promise<Record<string, unknown>[]>
  localRun: (transaction: number | null, sql: string, params: SqlParam[]) => Promise<SqlResult>
  localBegin: () => Promise<number>
  localFinish: (transaction: number, commit: boolean) => Promise<void>
  ledgerState: () => Promise<LedgerState>
  ledgerSync: () => Promise<LedgerState>
  onLedgerEvent: (callback: (event: LedgerEvent) => void) => () => void
  apiCall: <K extends RemoteApiMethod>(method: K, ...args: Parameters<RemoteApi[K]>) => ReturnType<RemoteApi[K]>
  /** A streamed assistant turn or confirmation. Its events arrive on `onAssistantEvent` under `streamId`. */
  assistantStream: <K extends AssistantStreamKind>(streamId: string, kind: K, request: AssistantStreamRequests[K]) => Promise<ApiResult<{ done: true }>>
  onAssistantEvent: (callback: (message: AssistantStreamMessage) => void) => () => void
  signInWithGoogle: (apiUrl: string, options?: SignInOptions) => Promise<SignInOutcome>
  signInWithToken: (apiUrl: string, token: string) => Promise<SignInOutcome>
  signOut: () => Promise<void>
  onSignInFinished: (callback: (outcome: SignInOutcome) => void) => () => void
  mediaStage: (input: MediaFileInput) => Promise<StagedMedia>
  mediaStageFile: (input: MediaPathInput) => Promise<StagedMedia>
  mediaDeleteStaged: (paths: string[]) => Promise<void>
  /** Resolves with why the file did not open, or null once Windows has it. */
  mediaOpen: (input: MediaOpenInput) => Promise<string | null>
  onMediaProgress: (callback: (progress: MediaProgress) => void) => () => void
  /** The path of a dropped or picked file, so a large video goes to the main process by name, not by bytes. */
  pathForFile: (file: File) => string
  notify: (input: NotifyInput) => void
  /** Web Push for the agent's notifications. The desktop shows them from the tray instead. */
  pushState: () => Promise<PushState>
  /** Asks for notification permission first, so call it straight from a click. */
  pushSubscribe: (publicKey: string) => Promise<PushSubscribeResult>
  /** Resolves with the endpoint it dropped, for the Worker to forget, or null when there was none. */
  pushUnsubscribe: () => Promise<string | null>
  /** A notification click or a sign-in link asks the window to open a page. */
  onNavigate: (callback: (route: string) => void) => () => void
  preferenceGet: (key: string) => Promise<string | null>
  preferenceSet: (key: string, value: string | null) => Promise<void>

  moneyGetLedgerConfig: () => Promise<LedgerConfig>
  liveCreateSession: (sdp: string) => Promise<LiveCreateSessionResult>
  liveExecuteTool: (input: LiveToolExecuteRequest) => Promise<DesktopApiResult<LiveToolExecuteResult>>
  connectorGetStatus: (provider: 'google' | 'wispr') => Promise<DesktopApiResult<ConnectorStatus>>
  connectorStartGoogle: () => Promise<DesktopApiResult<{ authorizationUrl: string; expiresAt: string }>>
  connectorStartWispr: (serverUrl: string) => Promise<DesktopApiResult<{ authorizationUrl: string; expiresAt: string }>>
  connectorDisconnect: (provider: 'google' | 'wispr') => Promise<DesktopApiResult<{ disconnected: true }>>
  onLiveSessionStopRequested: (callback: () => void) => () => void
  getLivePreferences: () => Promise<LivePreferences>
  setLivePreferences: (preferences: LivePreferences) => Promise<LivePreferences>
  getTransactionImageSettings: () => Promise<TransactionImageSettings>
  setTransactionImageSettings: (input: TransactionImageSettingsInput) => Promise<TransactionImageSettings>
  analyzeTransactionImage: (input: DesktopTransactionImageInput) => Promise<TransactionImageAnalysisResult>

  getAutoStart: () => Promise<boolean>
  setAutoStart: (enabled: boolean) => Promise<void>

  getQuickAddHotkey: () => Promise<string>
  setQuickAddHotkey: (hotkey: string) => Promise<void>
  getToolPaletteHotkey: () => Promise<string>
  setToolPaletteHotkey: (hotkey: string) => Promise<void>

  getTrelloApiKey: () => Promise<string>
  setTrelloApiKey: (value: string) => Promise<void>
  getTrelloToken: () => Promise<string>
  setTrelloToken: (value: string) => Promise<void>
  getTrelloBoardId: () => Promise<string>
  setTrelloBoardId: (value: string) => Promise<void>
  getTrelloListId: () => Promise<string>
  setTrelloListId: (value: string) => Promise<void>
  listTrelloBoards: () => Promise<TrelloResult<TrelloBoardSummary[]>>
  listTrelloLists: (boardId: string) => Promise<TrelloResult<TrelloListSummary[]>>

  getQuickAddListShortcuts: () => Promise<ListShortcut[]>
  setQuickAddListShortcuts: (shortcuts: ListShortcut[]) => Promise<void>

  resizeNotification: (height: number) => void

  submitQuickAdd: (payload: QuickAddPayload) => Promise<QuickAddResult>
  cancelQuickAdd: () => void
  setQuickAddPreview: (expanded: boolean, aspectRatio?: number) => void
  onQuickAddFocus: (callback: (shortcuts: ListShortcut[]) => void) => () => void

  hideToolPalette: () => void
  openClaude: () => Promise<void>
  ocrClipboardImage: () => Promise<OcrResult>
  ocrImageFile: () => Promise<OcrResult>
  copyToolText: (text: string) => Promise<void>
  getMediaDownloaderStatus: () => Promise<MediaDownloaderStatus>
  downloadMedia: (input: MediaDownloadInput) => Promise<MediaDownloadResult>
  openMediaDownloads: (savedFile?: string) => Promise<void>
  onToolPaletteFocus: (callback: (clipboardText: string) => void) => () => void
  onMediaDownloadProgress: (callback: (line: string) => void) => () => void

  buildAndInstall: () => Promise<BuildResult>
  onBuildProgress: (callback: (stage: BuildStage) => void) => () => void

  openExternalUrl: (url: string) => Promise<void>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
}
