import type {
  AccountRecord, BudgetRecord, CategoryRecord, DiaryMessageRecord, GymCategoryRecord, GymExerciseRecord, GymSetRecord,
  GymWorkoutRecord, HabitEntryRecord, HabitRecord, MoodRecord, PurchaseRecord, TransactionRecord
} from '@ego/api-contracts'
import type {
  AccountInput, BudgetInput, CategoryInput, DiaryMessageInput, GymCategoryInput, GymExerciseInput, GymSetInput,
  GymWorkoutInput, HabitEntryInput, HabitInput, MoodInput, PurchaseInput, ReceiptItem, TransactionInput
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
