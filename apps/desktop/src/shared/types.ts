export type {
  ListShortcut as QuickAddListShortcut,
  TrelloBoardSummary,
  TrelloListSummary,
  TrelloResult
} from '@ego/core'

import type { ListShortcut, TrelloBoardSummary, TrelloListSummary, TrelloResult } from '@ego/core'
import type {
  AccountInput,
  ArchiveInput,
  BudgetInput,
  CategoryInput,
  MoneyResult,
  MoneySnapshot,
  PurchaseInput,
  TransactionImageAnalysisResult,
  TransactionInput,
  LivePreferences
} from '@ego/core'
import type {
  ConnectorStatus,
  LiveToolExecuteRequest,
  LiveToolExecuteResult
} from '@ego/api-contracts'
import type { SqlParam, SqlResult } from '@ego/local/database/types'
import type {
  LedgerEvent, LedgerState, MediaFileInput, MediaOpenInput, MediaPathInput, MediaProgress, NotifyInput, RemoteApi, RemoteApiMethod, SignInOutcome, StagedMedia
} from './local'

export type {
  AccountInput,
  AnalyzedTransactionDraft,
  AccountKind,
  BudgetAllocation,
  BudgetAllocationInput,
  BudgetInput,
  BudgetState,
  BudgetSummary,
  CategoryBudgetStatus,
  CategoryInput,
  CategoryKind,
  DateRange,
  MoneyAccount,
  MoneyCategory,
  MoneyPurchase,
  MoneyResult,
  MoneySnapshot,
  MoneySyncConfigInput,
  MoneySyncStatus,
  MoneyTransaction,
  MonthlyBudget,
  PeriodPreset,
  PurchaseInput,
  ReceiptDraft,
  ReceiptItem,
  ReceiptItemInput,
  ImageAnalysisCategory,
  TransactionInput,
  TransactionKind,
  LivePreferences
} from '@ego/core'

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

export interface T3Status {
  paired: boolean
  origin: string
  enabled: boolean
  watching: boolean
  threadCount: number
  expiresAt: number | null
  expired: boolean
  lastError: string | null
}

export type T3PairResult =
  | { ok: true; origin: string; expiresAt: number }
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

export interface IpcApi {
  localAll: (transaction: number | null, sql: string, params: SqlParam[]) => Promise<Record<string, unknown>[]>
  localRun: (transaction: number | null, sql: string, params: SqlParam[]) => Promise<SqlResult>
  localBegin: () => Promise<number>
  localFinish: (transaction: number, commit: boolean) => Promise<void>
  ledgerState: () => Promise<LedgerState>
  ledgerSync: () => Promise<LedgerState>
  onLedgerEvent: (callback: (event: LedgerEvent) => void) => () => void
  apiCall: <K extends RemoteApiMethod>(method: K, ...args: Parameters<RemoteApi[K]>) => ReturnType<RemoteApi[K]>
  signInWithGoogle: (apiUrl: string) => Promise<SignInOutcome>
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
  moneyGetSnapshot: () => Promise<MoneyResult<MoneySnapshot>>
  moneyCreateAccount: (input: AccountInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyUpdateAccount: (id: string, input: AccountInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyArchiveAccount: (id: string, input: ArchiveInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyCreateCategory: (input: CategoryInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyUpdateCategory: (id: string, input: CategoryInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyArchiveCategory: (id: string, input: ArchiveInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyCreateTransaction: (input: TransactionInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyUpdateTransaction: (id: string, input: TransactionInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyDeleteTransaction: (id: string) => Promise<MoneyResult<MoneySnapshot>>
  moneySaveBudget: (input: BudgetInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyDeleteBudget: (month: string) => Promise<MoneyResult<MoneySnapshot>>
  moneyCreatePurchase: (input: PurchaseInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyUpdatePurchase: (id: string, input: PurchaseInput) => Promise<MoneyResult<MoneySnapshot>>
  moneyDeletePurchase: (id: string) => Promise<MoneyResult<MoneySnapshot>>
  getTransactionImageSettings: () => Promise<TransactionImageSettings>
  setTransactionImageSettings: (input: TransactionImageSettingsInput) => Promise<TransactionImageSettings>
  analyzeTransactionImage: (input: DesktopTransactionImageInput) => Promise<TransactionImageAnalysisResult>

  t3GetStatus: () => Promise<T3Status>
  t3Pair: (pairingUrl: string) => Promise<T3PairResult>
  t3Unpair: () => Promise<T3Status>
  t3SetEnabled: (enabled: boolean) => Promise<T3Status>

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
