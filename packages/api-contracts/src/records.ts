import type {
  DiaryMessage, GymCategory, GymExercise, GymSet, GymWorkout, Habit, HabitEntry, MoneyAccount, MoneyCategory,
  MoneyPurchase, MoneyTransaction, MonthlyBudget, MoodEntry, TransactionKind
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
export type GymCategoryRecord = GymCategory & { revision: number }
export type GymExerciseRecord = GymExercise & { revision: number }
export type GymSetRecord = GymSet & { revision: number }
export type GymWorkoutRecord = GymWorkout & { revision: number }
export type MoodRecord = MoodEntry & { revision: number }
export type HabitRecord = Habit & { revision: number }
export type HabitEntryRecord = HabitEntry & { revision: number }
export type DiaryMessageRecord = DiaryMessage & { revision: number }

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

/** Every live record in one response, read after the sequence it is current as of. */
export interface BootstrapData {
  serverSequence: number
  accounts: AccountRecord[]
  categories: CategoryRecord[]
  transactions: TransactionRecord[]
  purchases: PurchaseRecord[]
  budgets: BudgetRecord[]
  gymCategories: GymCategoryRecord[]
  gymExercises: GymExerciseRecord[]
  gymSets: GymSetRecord[]
  gymWorkouts: GymWorkoutRecord[]
  moods: MoodRecord[]
  habits: HabitRecord[]
  habitEntries: HabitEntryRecord[]
  diaryMessages: DiaryMessageRecord[]
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
export type MoneyEntity = 'account' | 'category' | 'transaction' | 'purchase' | 'budget'
export type GymEntity = 'gymCategory' | 'gymExercise' | 'gymSet' | 'gymWorkout'
export type HealthEntity = 'mood'
export type HabitEntity = 'habit' | 'habitEntry'
export type DiaryEntity = 'diaryMessage'
export type SyncEntity = MoneyEntity | GymEntity | HealthEntity | HabitEntity | DiaryEntity

export const GYM_ENTITIES: readonly GymEntity[] = ['gymCategory', 'gymExercise', 'gymSet', 'gymWorkout']

export function isGymEntity(entity: SyncEntity): entity is GymEntity {
  return (GYM_ENTITIES as readonly string[]).includes(entity)
}

export function isHealthEntity(entity: SyncEntity): entity is HealthEntity {
  return entity === 'mood'
}

export function isHabitEntity(entity: SyncEntity): entity is HabitEntity {
  return entity === 'habit' || entity === 'habitEntry'
}

export function isDiaryEntity(entity: SyncEntity): entity is DiaryEntity {
  return entity === 'diaryMessage'
}

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
  | { entity: 'gymCategory'; record: GymCategoryRecord | null }
  | { entity: 'gymExercise'; record: GymExerciseRecord | null }
  | { entity: 'gymSet'; record: GymSetRecord | null }
  | { entity: 'gymWorkout'; record: GymWorkoutRecord | null }
  | { entity: 'mood'; record: MoodRecord | null }
  | { entity: 'habit'; record: HabitRecord | null }
  | { entity: 'habitEntry'; record: HabitEntryRecord | null }
  | { entity: 'diaryMessage'; record: DiaryMessageRecord | null }

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
