import type {
  AccountRecord, BudgetRecord, CategoryRecord, ChangePayload, DiaryMessageRecord, FeedTransaction, GymCategoryRecord,
  GymExerciseRecord, GymSetRecord, GymWorkoutRecord, HabitEntryRecord, HabitRecord, MoodRecord,
  PurchaseRecord, SyncEntity, TaskBoardRecord, TaskCardRecord, TaskLabelRecord, TaskListRecord, TransactionRecord
} from '@ego/api-contracts'
import type { LocalDatabase } from './types'

export const TABLES: Record<SyncEntity, string> = {
  account: 'accounts',
  category: 'categories',
  transaction: 'transactions',
  purchase: 'purchases',
  budget: 'budgets',
  gymCategory: 'gym_categories',
  gymExercise: 'gym_exercises',
  gymSet: 'gym_sets',
  gymWorkout: 'gym_workouts',
  mood: 'mood_entries',
  habit: 'habits',
  habitEntry: 'habit_entries',
  diaryMessage: 'diary_messages',
  taskBoard: 'task_boards',
  taskList: 'task_lists',
  taskLabel: 'task_labels',
  taskCard: 'task_cards'
}

/** Budgets are keyed by month and mood entries by date; every other record by its ID. */
export function keyColumn(entity: SyncEntity): 'month' | 'date' | 'id' {
  return entity === 'budget' ? 'month' : entity === 'mood' ? 'date' : 'id'
}

async function writeAccount(tx: LocalDatabase, record: AccountRecord): Promise<void> {
  await tx.run(`INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date,
    archived_at, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, icon = excluded.icon,
      color = excluded.color, opening_balance_cents = excluded.opening_balance_cents,
      opening_date = excluded.opening_date, archived_at = excluded.archived_at,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= accounts.revision`,
  [record.id, record.name, record.kind, record.icon, record.color, record.openingBalanceCents,
    record.openingDate, record.archivedAt, record.createdAt, record.updatedAt, record.revision])
}

async function writeCategory(tx: LocalDatabase, record: CategoryRecord): Promise<void> {
  await tx.run(`INSERT INTO categories (id, name, kind, icon, color, archived_at, created_at,
    updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, icon = excluded.icon,
      color = excluded.color, archived_at = excluded.archived_at,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= categories.revision`,
  [record.id, record.name, record.kind, record.icon, record.color, record.archivedAt,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeTransaction(tx: LocalDatabase, record: TransactionRecord): Promise<void> {
  await tx.run(`INSERT INTO transactions (id, kind, account_id, destination_account_id, category_id,
    amount_cents, date, notes, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, account_id = excluded.account_id,
      destination_account_id = excluded.destination_account_id, category_id = excluded.category_id,
      amount_cents = excluded.amount_cents, date = excluded.date, notes = excluded.notes,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= transactions.revision`,
  [record.id, record.kind, record.accountId, record.destinationAccountId, record.categoryId,
    record.amountCents, record.date, record.notes, record.createdAt, record.updatedAt, record.revision])
}

async function writePurchase(tx: LocalDatabase, record: PurchaseRecord): Promise<void> {
  await tx.run(`INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
    subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at,
    revision, deleted_at, items_loaded)
    VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
    ON CONFLICT(id) DO UPDATE SET transaction_id = excluded.transaction_id, merchant = excluded.merchant,
      purchase_date = excluded.purchase_date, subtotal_cents = excluded.subtotal_cents,
      discount_cents = excluded.discount_cents, tax_cents = excluded.tax_cents,
      fees_cents = excluded.fees_cents, total_cents = excluded.total_cents,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL, items_loaded = 1
    WHERE excluded.revision >= purchases.revision`,
  [record.id, record.transactionId, record.merchant, record.purchaseDate, record.subtotalCents,
    record.discountCents, record.taxCents, record.feesCents, record.totalCents, record.createdAt,
    record.updatedAt, record.revision])
  const stored = await tx.all<{ revision: number }>('SELECT revision FROM purchases WHERE id = ?', [record.id])
  if ((stored[0]?.revision ?? 0) !== record.revision) return
  await tx.run('DELETE FROM receipt_items WHERE purchase_id = ?', [record.id])
  for (const item of record.items) {
    await tx.run(`INSERT INTO receipt_items (id, purchase_id, position, name, quantity,
      unit_price_cents, gross_price_cents, discount_cents, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.purchaseId, item.position, item.name, item.quantity, item.unitPriceCents,
      item.grossPriceCents, item.discountCents, item.lineTotalCents])
  }
}

async function writeBudget(tx: LocalDatabase, record: BudgetRecord): Promise<void> {
  await tx.run(`INSERT INTO budgets (id, month, planned_income_cents, created_at, updated_at,
    revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(month) DO UPDATE SET planned_income_cents = excluded.planned_income_cents,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= budgets.revision`,
  [record.id, record.month, record.plannedIncomeCents, record.createdAt, record.updatedAt, record.revision])
  const stored = await tx.all<{ id: string; revision: number }>(
    'SELECT id, revision FROM budgets WHERE month = ?', [record.month])
  const budget = stored[0]
  if (!budget || budget.revision !== record.revision) return
  await tx.run('DELETE FROM budget_allocations WHERE budget_id = ?', [budget.id])
  for (const allocation of record.allocations) {
    await tx.run(
      'INSERT INTO budget_allocations (id, budget_id, category_id, amount_cents) VALUES (?, ?, ?, ?)',
      [allocation.id, budget.id, allocation.categoryId, allocation.amountCents])
  }
}

async function writeGymCategory(tx: LocalDatabase, record: GymCategoryRecord): Promise<void> {
  await tx.run(`INSERT INTO gym_categories (id, name, color, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= gym_categories.revision`,
  [record.id, record.name, record.color, record.createdAt, record.updatedAt, record.revision])
}

async function writeGymExercise(tx: LocalDatabase, record: GymExerciseRecord): Promise<void> {
  await tx.run(`INSERT INTO gym_exercises (id, name, category_id, type, weight_unit, notes, created_at,
    updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, category_id = excluded.category_id,
      type = excluded.type, weight_unit = excluded.weight_unit, notes = excluded.notes,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= gym_exercises.revision`,
  [record.id, record.name, record.categoryId, record.type, record.weightUnit, record.notes,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeGymSet(tx: LocalDatabase, record: GymSetRecord): Promise<void> {
  await tx.run(`INSERT INTO gym_sets (id, exercise_id, date, position, weight, weight_unit, reps, distance,
    distance_unit, duration_seconds, comment, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET exercise_id = excluded.exercise_id, date = excluded.date,
      position = excluded.position, weight = excluded.weight, weight_unit = excluded.weight_unit,
      reps = excluded.reps, distance = excluded.distance, distance_unit = excluded.distance_unit,
      duration_seconds = excluded.duration_seconds, comment = excluded.comment,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= gym_sets.revision`,
  [record.id, record.exerciseId, record.date, record.position, record.weight, record.weightUnit,
    record.reps, record.distance, record.distanceUnit, record.durationSeconds, record.comment,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeGymWorkout(tx: LocalDatabase, record: GymWorkoutRecord): Promise<void> {
  await tx.run(`INSERT INTO gym_workouts (id, exercise_order, supersets, notes, created_at, updated_at,
    revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET exercise_order = excluded.exercise_order,
      supersets = excluded.supersets, notes = excluded.notes,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= gym_workouts.revision`,
  [record.id, JSON.stringify(record.exerciseOrder), JSON.stringify(record.supersets), record.notes,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeMood(tx: LocalDatabase, record: MoodRecord): Promise<void> {
  await tx.run(`INSERT INTO mood_entries (id, date, mood, note, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, note = excluded.note,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= mood_entries.revision`,
  [record.id, record.date, record.mood, record.note, record.createdAt, record.updatedAt, record.revision])
}

/** Change-log payloads written before migration 0009 carry no target, period, or times. */
async function writeHabit(tx: LocalDatabase, record: HabitRecord): Promise<void> {
  await tx.run(`INSERT INTO habits (id, name, icon, kind, start_date, position, target, period, started_at,
    created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, kind = excluded.kind,
      start_date = excluded.start_date, position = excluded.position, target = excluded.target,
      period = excluded.period, started_at = excluded.started_at,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= habits.revision`,
  [record.id, record.name, record.icon, record.kind, record.startDate, record.position, record.target ?? 1,
    record.period ?? 'day', record.startedAt ?? null, record.createdAt, record.updatedAt, record.revision])
}

async function writeHabitEntry(tx: LocalDatabase, record: HabitEntryRecord): Promise<void> {
  await tx.run(`INSERT INTO habit_entries (id, habit_id, date, kind, logged_at, created_at, updated_at, revision,
    deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET habit_id = excluded.habit_id, date = excluded.date, kind = excluded.kind,
      logged_at = excluded.logged_at, created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= habit_entries.revision`,
  [record.id, record.habitId, record.date, record.kind, record.loggedAt ?? null, record.createdAt,
    record.updatedAt, record.revision])
}

async function writeDiaryMessage(tx: LocalDatabase, record: DiaryMessageRecord): Promise<void> {
  await tx.run(`INSERT INTO diary_messages (id, sent_at, text, entities, attachments, reply_to_id, forwarded,
    forwarded_from, pinned_at, edited_at, source, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET sent_at = excluded.sent_at, text = excluded.text, entities = excluded.entities,
      attachments = excluded.attachments, reply_to_id = excluded.reply_to_id, forwarded = excluded.forwarded,
      forwarded_from = excluded.forwarded_from, pinned_at = excluded.pinned_at, edited_at = excluded.edited_at,
      source = excluded.source, created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= diary_messages.revision`,
  [record.id, record.sentAt, record.text, JSON.stringify(record.entities), JSON.stringify(record.attachments),
    record.replyToId, record.forwarded ? 1 : 0, record.forwardedFrom, record.pinnedAt, record.editedAt, record.source,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeTaskBoard(tx: LocalDatabase, record: TaskBoardRecord): Promise<void> {
  await tx.run(`INSERT INTO task_boards (id, name, icon, position, hide_done, archived_at, created_at, updated_at,
    revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, position = excluded.position,
      hide_done = excluded.hide_done, archived_at = excluded.archived_at, created_at = excluded.created_at,
      updated_at = excluded.updated_at, revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= task_boards.revision`,
  [record.id, record.name, record.icon, record.position, record.hideDone ? 1 : 0, record.archivedAt,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeTaskList(tx: LocalDatabase, record: TaskListRecord): Promise<void> {
  await tx.run(`INSERT INTO task_lists (id, board_id, name, position, archived_at, created_at, updated_at, revision,
    deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET board_id = excluded.board_id, name = excluded.name, position = excluded.position,
      archived_at = excluded.archived_at, created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= task_lists.revision`,
  [record.id, record.boardId, record.name, record.position, record.archivedAt, record.createdAt, record.updatedAt,
    record.revision])
}

async function writeTaskLabel(tx: LocalDatabase, record: TaskLabelRecord): Promise<void> {
  await tx.run(`INSERT INTO task_labels (id, board_id, name, color, position, created_at, updated_at, revision,
    deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET board_id = excluded.board_id, name = excluded.name, color = excluded.color,
      position = excluded.position, created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= task_labels.revision`,
  [record.id, record.boardId, record.name, record.color, record.position, record.createdAt, record.updatedAt,
    record.revision])
}

async function writeTaskCard(tx: LocalDatabase, record: TaskCardRecord): Promise<void> {
  await tx.run(`INSERT INTO task_cards (id, board_id, list_id, title, description, position, label_ids, priority,
    due_date, due_time, reminder_minutes, done_at, archived_at, checklists, attachments, activity, created_at,
    updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET board_id = excluded.board_id, list_id = excluded.list_id, title = excluded.title,
      description = excluded.description, position = excluded.position, label_ids = excluded.label_ids,
      priority = excluded.priority, due_date = excluded.due_date, due_time = excluded.due_time,
      reminder_minutes = excluded.reminder_minutes, done_at = excluded.done_at, archived_at = excluded.archived_at,
      checklists = excluded.checklists, attachments = excluded.attachments, activity = excluded.activity,
      created_at = excluded.created_at, updated_at = excluded.updated_at, revision = excluded.revision,
      deleted_at = NULL
    WHERE excluded.revision >= task_cards.revision`,
  [record.id, record.boardId, record.listId, record.title, record.description, record.position,
    JSON.stringify(record.labelIds), record.priority, record.dueDate, record.dueTime, record.reminderMinutes,
    record.doneAt, record.archivedAt, JSON.stringify(record.checklists), JSON.stringify(record.attachments),
    JSON.stringify(record.activity), record.createdAt, record.updatedAt, record.revision])
}

/** Applies a record only when it is at least as new as the stored revision. */
export async function writeRecord(tx: LocalDatabase, payload: ChangePayload): Promise<void> {
  if (payload.record === null) return
  switch (payload.entity) {
    case 'account': return writeAccount(tx, payload.record)
    case 'category': return writeCategory(tx, payload.record)
    case 'transaction': return writeTransaction(tx, payload.record)
    case 'purchase': return writePurchase(tx, payload.record)
    case 'budget': return writeBudget(tx, payload.record)
    case 'gymCategory': return writeGymCategory(tx, payload.record)
    case 'gymExercise': return writeGymExercise(tx, payload.record)
    case 'gymSet': return writeGymSet(tx, payload.record)
    case 'gymWorkout': return writeGymWorkout(tx, payload.record)
    case 'mood': return writeMood(tx, payload.record)
    case 'habit': return writeHabit(tx, payload.record)
    case 'habitEntry': return writeHabitEntry(tx, payload.record)
    case 'diaryMessage': return writeDiaryMessage(tx, payload.record)
    case 'taskBoard': return writeTaskBoard(tx, payload.record)
    case 'taskList': return writeTaskList(tx, payload.record)
    case 'taskLabel': return writeTaskLabel(tx, payload.record)
    case 'taskCard': return writeTaskCard(tx, payload.record)
  }
}

/** A tombstone, so a row deleted on another device disappears here too. */
export async function writeTombstone(
  tx: LocalDatabase, entity: SyncEntity, entityId: string, revision: number, deletedAt: string
): Promise<void> {
  const table: string | undefined = TABLES[entity]
  // A newer server may log entities this build has no table for.
  if (!table) return
  await tx.run(
    `UPDATE ${table} SET deleted_at = ?, revision = ? WHERE ${keyColumn(entity)} = ? AND revision <= ?`,
    [deletedAt, revision, entityId, revision])
}

/**
 * Feed rows carry merchant metadata but never receipt items, so a bootstrapped purchase is
 * marked as not yet loaded and its items are fetched when the receipt is opened.
 */
export async function writeFeedTransaction(tx: LocalDatabase, row: FeedTransaction): Promise<void> {
  await writeTransaction(tx, row)
  if (row.purchaseId === null || row.merchant === null) return
  await tx.run(`INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
    subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at,
    revision, deleted_at, items_loaded)
    VALUES (?, ?, ?, ?, 'USD', 0, 0, 0, 0, ?, ?, ?, 0, NULL, 0)
    ON CONFLICT(id) DO UPDATE SET merchant = excluded.merchant
    WHERE purchases.items_loaded = 0`,
  [row.purchaseId, row.id, row.merchant, row.date, row.amountCents, row.createdAt, row.updatedAt])
}
