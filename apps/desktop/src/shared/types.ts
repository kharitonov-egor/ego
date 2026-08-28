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
  CategoryInput,
  MoneyResult,
  MoneySnapshot,
  MoneySyncConfigInput,
  MoneySyncStatus,
  TransactionInput
} from '@ego/core'

export type {
  AccountInput,
  AccountKind,
  CategoryInput,
  CategoryKind,
  DateRange,
  MoneyAccount,
  MoneyCategory,
  MoneyResult,
  MoneySnapshot,
  MoneySyncConfigInput,
  MoneySyncStatus,
  MoneyTransaction,
  PeriodPreset,
  TransactionInput,
  TransactionKind
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

export interface IpcApi {
  moneyGetSyncStatus: () => Promise<MoneySyncStatus>
  moneySetSyncConfig: (input: MoneySyncConfigInput) => Promise<MoneyResult<{ connected: true }>>
  moneyTestConnection: () => Promise<MoneyResult<{ connected: true }>>
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

  getAutoStart: () => Promise<boolean>
  setAutoStart: (enabled: boolean) => Promise<void>

  getQuickAddHotkey: () => Promise<string>
  setQuickAddHotkey: (hotkey: string) => Promise<void>

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

  submitQuickAdd: (payload: QuickAddPayload) => Promise<QuickAddResult>
  cancelQuickAdd: () => void
  setQuickAddPreview: (expanded: boolean, aspectRatio?: number) => void
  onQuickAddFocus: (callback: (shortcuts: ListShortcut[]) => void) => () => void

  buildAndInstall: () => Promise<BuildResult>
  onBuildProgress: (callback: (stage: BuildStage) => void) => () => void

  openExternalUrl: (url: string) => Promise<void>
  windowMinimize: () => void
  windowMaximize: () => void
  windowClose: () => void
}
