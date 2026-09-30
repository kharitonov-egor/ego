import type { SyncCommand, SyncOperation } from '@ego/api-contracts'
import type {
  AccountInput, BudgetInput, CategoryInput, DiaryMessageInput, GymCategoryInput, GymExerciseInput, GymPlanInput,
  GymSetInput, GymWorkoutInput, HabitEntryInput, HabitInput, MoodInput, PurchaseInput, TaskBoardInput, TaskCardInput,
  TaskLabelInput, TaskListInput, TransactionInput
} from '@ego/core'
import type { LocalDatabase } from '../database/types'
import { applyCommandLocally } from './local-apply'
import { commitLocalWrite, entityOperations, removeOperation, replaceCommand } from './outbox'

/** Generated once per record and per operation, and reused on every retry. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function submit(
  db: LocalDatabase,
  entityId: string,
  expectedRevision: number | null,
  command: SyncCommand,
  now: string,
  status: 'pending' | 'held' = 'pending'
): Promise<SyncOperation> {
  const operation: SyncOperation = {
    operationId: newId(),
    entityId,
    expectedRevision,
    createdAt: now,
    command
  }
  await commitLocalWrite(db, operation, (tx) => applyCommandLocally(tx, operation, now), status)
  return operation
}

export const createTransaction = (db: LocalDatabase, input: TransactionInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'transaction', type: 'create', payload: input }, now)

export const updateTransaction = (
  db: LocalDatabase, id: string, revision: number, input: TransactionInput, now: string
) => submit(db, id, revision, { entity: 'transaction', type: 'update', payload: input }, now)

export const deleteTransaction = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'transaction', type: 'delete' }, now)

export const createPurchase = (db: LocalDatabase, input: PurchaseInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'purchase', type: 'create', payload: input }, now)

export const updatePurchase = (
  db: LocalDatabase, id: string, revision: number, input: PurchaseInput, now: string
) => submit(db, id, revision, { entity: 'purchase', type: 'update', payload: input }, now)

export const deletePurchase = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'purchase', type: 'delete' }, now)

export const createAccount = (db: LocalDatabase, input: AccountInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'account', type: 'create', payload: input }, now)

export const updateAccount = (
  db: LocalDatabase, id: string, revision: number, input: AccountInput, now: string
) => submit(db, id, revision, { entity: 'account', type: 'update', payload: input }, now)

export const archiveAccount = (
  db: LocalDatabase, id: string, revision: number, archived: boolean, now: string
) => submit(db, id, revision, { entity: 'account', type: 'archive', payload: { archived } }, now)

export const createCategory = (db: LocalDatabase, input: CategoryInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'category', type: 'create', payload: input }, now)

export const updateCategory = (
  db: LocalDatabase, id: string, revision: number, input: CategoryInput, now: string
) => submit(db, id, revision, { entity: 'category', type: 'update', payload: input }, now)

export const archiveCategory = (
  db: LocalDatabase, id: string, revision: number, archived: boolean, now: string
) => submit(db, id, revision, { entity: 'category', type: 'archive', payload: { archived } }, now)

export const saveBudget = (
  db: LocalDatabase, input: BudgetInput, revision: number | null, now: string
) => submit(db, input.month, revision, { entity: 'budget', type: 'save', payload: input }, now)

export const deleteBudget = (db: LocalDatabase, month: string, revision: number, now: string) =>
  submit(db, month, revision, { entity: 'budget', type: 'delete' }, now)

export const createGymCategory = (db: LocalDatabase, input: GymCategoryInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'gymCategory', type: 'create', payload: input }, now)

export const updateGymCategory = (
  db: LocalDatabase, id: string, revision: number, input: GymCategoryInput, now: string
) => submit(db, id, revision, { entity: 'gymCategory', type: 'update', payload: input }, now)

export const deleteGymCategory = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'gymCategory', type: 'delete' }, now)

export const createGymExercise = (db: LocalDatabase, input: GymExerciseInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'gymExercise', type: 'create', payload: input }, now)

export const updateGymExercise = (
  db: LocalDatabase, id: string, revision: number, input: GymExerciseInput, now: string
) => submit(db, id, revision, { entity: 'gymExercise', type: 'update', payload: input }, now)

export const deleteGymExercise = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'gymExercise', type: 'delete' }, now)

export const createGymSet = (db: LocalDatabase, input: GymSetInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'gymSet', type: 'create', payload: input }, now)

export const updateGymSet = (
  db: LocalDatabase, id: string, revision: number, input: GymSetInput, now: string
) => submit(db, id, revision, { entity: 'gymSet', type: 'update', payload: input }, now)

export const deleteGymSet = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'gymSet', type: 'delete' }, now)

export const saveGymWorkout = (
  db: LocalDatabase, input: GymWorkoutInput, revision: number | null, now: string
) => submit(db, input.date, revision, { entity: 'gymWorkout', type: 'save', payload: input }, now)

export const createGymPlan = (db: LocalDatabase, input: GymPlanInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'gymPlan', type: 'create', payload: input }, now)

export const updateGymPlan = (
  db: LocalDatabase, id: string, revision: number, input: GymPlanInput, now: string
) => submit(db, id, revision, { entity: 'gymPlan', type: 'update', payload: input }, now)

export const deleteGymPlan = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'gymPlan', type: 'delete' }, now)

export const saveMood = (
  db: LocalDatabase, input: MoodInput, revision: number | null, now: string
) => submit(db, input.date, revision, { entity: 'mood', type: 'save', payload: input }, now)

export const deleteMood = (db: LocalDatabase, date: string, revision: number, now: string) =>
  submit(db, date, revision, { entity: 'mood', type: 'delete' }, now)

export const createHabit = (db: LocalDatabase, input: HabitInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'habit', type: 'create', payload: input }, now)

export const updateHabit = (
  db: LocalDatabase, id: string, revision: number, input: HabitInput, now: string
) => submit(db, id, revision, { entity: 'habit', type: 'update', payload: input }, now)

export const deleteHabit = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'habit', type: 'delete' }, now)

export const createHabitEntry = (db: LocalDatabase, input: HabitEntryInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'habitEntry', type: 'create', payload: input }, now)

export const deleteHabitEntry = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'habitEntry', type: 'delete' }, now)

/** A message with files waits as `held` until every file has uploaded. */
export const createDiaryMessage = (
  db: LocalDatabase, input: DiaryMessageInput, now: string, id = newId(), held = false
) => submit(db, id, null, { entity: 'diaryMessage', type: 'create', payload: input }, now, held ? 'held' : 'pending')

/**
 * A message still waiting on its files has not reached the server, so an edit rewrites its queued
 * create instead of sending an update the server could not apply yet.
 */
export async function updateDiaryMessage(
  db: LocalDatabase, id: string, revision: number, input: DiaryMessageInput, now: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const waiting = (await entityOperations(tx, 'diaryMessage', id))
      .find((entry) => entry.commandType === 'create' && entry.status === 'held')
    if (!waiting) {
      await submit(tx, id, revision, { entity: 'diaryMessage', type: 'update', payload: input }, now)
      return
    }
    const command: SyncCommand = { entity: 'diaryMessage', type: 'create', payload: input }
    await replaceCommand(tx, waiting.operationId, command)
    await applyCommandLocally(tx, { ...waiting, expectedRevision: null, command }, now)
  })
}

/**
 * Deleting a message the server never accepted drops it here, with its queued uploads. Returns the
 * local copies of those files so the caller can remove them.
 */
export async function deleteDiaryMessage(
  db: LocalDatabase, id: string, revision: number, now: string
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const operations = await entityOperations(tx, 'diaryMessage', id)
    const undelivered = operations.some((entry) => entry.commandType === 'create' && entry.status !== 'pending')
    if (!undelivered) {
      await submit(tx, id, revision, { entity: 'diaryMessage', type: 'delete' }, now)
      return []
    }
    const files = await tx.all<{ local_uri: string }>('SELECT local_uri FROM diary_uploads WHERE message_id = ?', [id])
    for (const entry of operations) await removeOperation(tx, entry.operationId)
    await tx.run('DELETE FROM diary_uploads WHERE message_id = ?', [id])
    await tx.run('DELETE FROM diary_messages WHERE id = ?', [id])
    return files.map((file) => file.local_uri)
  })
}

export const createTaskBoard = (db: LocalDatabase, input: TaskBoardInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'taskBoard', type: 'create', payload: input }, now)

export const updateTaskBoard = (db: LocalDatabase, id: string, revision: number, input: TaskBoardInput, now: string) =>
  submit(db, id, revision, { entity: 'taskBoard', type: 'update', payload: input }, now)

export const deleteTaskBoard = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'taskBoard', type: 'delete' }, now)

export const createTaskList = (db: LocalDatabase, input: TaskListInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'taskList', type: 'create', payload: input }, now)

export const updateTaskList = (db: LocalDatabase, id: string, revision: number, input: TaskListInput, now: string) =>
  submit(db, id, revision, { entity: 'taskList', type: 'update', payload: input }, now)

export const deleteTaskList = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'taskList', type: 'delete' }, now)

export const createTaskLabel = (db: LocalDatabase, input: TaskLabelInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'taskLabel', type: 'create', payload: input }, now)

export const updateTaskLabel = (db: LocalDatabase, id: string, revision: number, input: TaskLabelInput, now: string) =>
  submit(db, id, revision, { entity: 'taskLabel', type: 'update', payload: input }, now)

export const deleteTaskLabel = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'taskLabel', type: 'delete' }, now)

/**
 * Saves a card, creating it when `revision` is null. A card with files still uploading waits in the
 * outbox as `held`, and any edit made meanwhile folds into that operation: a second one queued
 * behind it would reach the server first and lose to it.
 */
export async function saveTaskCard(
  db: LocalDatabase, id: string, revision: number | null, input: TaskCardInput, now: string, held = false
): Promise<void> {
  await db.transaction(async (tx) => {
    const waiting = (await entityOperations(tx, 'taskCard', id)).find((entry) => entry.status === 'held')
    if (!waiting) {
      const command: SyncCommand = revision === null
        ? { entity: 'taskCard', type: 'create', payload: input }
        : { entity: 'taskCard', type: 'update', payload: input }
      await submit(tx, id, revision, command, now, held ? 'held' : 'pending')
      return
    }
    const command: SyncCommand = waiting.commandType === 'create'
      ? { entity: 'taskCard', type: 'create', payload: input }
      : { entity: 'taskCard', type: 'update', payload: input }
    await replaceCommand(tx, waiting.operationId, command)
    await applyCommandLocally(tx, { ...waiting, command }, now)
  })
}

/**
 * A card the server never saw is dropped here with its queued files, whose local copies are
 * returned for the caller to remove. Otherwise any held edit is dropped and the delete goes out
 * against the revision the server holds.
 */
export async function deleteTaskCard(db: LocalDatabase, id: string, revision: number, now: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    const operations = await entityOperations(tx, 'taskCard', id)
    const unsent = operations.filter((entry) => entry.status === 'held' || entry.status === 'failed')
    const files = await tx.all<{ local_uri: string }>('SELECT local_uri FROM diary_uploads WHERE message_id = ? AND uploaded_at IS NULL', [id])
    await tx.run('DELETE FROM diary_uploads WHERE message_id = ? AND uploaded_at IS NULL', [id])
    for (const entry of unsent) await removeOperation(tx, entry.operationId)
    if (unsent.some((entry) => entry.commandType === 'create')) {
      for (const entry of operations) await removeOperation(tx, entry.operationId)
      await tx.run('DELETE FROM task_cards WHERE id = ?', [id])
      return files.map((file) => file.local_uri)
    }
    await submit(tx, id, unsent[0]?.expectedRevision ?? revision, { entity: 'taskCard', type: 'delete' }, now)
    return files.map((file) => file.local_uri)
  })
}
