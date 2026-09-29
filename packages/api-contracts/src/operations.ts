import {
  isAccountInput, isBudgetInput, isCategoryInput, isDateString, isDiaryMessageInput, isGymCategoryInput,
  isGymExerciseInput, isGymSetInput, isGymWorkoutInput, isHabitEntryInput, isHabitInput, isMonthString,
  isMoodInput, isPurchaseInput, isTransactionInput,
  type AccountInput, type ArchiveInput, type BudgetInput, type CategoryInput, type DiaryMessageInput,
  type GymCategoryInput, type GymExerciseInput, type GymSetInput, type GymWorkoutInput, type HabitEntryInput,
  type HabitInput, type MoodInput, type PurchaseInput, type TransactionInput
} from '@ego/core'
import type { ApiError } from './errors'
import type { SyncEntity } from './records'

export type SyncCommand =
  | { entity: 'account'; type: 'create'; payload: AccountInput }
  | { entity: 'account'; type: 'update'; payload: AccountInput }
  | { entity: 'account'; type: 'archive'; payload: ArchiveInput }
  | { entity: 'category'; type: 'create'; payload: CategoryInput }
  | { entity: 'category'; type: 'update'; payload: CategoryInput }
  | { entity: 'category'; type: 'archive'; payload: ArchiveInput }
  | { entity: 'transaction'; type: 'create'; payload: TransactionInput }
  | { entity: 'transaction'; type: 'update'; payload: TransactionInput }
  | { entity: 'transaction'; type: 'delete' }
  | { entity: 'purchase'; type: 'create'; payload: PurchaseInput }
  | { entity: 'purchase'; type: 'update'; payload: PurchaseInput }
  | { entity: 'purchase'; type: 'delete' }
  | { entity: 'budget'; type: 'save'; payload: BudgetInput }
  | { entity: 'budget'; type: 'delete' }
  | { entity: 'gymCategory'; type: 'create'; payload: GymCategoryInput }
  | { entity: 'gymCategory'; type: 'update'; payload: GymCategoryInput }
  | { entity: 'gymCategory'; type: 'delete' }
  | { entity: 'gymExercise'; type: 'create'; payload: GymExerciseInput }
  | { entity: 'gymExercise'; type: 'update'; payload: GymExerciseInput }
  | { entity: 'gymExercise'; type: 'delete' }
  | { entity: 'gymSet'; type: 'create'; payload: GymSetInput }
  | { entity: 'gymSet'; type: 'update'; payload: GymSetInput }
  | { entity: 'gymSet'; type: 'delete' }
  | { entity: 'gymWorkout'; type: 'save'; payload: GymWorkoutInput }
  | { entity: 'mood'; type: 'save'; payload: MoodInput }
  | { entity: 'mood'; type: 'delete' }
  | { entity: 'habit'; type: 'create'; payload: HabitInput }
  | { entity: 'habit'; type: 'update'; payload: HabitInput }
  | { entity: 'habit'; type: 'delete' }
  | { entity: 'habitEntry'; type: 'create'; payload: HabitEntryInput }
  | { entity: 'habitEntry'; type: 'delete' }
  | { entity: 'diaryMessage'; type: 'create'; payload: DiaryMessageInput }
  | { entity: 'diaryMessage'; type: 'update'; payload: DiaryMessageInput }
  | { entity: 'diaryMessage'; type: 'delete' }

/**
 * The device generates `operationId` and `entityId` once and reuses them on every retry,
 * so a lost response never creates a second transaction.
 */
export interface SyncOperation {
  operationId: string
  entityId: string
  expectedRevision: number | null
  createdAt: string
  command: SyncCommand
}

export interface OperationOutcome {
  operationId: string
  status: 'applied' | 'duplicate'
  entity: SyncEntity
  entityId: string
  revision: number
  serverSequence: number
}

export interface OperationRequest {
  operations: SyncOperation[]
}

export interface OperationFailure {
  operationId: string
  error: ApiError
}

/** Delivery stops at the first failure so dependent operations keep their order. */
export interface OperationResponse {
  results: OperationOutcome[]
  failed: OperationFailure | null
  serverSequence: number
}

export const MAX_OPERATIONS_PER_REQUEST = 25

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isArchiveInput(value: unknown): value is ArchiveInput {
  return isRecord(value) && typeof value.archived === 'boolean'
}

function isCommand(value: unknown): value is SyncCommand {
  if (!isRecord(value) || typeof value.entity !== 'string' || typeof value.type !== 'string') return false
  const payload = value.payload
  switch (`${value.entity}.${value.type}`) {
    case 'account.create':
    case 'account.update':
      return isAccountInput(payload)
    case 'account.archive':
    case 'category.archive':
      return isArchiveInput(payload)
    case 'category.create':
    case 'category.update':
      return isCategoryInput(payload)
    case 'transaction.create':
    case 'transaction.update':
      return isTransactionInput(payload)
    case 'purchase.create':
    case 'purchase.update':
      return isPurchaseInput(payload)
    case 'budget.save':
      return isBudgetInput(payload)
    case 'gymCategory.create':
    case 'gymCategory.update':
      return isGymCategoryInput(payload)
    case 'gymExercise.create':
    case 'gymExercise.update':
      return isGymExerciseInput(payload)
    case 'gymSet.create':
    case 'gymSet.update':
      return isGymSetInput(payload)
    case 'gymWorkout.save':
      return isGymWorkoutInput(payload)
    case 'mood.save':
      return isMoodInput(payload)
    case 'habit.create':
    case 'habit.update':
      return isHabitInput(payload)
    case 'habitEntry.create':
      return isHabitEntryInput(payload)
    case 'diaryMessage.create':
    case 'diaryMessage.update':
      return isDiaryMessageInput(payload)
    case 'transaction.delete':
    case 'purchase.delete':
    case 'budget.delete':
    case 'gymCategory.delete':
    case 'gymExercise.delete':
    case 'gymSet.delete':
    case 'mood.delete':
    case 'habit.delete':
    case 'habitEntry.delete':
    case 'diaryMessage.delete':
      return payload === undefined
    default:
      return false
  }
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

export function isSyncOperation(value: unknown): value is SyncOperation {
  if (!isRecord(value)) return false
  if (!isIdentifier(value.operationId) || !isIdentifier(value.entityId)) return false
  if (value.expectedRevision !== null &&
    (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1)) return false
  if (typeof value.createdAt !== 'string' || value.createdAt.length === 0 || value.createdAt.length > 40) return false
  if (!isCommand(value.command)) return false
  if (value.command.entity === 'budget' && !isMonthString(value.entityId)) return false
  if (value.command.entity === 'gymWorkout' &&
    (!isDateString(value.entityId) || value.command.payload.date !== value.entityId)) return false
  if (value.command.entity === 'mood' && (!isDateString(value.entityId) ||
    (value.command.type === 'save' && value.command.payload.date !== value.entityId))) return false
  const type = value.command.type
  if (type === 'create' && value.expectedRevision !== null) return false
  if (type !== 'create' && type !== 'save' && value.expectedRevision === null) return false
  return true
}

export function isOperationRequest(value: unknown): value is OperationRequest {
  return isRecord(value) && Array.isArray(value.operations) &&
    value.operations.length > 0 && value.operations.length <= MAX_OPERATIONS_PER_REQUEST &&
    value.operations.every(isSyncOperation)
}
