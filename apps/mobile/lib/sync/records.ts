import type {
  AccountRecord, BudgetRecord, CategoryRecord, DiaryMessageRecord, FoodEntryRecord, FoodGoalRecord, FridgeItemRecord,
  GymCategoryRecord, GymExerciseRecord, GymPlanRecord, GymSetRecord, GymWorkoutRecord, HabitEntryRecord, HabitRecord,
  MoodRecord, PurchaseRecord, SheetRecord, SheetRowRecord, TaskBoardRecord, TaskCardRecord, TaskGoalRecord, TaskLabelRecord,
  TaskListRecord, TransactionRecord
} from '@ego/api-contracts'
import {
  FOOD_GOAL_ID,
  type AccountInput, type BudgetInput, type CategoryInput, type DiaryMessageInput, type FoodEntryInput, type FoodGoalInput,
  type FridgeItemInput, type GymCategoryInput, type GymExerciseInput, type GymPlanInput, type GymSetInput,
  type GymWorkoutInput, type HabitEntryInput, type HabitInput, type MoodInput, type PurchaseInput, type ReceiptItem,
  type SheetInput, type SheetRowInput, type TaskBoardInput, type TaskCardInput, type TaskGoalInput, type TaskLabelInput,
  type TaskListInput, type TransactionInput
} from '@ego/core'

/**
 * The record a command produces. The device builds it so a saved transaction appears
 * immediately, and the server builds the same record from the same input.
 */
export function transactionRecordFrom(
  id: string, input: TransactionInput, createdAt: string, updatedAt: string, revision: number
): TransactionRecord {
  return {
    id,
    kind: input.kind,
    accountId: input.accountId,
    destinationAccountId: input.destinationAccountId,
    categoryId: input.categoryId,
    amountCents: input.amountCents,
    date: input.date,
    notes: input.notes.trim(),
    createdAt,
    updatedAt,
    revision
  }
}

export function accountRecordFrom(
  id: string, input: AccountInput, archivedAt: string | null, createdAt: string, updatedAt: string, revision: number
): AccountRecord {
  return {
    id,
    name: input.name.trim(),
    kind: input.kind,
    icon: input.icon,
    color: input.color,
    openingBalanceCents: input.openingBalanceCents,
    openingDate: input.openingDate,
    archivedAt,
    createdAt,
    updatedAt,
    revision
  }
}

export function categoryRecordFrom(
  id: string, input: CategoryInput, archivedAt: string | null, createdAt: string, updatedAt: string, revision: number
): CategoryRecord {
  return {
    id,
    name: input.name.trim(),
    kind: input.kind,
    icon: input.icon,
    color: input.color,
    archivedAt,
    createdAt,
    updatedAt,
    revision
  }
}

export function receiptTransactionIdFor(purchaseId: string): string {
  return `${purchaseId}-t`
}

export function receiptItemsFrom(purchaseId: string, input: PurchaseInput): ReceiptItem[] {
  return input.items.map((item, position) => ({
    id: `${purchaseId}-${position}`,
    purchaseId,
    position,
    name: item.name.trim(),
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    grossPriceCents: item.grossPriceCents,
    discountCents: item.discountCents,
    lineTotalCents: item.lineTotalCents
  }))
}

export function purchaseRecordFrom(
  id: string, transactionId: string, input: PurchaseInput, createdAt: string, updatedAt: string, revision: number
): PurchaseRecord {
  return {
    id,
    transactionId,
    merchant: input.merchant.trim(),
    purchaseDate: input.purchaseDate,
    currency: 'USD',
    subtotalCents: input.subtotalCents,
    discountCents: input.discountCents,
    taxCents: input.taxCents,
    feesCents: input.feesCents,
    totalCents: input.totalCents,
    items: receiptItemsFrom(id, input),
    createdAt,
    updatedAt,
    revision
  }
}

/** A receipt and its transaction are one command, never two unrelated writes. */
export function purchaseTransactionInput(input: PurchaseInput): TransactionInput {
  return {
    kind: 'expense',
    accountId: input.accountId,
    destinationAccountId: null,
    categoryId: input.categoryId,
    amountCents: input.totalCents,
    date: input.purchaseDate,
    notes: input.merchant.trim()
  }
}

export function budgetRecordFrom(
  budgetId: string, input: BudgetInput, createdAt: string, updatedAt: string, revision: number
): BudgetRecord {
  return {
    id: budgetId,
    month: input.month,
    plannedIncomeCents: input.plannedIncomeCents,
    allocations: input.allocations.map((allocation, index) => ({
      id: `${budgetId}-${index}`,
      budgetId,
      categoryId: allocation.categoryId,
      amountCents: allocation.amountCents
    })),
    createdAt,
    updatedAt,
    revision
  }
}

export function budgetIdFor(month: string): string {
  return `budget-${month}`
}

export function gymCategoryRecordFrom(
  id: string, input: GymCategoryInput, createdAt: string, updatedAt: string, revision: number
): GymCategoryRecord {
  return { id, name: input.name.trim(), color: input.color, createdAt, updatedAt, revision }
}

export function gymExerciseRecordFrom(
  id: string, input: GymExerciseInput, createdAt: string, updatedAt: string, revision: number
): GymExerciseRecord {
  return {
    id,
    name: input.name.trim(),
    categoryId: input.categoryId,
    type: input.type,
    weightUnit: input.weightUnit,
    notes: input.notes.trim(),
    createdAt,
    updatedAt,
    revision
  }
}

export function gymSetRecordFrom(
  id: string, input: GymSetInput, createdAt: string, updatedAt: string, revision: number
): GymSetRecord {
  return {
    id,
    exerciseId: input.exerciseId,
    date: input.date,
    position: input.position,
    weight: input.weight,
    weightUnit: input.weightUnit,
    reps: input.reps,
    distance: input.distance,
    distanceUnit: input.distanceUnit,
    durationSeconds: input.durationSeconds,
    comment: input.comment.trim(),
    createdAt,
    updatedAt,
    revision
  }
}

export function gymWorkoutRecordFrom(
  input: GymWorkoutInput, createdAt: string, updatedAt: string, revision: number
): GymWorkoutRecord {
  return {
    id: input.date,
    date: input.date,
    exerciseOrder: [...input.exerciseOrder],
    supersets: input.supersets.map((group) => [...group]),
    notes: input.notes.trim(),
    createdAt,
    updatedAt,
    revision
  }
}

export function gymPlanRecordFrom(
  id: string, input: GymPlanInput, createdAt: string, updatedAt: string, revision: number
): GymPlanRecord {
  return {
    id,
    name: input.name.trim(),
    exerciseOrder: [...input.exerciseOrder],
    supersets: input.supersets.map((group) => [...group]),
    createdAt,
    updatedAt,
    revision
  }
}

export function moodRecordFrom(
  id: string, input: MoodInput, createdAt: string, updatedAt: string, revision: number
): MoodRecord {
  return {
    id,
    date: input.date,
    mood: input.mood,
    note: input.note.trim(),
    createdAt,
    updatedAt,
    revision
  }
}

export function moodIdFor(date: string): string {
  return `mood-${date}`
}

export function habitRecordFrom(
  id: string, input: HabitInput, createdAt: string, updatedAt: string, revision: number
): HabitRecord {
  return {
    id,
    name: input.name.trim(),
    icon: input.icon.trim(),
    kind: input.kind,
    startDate: input.startDate,
    position: input.position,
    target: input.target ?? 1,
    period: input.period ?? 'day',
    startedAt: input.startedAt ?? null,
    createdAt,
    updatedAt,
    revision
  }
}

export function habitEntryRecordFrom(
  id: string, input: HabitEntryInput, createdAt: string, updatedAt: string, revision: number
): HabitEntryRecord {
  return {
    id, habitId: input.habitId, date: input.date, kind: input.kind, loggedAt: input.loggedAt ?? null,
    createdAt, updatedAt, revision
  }
}

export function diaryMessageRecordFrom(
  id: string, input: DiaryMessageInput, createdAt: string, updatedAt: string, revision: number
): DiaryMessageRecord {
  return {
    id, sentAt: input.sentAt, text: input.text, entities: input.entities, attachments: input.attachments,
    replyToId: input.replyToId, forwarded: input.forwarded, forwardedFrom: input.forwardedFrom,
    pinnedAt: input.pinnedAt, editedAt: input.editedAt, source: input.source, createdAt, updatedAt, revision
  }
}

export function taskBoardRecordFrom(
  id: string, input: TaskBoardInput, createdAt: string, updatedAt: string, revision: number
): TaskBoardRecord {
  return { id, ...input, name: input.name.trim(), icon: input.icon.trim(), createdAt, updatedAt, revision }
}

export function taskListRecordFrom(
  id: string, input: TaskListInput, createdAt: string, updatedAt: string, revision: number
): TaskListRecord {
  return { id, ...input, name: input.name.trim(), createdAt, updatedAt, revision }
}

export function taskLabelRecordFrom(
  id: string, input: TaskLabelInput, createdAt: string, updatedAt: string, revision: number
): TaskLabelRecord {
  return { id, ...input, name: input.name.trim(), createdAt, updatedAt, revision }
}

export function taskCardRecordFrom(
  id: string, input: TaskCardInput, createdAt: string, updatedAt: string, revision: number
): TaskCardRecord {
  return { id, ...input, title: input.title.trim(), createdAt, updatedAt, revision }
}

export function taskGoalRecordFrom(
  id: string, input: TaskGoalInput, createdAt: string, updatedAt: string, revision: number
): TaskGoalRecord {
  return { id, ...input, title: input.title.trim(), createdAt, updatedAt, revision }
}

export function sheetRecordFrom(
  id: string, input: SheetInput, createdAt: string, updatedAt: string, revision: number
): SheetRecord {
  return { id, ...input, name: input.name.trim(), icon: input.icon.trim(), createdAt, updatedAt, revision }
}

export function sheetRowRecordFrom(
  id: string, input: SheetRowInput, createdAt: string, updatedAt: string, revision: number
): SheetRowRecord {
  return { id, ...input, createdAt, updatedAt, revision }
}

export function foodEntryRecordFrom(
  id: string, input: FoodEntryInput, createdAt: string, updatedAt: string, revision: number
): FoodEntryRecord {
  return { id, ...input, name: input.name.trim(), serving: input.serving.trim(), note: input.note.trim(), createdAt, updatedAt, revision }
}

export function fridgeItemRecordFrom(
  id: string, input: FridgeItemInput, createdAt: string, updatedAt: string, revision: number
): FridgeItemRecord {
  return {
    id, ...input, name: input.name.trim(), icon: input.icon.trim(), brand: input.brand?.trim() || null,
    createdAt, updatedAt, revision
  }
}

export function foodGoalRecordFrom(input: FoodGoalInput, createdAt: string, updatedAt: string, revision: number): FoodGoalRecord {
  return { id: FOOD_GOAL_ID, ...input, createdAt, updatedAt, revision }
}
