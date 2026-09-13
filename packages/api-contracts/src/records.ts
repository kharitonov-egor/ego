import type {
  MoneyAccount, MoneyCategory, MoneyPurchase, MoneyTransaction, MonthlyBudget, TransactionKind
} from '@ego/core'

export const API_VERSION = 1
export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100
export const MAX_CHANGE_PAGE_SIZE = 200

export type AccountRecord = Omit<MoneyAccount, 'balanceCents'> & { revision: number }
export type CategoryRecord = MoneyCategory & { revision: number }
export type TransactionRecord = MoneyTransaction & { revision: number }
export type PurchaseRecord = MoneyPurchase & { revision: number }
export type BudgetRecord = MonthlyBudget & { revision: number }

export interface ReferenceData {
  accounts: AccountRecord[]
  categories: CategoryRecord[]
  serverSequence: number
}

/** A feed row carries the labels Activity renders, never receipt item arrays. */
export interface FeedTransaction extends TransactionRecord {
  accountName: string
  destinationAccountName: string | null
  categoryName: string | null
  categoryIcon: string | null
  categoryColor: string | null
  merchant: string | null
  purchaseId: string | null
  hasReceipt: boolean
}

export interface TransactionPage {
  items: FeedTransaction[]
  nextCursor: string | null
  hasMore: boolean
  totalCount: number
  queryIdentity: string
}

export interface TransactionDetail {
  transaction: FeedTransaction
  purchase: PurchaseRecord | null
}

export interface ReceiptDetail {
  purchase: PurchaseRecord
}

export interface AccountBalance {
  accountId: string
  balanceCents: number
}

export interface AccountBalances {
  balances: AccountBalance[]
  serverSequence: number
}

export interface PeriodSummary {
  from: string | null
  to: string | null
  incomeCents: number
  expenseCents: number
  netCents: number
  transferCents: number
  plannedIncomeCents: number
  allocatedCents: number
}

export type ChangeAction = 'upsert' | 'delete'
export type SyncEntity = 'account' | 'category' | 'transaction' | 'purchase' | 'budget'

interface ChangeBase {
  seq: number
  entityId: string
  action: ChangeAction
  revision: number
  committedAt: string
}

/** A delete carries a null record, so an offline device learns about tombstones. */
export type ChangePayload =
  | { entity: 'account'; record: AccountRecord | null }
  | { entity: 'category'; record: CategoryRecord | null }
  | { entity: 'transaction'; record: TransactionRecord | null }
  | { entity: 'purchase'; record: PurchaseRecord | null }
  | { entity: 'budget'; record: BudgetRecord | null }

export type ChangeRecord = ChangeBase & ChangePayload

export interface ChangePage {
  changes: ChangeRecord[]
  cursor: number
  hasMore: boolean
}

export interface DeviceIdentity {
  deviceId: string
  name: string
  datasetId: string
}

export type TransactionKindFilter = TransactionKind
