import type { ContentItemRecord, ContentCollectionRecord } from '@ego/api-contracts'
import { readContent } from './content-records'
import {
  DEFAULT_PAGE_SIZE, MAX_CHANGE_PAGE_SIZE, MAX_PAGE_SIZE, NO_TRANSACTION_FILTERS, encodeCursor,
  BALANCES_SQL, FEED_COLUMNS, FEED_FROM, budgetTotalsSql, feedCountSql, feedPageSql, notFound,
  summarySql, transactionQueryIdentity,
  type AccountBalances, type ApiResult, type BootstrapData, type ChangePage, type ChangeRecord, type FeedCursor,
  type AccountRecord, type BudgetRecord, type CategoryRecord, type ChangePayload, type DiaryMessageRecord,
  type GymCategoryRecord, type GymExerciseRecord, type GymPlanRecord, type GymSetRecord, type GymWorkoutRecord,
  type HabitEntryRecord, type HabitRecord, type MoodRecord, type TaskBoardRecord, type TaskCardRecord, type TaskGoalRecord,
  type TaskLabelRecord, type TaskListRecord, type SheetRecord, type SheetRowRecord, type FoodEntryRecord,
  type FridgeItemRecord, type FoodGoalRecord, type PeriodSummary, type PurchaseRecord, type ReceiptDetail, type ReferenceData,
  type TransactionDetail, type TransactionFilters, type TransactionPage, type TransactionRecord
} from '@ego/api-contracts'
import type { MoneySnapshot } from '@ego/core'
import {
  toAccountRecord, toBudgetRecord, toCategoryRecord, toDiaryMessageRecord, toFeedTransaction, toGymCategoryRecord,
  toGymExerciseRecord, toGymPlanRecord, toGymSetRecord, toGymWorkoutRecord, toHabitEntryRecord, toHabitRecord,
  toMoodRecord, toPurchaseRecord, toReceiptItem, toTaskBoardRecord, toTaskCardRecord, toTaskGoalRecord, toTaskLabelRecord,
  toTaskListRecord, toTransactionRecord, toSheetRecord, toSheetRowRecord, toFoodEntryRecord, toFridgeItemRecord,
  toFoodGoalRecord,
  type AccountRow, type BudgetAllocationRow, type BudgetRow, type CategoryRow, type DiaryMessageRow, type FeedRow,
  type GymCategoryRow, type GymExerciseRow, type GymPlanRow, type GymSetRow, type GymWorkoutRow, type HabitEntryRow,
  type HabitRow, type MoodRow, type PurchaseRow, type ReceiptItemRow, type TaskBoardRow, type TaskCardRow, type TaskGoalRow,
  type TaskLabelRow, type TaskListRow, type TransactionRow, type SheetRow, type SheetRowRow, type FoodEntryRow,
  type FridgeItemRow, type FoodGoalRow
} from './rows'

export async function query<T>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const statement = params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql)
  const result = await statement.all<T>()
  return result.results ?? []
}

export async function serverSequence(db: D1Database): Promise<number> {
  const rows = await query<{ seq: number }>(db, 'SELECT COALESCE(MAX(seq), 0) AS seq FROM changes')
  return rows[0]?.seq ?? 0
}

export async function readReference(db: D1Database): Promise<ReferenceData> {
  const [accounts, categories, sequence] = await Promise.all([
    query<AccountRow>(db, 'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at'),
    query<CategoryRow>(db, 'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE'),
    serverSequence(db)
  ])
  return {
    accounts: accounts.map(toAccountRecord),
    categories: categories.map(toCategoryRecord),
    serverSequence: sequence
  }
}

export function pageSizeFrom(raw: string | null): number {
  const requested = raw === null ? DEFAULT_PAGE_SIZE : Number(raw)
  if (!Number.isSafeInteger(requested) || requested < 1) return DEFAULT_PAGE_SIZE
  return Math.min(requested, MAX_PAGE_SIZE)
}

export async function readTransactionPage(
  db: D1Database,
  filters: TransactionFilters,
  cursor: FeedCursor | null,
  pageSize: number
): Promise<TransactionPage> {
  const page = feedPageSql(filters, cursor, pageSize + 1)
  const count = feedCountSql(filters)
  const [rows, totals] = await Promise.all([
    query<FeedRow>(db, page.sql, page.params),
    query<{ total: number }>(db, count.sql, count.params)
  ])
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(toFeedTransaction)
  const last = items[items.length - 1]
  return {
    items,
    hasMore,
    nextCursor: hasMore && last
      ? encodeCursor({ date: last.date, createdAt: last.createdAt, id: last.id }, filters)
      : null,
    totalCount: totals[0]?.total ?? 0,
    queryIdentity: transactionQueryIdentity(filters)
  }
}

async function purchaseBy(db: D1Database, column: 'id' | 'transaction_id', value: string): Promise<PurchaseRecord | null> {
  const purchases = await query<PurchaseRow>(db,
    `SELECT * FROM purchases WHERE ${column} = ? AND deleted_at IS NULL`, [value])
  const purchase = purchases[0]
  if (!purchase) return null
  const items = await query<ReceiptItemRow>(db,
    'SELECT * FROM receipt_items WHERE purchase_id = ? ORDER BY position', [purchase.id])
  return toPurchaseRecord(purchase, items.map(toReceiptItem))
}

export async function readTransactionDetail(db: D1Database, id: string): Promise<ApiResult<TransactionDetail>> {
  const rows = await query<FeedRow>(db,
    `SELECT ${FEED_COLUMNS} ${FEED_FROM} WHERE t.deleted_at IS NULL AND t.id = ?`, [id])
  const row = rows[0]
  if (!row) return notFound('That transaction was not found')
  return {
    ok: true,
    data: { transaction: toFeedTransaction(row), purchase: await purchaseBy(db, 'transaction_id', id) }
  }
}

export async function readReceiptDetail(db: D1Database, purchaseId: string): Promise<ApiResult<ReceiptDetail>> {
  const purchase = await purchaseBy(db, 'id', purchaseId)
  if (!purchase) return notFound('That receipt was not found')
  return { ok: true, data: { purchase } }
}

/**
 * Balances cover the whole ledger, never the loaded pages, and follow the same rules as
 * calculateAccountBalance in the core package.
 */
export async function readBalances(db: D1Database): Promise<AccountBalances> {
  const [rows, sequence] = await Promise.all([
    query<{ account_id: string; balance_cents: number }>(db, BALANCES_SQL),
    serverSequence(db)
  ])
  return {
    balances: rows.map((row) => ({ accountId: row.account_id, balanceCents: row.balance_cents })),
    serverSequence: sequence
  }
}

export async function readSummary(db: D1Database, from: string | null, to: string | null): Promise<PeriodSummary> {
  const totals = summarySql(from, to)
  const budgetTotals = budgetTotalsSql(from, to)
  const [flows, budgets] = await Promise.all([
    query<{ income_cents: number; expense_cents: number; transfer_cents: number }>(db, totals.sql, totals.params),
    query<{ planned_income_cents: number; allocated_cents: number }>(db, budgetTotals.sql, budgetTotals.params)
  ])
  const income = flows[0]?.income_cents ?? 0
  const expense = flows[0]?.expense_cents ?? 0
  return {
    from,
    to,
    incomeCents: income,
    expenseCents: expense,
    netCents: income - expense,
    transferCents: flows[0]?.transfer_cents ?? 0,
    plannedIncomeCents: budgets[0]?.planned_income_cents ?? 0,
    allocatedCents: budgets[0]?.allocated_cents ?? 0
  }
}

interface ChangeRow {
  seq: number
  entity: ChangeRecord['entity']
  entity_id: string
  action: 'upsert' | 'delete'
  revision: number
  committed_at: string
  payload: string | null
}

function parsePayload(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** The Worker wrote this payload itself when it committed the change. */
function toChangePayload(entity: ChangeRow['entity'], record: unknown): ChangePayload {
  switch (entity) {
    case 'contentItem': return { entity, record: record as ContentItemRecord | null }
    case 'contentCollection': return { entity, record: record as ContentCollectionRecord | null }
    case 'account': return { entity, record: record as AccountRecord | null }
    case 'category': return { entity, record: record as CategoryRecord | null }
    case 'transaction': return { entity, record: record as TransactionRecord | null }
    case 'purchase': return { entity, record: record as PurchaseRecord | null }
    case 'budget': return { entity, record: record as BudgetRecord | null }
    case 'gymCategory': return { entity, record: record as GymCategoryRecord | null }
    case 'gymExercise': return { entity, record: record as GymExerciseRecord | null }
    case 'gymSet': return { entity, record: record as GymSetRecord | null }
    case 'gymWorkout': return { entity, record: record as GymWorkoutRecord | null }
    case 'gymPlan': return { entity, record: record as GymPlanRecord | null }
    case 'mood': return { entity, record: record as MoodRecord | null }
    case 'habit': return { entity, record: record as HabitRecord | null }
    case 'habitEntry': return { entity, record: record as HabitEntryRecord | null }
    case 'diaryMessage': return { entity, record: record as DiaryMessageRecord | null }
    case 'taskBoard': return { entity, record: record as TaskBoardRecord | null }
    case 'taskList': return { entity, record: record as TaskListRecord | null }
    case 'taskLabel': return { entity, record: record as TaskLabelRecord | null }
    case 'taskCard': return { entity, record: record as TaskCardRecord | null }
    case 'taskGoal': return { entity, record: record as TaskGoalRecord | null }
    case 'sheet': return { entity, record: record as SheetRecord | null }
    case 'sheetRow': return { entity, record: record as SheetRowRecord | null }
    case 'foodEntry': return { entity, record: record as FoodEntryRecord | null }
    case 'fridgeItem': return { entity, record: record as FridgeItemRecord | null }
    case 'foodGoal': return { entity, record: record as FoodGoalRecord | null }
  }
}

function toChangeRecord(row: ChangeRow): ChangeRecord {
  return {
    seq: row.seq,
    entityId: row.entity_id,
    action: row.action,
    revision: row.revision,
    committedAt: row.committed_at,
    ...toChangePayload(row.entity, parsePayload(row.payload))
  }
}

export async function readLatestChange(
  db: D1Database, entity: ChangeRecord['entity'], entityId: string
): Promise<ChangeRecord | undefined> {
  const rows = await query<ChangeRow>(db,
    'SELECT * FROM changes WHERE entity = ? AND entity_id = ? ORDER BY seq DESC LIMIT 1',
    [entity, entityId])
  return rows[0] ? toChangeRecord(rows[0]) : undefined
}

export async function readChanges(db: D1Database, after: number, limit: number): Promise<ChangePage> {
  const size = Math.min(Math.max(limit, 1), MAX_CHANGE_PAGE_SIZE)
  const rows = await query<ChangeRow>(db,
    'SELECT * FROM changes WHERE seq > ? ORDER BY seq LIMIT ?', [after, size + 1])
  const hasMore = rows.length > size
  const page = rows.slice(0, size)
  return {
    changes: page.map(toChangeRecord),
    cursor: page[page.length - 1]?.seq ?? after,
    hasMore
  }
}

export const ALL_TRANSACTIONS: TransactionFilters = NO_TRANSACTION_FILTERS

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const id = key(row)
    const group = groups.get(id)
    if (group) group.push(row)
    else groups.set(id, [row])
  }
  return groups
}

interface LiveRecords {
  accounts: AccountRow[]
  categories: CategoryRow[]
  transactions: TransactionRow[]
  purchases: PurchaseRecord[]
  budgets: BudgetRecord[]
}

async function readLiveRecords(db: D1Database): Promise<LiveRecords> {
  const [accounts, categories, transactions, purchases, items, budgets, allocations] = await Promise.all([
    query<AccountRow>(db, 'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at'),
    query<CategoryRow>(db, 'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE'),
    query<TransactionRow>(db, 'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY date DESC, created_at DESC'),
    query<PurchaseRow>(db, 'SELECT * FROM purchases WHERE deleted_at IS NULL ORDER BY purchase_date DESC, created_at DESC'),
    query<ReceiptItemRow>(db, 'SELECT * FROM receipt_items ORDER BY purchase_id, position'),
    query<BudgetRow>(db, 'SELECT * FROM budgets WHERE deleted_at IS NULL ORDER BY month DESC'),
    query<BudgetAllocationRow>(db, 'SELECT * FROM budget_allocations')
  ])
  const itemsByPurchase = groupBy(items.map(toReceiptItem), (item) => item.purchaseId)
  const allocationsByBudget = groupBy(allocations, (allocation) => allocation.budget_id)
  return {
    accounts,
    categories,
    transactions,
    purchases: purchases.map((row) => toPurchaseRecord(row, itemsByPurchase.get(row.id) ?? [])),
    budgets: budgets.map((row) => toBudgetRecord(row, allocationsByBudget.get(row.id) ?? []))
  }
}

export interface TaskRows {
  boards: TaskBoardRow[]
  lists: TaskListRow[]
  labels: TaskLabelRow[]
  cards: TaskCardRow[]
  goals: TaskGoalRow[]
}

/** Rows under a deleted board or list are kept but never read. */
export async function readTaskRows(db: D1Database): Promise<TaskRows> {
  const [boards, lists, labels, cards, goals] = await Promise.all([
    query<TaskBoardRow>(db, 'SELECT * FROM task_boards WHERE deleted_at IS NULL ORDER BY position, created_at'),
    query<TaskListRow>(db, `SELECT l.* FROM task_lists l
      JOIN task_boards b ON b.id = l.board_id AND b.deleted_at IS NULL
      WHERE l.deleted_at IS NULL ORDER BY l.position, l.created_at`),
    query<TaskLabelRow>(db, `SELECT t.* FROM task_labels t
      JOIN task_boards b ON b.id = t.board_id AND b.deleted_at IS NULL
      WHERE t.deleted_at IS NULL ORDER BY t.position, t.created_at`),
    query<TaskCardRow>(db, `SELECT c.* FROM task_cards c
      JOIN task_lists l ON l.id = c.list_id AND l.deleted_at IS NULL
      JOIN task_boards b ON b.id = c.board_id AND b.deleted_at IS NULL
      WHERE c.deleted_at IS NULL ORDER BY c.position, c.created_at`),
    query<TaskGoalRow>(db, 'SELECT * FROM task_goals WHERE deleted_at IS NULL ORDER BY position, created_at')
  ])
  return { boards, lists, labels, cards, goals }
}

export interface SheetRows {
  sheets: SheetRow[]
  rows: SheetRowRow[]
}

/** Rows under a deleted sheet are kept but never read. */
export async function readSheetRows(db: D1Database): Promise<SheetRows> {
  const [sheets, rows] = await Promise.all([
    query<SheetRow>(db, 'SELECT * FROM sheets WHERE deleted_at IS NULL ORDER BY position, created_at'),
    query<SheetRowRow>(db, `SELECT r.* FROM sheet_rows r
      JOIN sheets s ON s.id = r.sheet_id AND s.deleted_at IS NULL
      WHERE r.deleted_at IS NULL ORDER BY r.created_at, r.id`)
  ])
  return { sheets, rows }
}

export interface FoodRows {
  entries: FoodEntryRow[]
  fridge: FridgeItemRow[]
  goals: FoodGoalRow[]
}

export async function readFoodRows(db: D1Database): Promise<FoodRows> {
  const [entries, fridge, goals] = await Promise.all([
    query<FoodEntryRow>(db, 'SELECT * FROM food_entries WHERE deleted_at IS NULL ORDER BY date DESC, eaten_at DESC'),
    query<FridgeItemRow>(db, 'SELECT * FROM fridge_items WHERE deleted_at IS NULL ORDER BY added_at DESC, id'),
    query<FoodGoalRow>(db, 'SELECT * FROM food_goals WHERE deleted_at IS NULL')
  ])
  return { entries, fridge, goals }
}

/**
 * The whole live ledger for a device's first download. The sequence is read first, so any
 * change committed while the tables are read is pulled again afterwards and applied by revision.
 */
export async function readBootstrap(db: D1Database): Promise<BootstrapData> {
  const sequence = await serverSequence(db)
  const [
    records, gymCategories, gymExercises, gymSets, gymWorkouts, gymPlans, moods, habits, habitEntries, diaryMessages, tasks,
    sheets, food, content
  ] = await Promise.all([
    readLiveRecords(db),
    query<GymCategoryRow>(db, 'SELECT * FROM gym_categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE'),
    query<GymExerciseRow>(db, 'SELECT * FROM gym_exercises WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE'),
    query<GymSetRow>(db, 'SELECT * FROM gym_sets WHERE deleted_at IS NULL ORDER BY date, exercise_id, position'),
    query<GymWorkoutRow>(db, 'SELECT * FROM gym_workouts WHERE deleted_at IS NULL ORDER BY id'),
    query<GymPlanRow>(db, 'SELECT * FROM gym_plans WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE'),
    query<MoodRow>(db, 'SELECT * FROM mood_entries WHERE deleted_at IS NULL ORDER BY date DESC'),
    query<HabitRow>(db, 'SELECT * FROM habits WHERE deleted_at IS NULL ORDER BY position, created_at'),
    query<HabitEntryRow>(db, 'SELECT * FROM habit_entries WHERE deleted_at IS NULL ORDER BY date, created_at'),
    query<DiaryMessageRow>(db, 'SELECT * FROM diary_messages WHERE deleted_at IS NULL ORDER BY sent_at, id'),
    readTaskRows(db),
    readSheetRows(db),
    readFoodRows(db),
    readContent(db)
  ])
  return {
    ...content,
    serverSequence: sequence,
    accounts: records.accounts.map(toAccountRecord),
    categories: records.categories.map(toCategoryRecord),
    transactions: records.transactions.map(toTransactionRecord),
    purchases: records.purchases,
    budgets: records.budgets,
    gymCategories: gymCategories.map(toGymCategoryRecord),
    gymExercises: gymExercises.map(toGymExerciseRecord),
    gymSets: gymSets.map(toGymSetRecord),
    gymWorkouts: gymWorkouts.map(toGymWorkoutRecord),
    gymPlans: gymPlans.map(toGymPlanRecord),
    moods: moods.map(toMoodRecord),
    habits: habits.map(toHabitRecord),
    habitEntries: habitEntries.map(toHabitEntryRecord),
    diaryMessages: diaryMessages.map(toDiaryMessageRecord),
    taskBoards: tasks.boards.map(toTaskBoardRecord),
    taskLists: tasks.lists.map(toTaskListRecord),
    taskLabels: tasks.labels.map(toTaskLabelRecord),
    taskCards: tasks.cards.map(toTaskCardRecord),
    taskGoals: tasks.goals.map(toTaskGoalRecord),
    sheets: sheets.sheets.map(toSheetRecord),
    sheetRows: sheets.rows.map(toSheetRowRecord),
    foodEntries: food.entries.map(toFoodEntryRecord),
    fridgeItems: food.fridge.map(toFridgeItemRecord),
    foodGoals: food.goals.map(toFoodGoalRecord)
  }
}

/** Temporary desktop compatibility: one legacy snapshot until desktop reads pages. */
export async function readLegacySnapshot(db: D1Database): Promise<MoneySnapshot> {
  const [records, balances] = await Promise.all([readLiveRecords(db), readBalances(db)])
  const balanceById = new Map(balances.balances.map((balance) => [balance.accountId, balance.balanceCents]))
  return {
    accounts: records.accounts.map((row) => ({
      ...toAccountRecord(row),
      balanceCents: balanceById.get(row.id) ?? row.opening_balance_cents
    })),
    categories: records.categories.map(toCategoryRecord),
    transactions: records.transactions.map(toTransactionRecord),
    purchases: records.purchases,
    budgets: records.budgets,
    syncedAt: new Date().toISOString()
  }
}

export interface LegacyRevisions {
  accounts: Record<string, number>
  categories: Record<string, number>
  transactions: Record<string, number>
  purchases: Record<string, number>
  budgets: Record<string, number>
}

/**
 * Revisions for the legacy snapshot, so a client that still reads the whole ledger can send
 * the optimistic concurrency check every write needs.
 */
export async function readLegacyRevisions(db: D1Database): Promise<LegacyRevisions> {
  const collect = async (table: string, key: string): Promise<Record<string, number>> => {
    const rows = await query<{ key: string; revision: number }>(db,
      `SELECT ${key} AS key, revision FROM ${table} WHERE deleted_at IS NULL`)
    return Object.fromEntries(rows.map((row) => [row.key, row.revision]))
  }
  const [accounts, categories, transactions, purchases, budgets] = await Promise.all([
    collect('accounts', 'id'), collect('categories', 'id'), collect('transactions', 'id'),
    collect('purchases', 'id'), collect('budgets', 'month')
  ])
  return { accounts, categories, transactions, purchases, budgets }
}
