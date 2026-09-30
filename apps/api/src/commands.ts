import {
  conflict, invalid, notFound,
  type ApiResult, type ChangePayload, type OperationOutcome, type OperationResponse,
  type SyncCommand, type SyncEntity, type SyncOperation
} from '@ego/api-contracts'
import {
  HABIT_TARGET_LIMIT, diaryMediaIds, entryKindFits, taskMediaIds,
  type AccountInput, type ArchiveInput, type BudgetInput, type CategoryInput, type DiaryMessageInput,
  type GymPlanInput, type GymSetInput, type HabitInput, type MoodInput, type PurchaseInput, type TaskBoardInput,
  type TaskCardInput, type TaskLabelInput, type TaskListInput, type TransactionInput
} from '@ego/core'
import { query, readLatestChange, serverSequence } from './reads'
import {
  toAccountRecord, toBudgetRecord, toCategoryRecord, toDiaryMessageRecord, toGymCategoryRecord, toGymExerciseRecord,
  toGymPlanRecord, toGymSetRecord, toGymWorkoutRecord, toHabitEntryRecord, toHabitRecord, toMoodRecord, toPurchaseRecord,
  toReceiptItem, toTaskBoardRecord, toTaskCardRecord, toTaskLabelRecord, toTaskListRecord, toTransactionRecord,
  type AccountRow, type BudgetAllocationRow, type BudgetRow, type CategoryRow, type DiaryMessageRow, type GymCategoryRow,
  type GymExerciseRow, type GymPlanRow, type GymSetRow, type GymWorkoutRow, type HabitEntryRow, type HabitRow,
  type MoodRow, type PurchaseRow, type ReceiptItemRow, type TaskBoardRow, type TaskCardRow, type TaskLabelRow,
  type TaskListRow, type TransactionRow
} from './rows'

interface Statement {
  sql: string
  params: unknown[]
}

interface Guard {
  sql: string
  params: unknown[]
}

interface Plan {
  /** The write whose affected row count decides whether the precondition held. */
  primary: Statement
  followUps: Statement[]
  changes: Array<{ payload: ChangePayload; action: 'upsert' | 'delete'; entityId: string; revision: number }>
  guard: Guard | null
  outcome: { entity: SyncEntity; entityId: string; revision: number }
}

const TABLES: Record<SyncEntity, string> = {
  account: 'accounts',
  category: 'categories',
  transaction: 'transactions',
  purchase: 'purchases',
  budget: 'budgets',
  gymCategory: 'gym_categories',
  gymExercise: 'gym_exercises',
  gymSet: 'gym_sets',
  gymWorkout: 'gym_workouts',
  gymPlan: 'gym_plans',
  mood: 'mood_entries',
  habit: 'habits',
  habitEntry: 'habit_entries',
  diaryMessage: 'diary_messages',
  taskBoard: 'task_boards',
  taskList: 'task_lists',
  taskLabel: 'task_labels',
  taskCard: 'task_cards'
}

/** Budgets are keyed by month and mood entries by date, so each has one row per period. */
const KEYS: Record<SyncEntity, string> = {
  account: 'id',
  category: 'id',
  transaction: 'id',
  purchase: 'id',
  budget: 'month',
  gymCategory: 'id',
  gymExercise: 'id',
  gymSet: 'id',
  gymWorkout: 'id',
  gymPlan: 'id',
  mood: 'date',
  habit: 'id',
  habitEntry: 'id',
  diaryMessage: 'id',
  taskBoard: 'id',
  taskList: 'id',
  taskLabel: 'id',
  taskCard: 'id'
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

export async function payloadHash(operation: SyncOperation): Promise<string> {
  const text = JSON.stringify(canonical({
    entityId: operation.entityId,
    expectedRevision: operation.expectedRevision,
    command: operation.command
  }))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The precondition every statement of a command shares, evaluated against the revision the
 * device expected. Guarded statements run before the primary write, so the guard cannot
 * mistake another device's matching revision for this command's own update.
 */
function guardFor(entity: SyncEntity, key: string, expectedRevision: number): Guard {
  return {
    sql: `EXISTS (SELECT 1 FROM ${TABLES[entity]} WHERE ${KEYS[entity]} = ? AND revision = ? AND deleted_at IS NULL)`,
    params: [key, expectedRevision]
  }
}

function guarded(statement: Statement, guard: Guard | null): Statement {
  if (!guard) return statement
  const join = statement.sql.trimStart().startsWith('INSERT') ? 'WHERE' : 'AND'
  return {
    sql: `${statement.sql} ${join} ${guard.sql}`,
    params: [...statement.params, ...guard.params]
  }
}

async function accountRow(db: D1Database, id: string): Promise<AccountRow | null> {
  const rows = await query<AccountRow>(db, 'SELECT * FROM accounts WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] ?? null
}

async function categoryRow(db: D1Database, id: string): Promise<CategoryRow | null> {
  const rows = await query<CategoryRow>(db, 'SELECT * FROM categories WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] ?? null
}

async function transactionRow(db: D1Database, id: string): Promise<TransactionRow | null> {
  const rows = await query<TransactionRow>(db, 'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] ?? null
}

async function purchaseRow(db: D1Database, id: string): Promise<PurchaseRow | null> {
  const rows = await query<PurchaseRow>(db, 'SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] ?? null
}

async function budgetRow(db: D1Database, month: string): Promise<BudgetRow | null> {
  const rows = await query<BudgetRow>(db, 'SELECT * FROM budgets WHERE month = ? AND deleted_at IS NULL', [month])
  return rows[0] ?? null
}

/** A cleared month keeps its row, because `month` is unique. Saving it again revives that row. */
async function clearedBudgetRow(db: D1Database, month: string): Promise<BudgetRow | null> {
  const rows = await query<BudgetRow>(db, 'SELECT * FROM budgets WHERE month = ? AND deleted_at IS NOT NULL', [month])
  return rows[0] ?? null
}

async function moodRow(db: D1Database, date: string): Promise<MoodRow | null> {
  const rows = await query<MoodRow>(db, 'SELECT * FROM mood_entries WHERE date = ? AND deleted_at IS NULL', [date])
  return rows[0] ?? null
}

/** A cleared day keeps its row, because `date` is unique. Saving it again revives that row. */
async function clearedMoodRow(db: D1Database, date: string): Promise<MoodRow | null> {
  const rows = await query<MoodRow>(db, 'SELECT * FROM mood_entries WHERE date = ? AND deleted_at IS NOT NULL', [date])
  return rows[0] ?? null
}

async function checkTransactionReferences(db: D1Database, input: TransactionInput): Promise<string | null> {
  const source = await accountRow(db, input.accountId)
  if (!source) return 'Source account was not found'
  if (source.archived_at) return 'Source account is archived'
  if (input.kind === 'transfer') {
    const destination = await accountRow(db, input.destinationAccountId ?? '')
    if (!destination) return 'Destination account was not found'
    if (destination.archived_at) return 'Destination account is archived'
    return null
  }
  const category = await categoryRow(db, input.categoryId ?? '')
  if (!category) return 'Category was not found'
  if (category.archived_at || category.kind !== input.kind) return `Choose an active ${input.kind} category`
  return null
}

async function checkPurchaseReferences(db: D1Database, input: PurchaseInput): Promise<string | null> {
  const account = await accountRow(db, input.accountId)
  if (!account) return 'Account was not found'
  if (account.archived_at) return 'Account is archived'
  const category = await categoryRow(db, input.categoryId)
  if (!category) return 'Category was not found'
  if (category.archived_at || category.kind !== 'expense') return 'Choose an active expense category'
  return null
}

async function checkBudgetReferences(db: D1Database, input: BudgetInput): Promise<string | null> {
  for (const allocation of input.allocations) {
    const category = await categoryRow(db, allocation.categoryId)
    if (!category) return 'Category was not found'
    if (category.archived_at || category.kind !== 'expense') return 'Budget only covers active expense categories'
  }
  return null
}

function transactionRecordFrom(
  id: string, input: TransactionInput, createdAt: string, updatedAt: string, revision: number
) {
  return toTransactionRecord({
    id, kind: input.kind, account_id: input.accountId,
    destination_account_id: input.destinationAccountId, category_id: input.categoryId,
    amount_cents: input.amountCents, date: input.date, notes: input.notes.trim(),
    created_at: createdAt, updated_at: updatedAt, revision
  })
}

const TRANSACTION_COLUMNS =
  '(id, kind, account_id, destination_account_id, category_id, amount_cents, date, notes, created_at, updated_at, revision)'

function insertTransaction(id: string, input: TransactionInput, now: string): Statement {
  return {
    sql: `INSERT INTO transactions ${TRANSACTION_COLUMNS} SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1`,
    params: [id, input.kind, input.accountId, input.destinationAccountId, input.categoryId,
      input.amountCents, input.date, input.notes.trim(), now, now]
  }
}

function updateTransaction(id: string, input: TransactionInput, now: string, expected: number): Statement {
  return {
    sql: `UPDATE transactions SET kind = ?, account_id = ?, destination_account_id = ?, category_id = ?,
      amount_cents = ?, date = ?, notes = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
    params: [input.kind, input.accountId, input.destinationAccountId, input.categoryId,
      input.amountCents, input.date, input.notes.trim(), now, id, expected]
  }
}

function receiptItemStatements(purchaseId: string, input: PurchaseInput): { statements: Statement[]; rows: ReceiptItemRow[] } {
  const rows = input.items.map((item, position): ReceiptItemRow => ({
    id: `${purchaseId}-${position}`, purchase_id: purchaseId, position, name: item.name.trim(),
    quantity: item.quantity, unit_price_cents: item.unitPriceCents,
    gross_price_cents: item.grossPriceCents, discount_cents: item.discountCents,
    line_total_cents: item.lineTotalCents
  }))
  return {
    rows,
    statements: rows.map((row) => ({
      sql: `INSERT INTO receipt_items (id, purchase_id, position, name, quantity, unit_price_cents,
        gross_price_cents, discount_cents, line_total_cents) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?`,
      params: [row.id, row.purchase_id, row.position, row.name, row.quantity, row.unit_price_cents,
        row.gross_price_cents, row.discount_cents, row.line_total_cents]
    }))
  }
}

function purchaseRowFrom(
  id: string, transactionId: string, input: PurchaseInput, createdAt: string, updatedAt: string, revision: number
): PurchaseRow {
  return {
    id, transaction_id: transactionId, merchant: input.merchant.trim(),
    purchase_date: input.purchaseDate, currency: 'USD', subtotal_cents: input.subtotalCents,
    discount_cents: input.discountCents, tax_cents: input.taxCents, fees_cents: input.feesCents,
    total_cents: input.totalCents, created_at: createdAt, updated_at: updatedAt, revision
  }
}

function purchaseTransactionInput(input: PurchaseInput): TransactionInput {
  return {
    kind: 'expense', accountId: input.accountId, destinationAccountId: null,
    categoryId: input.categoryId, amountCents: input.totalCents, date: input.purchaseDate,
    notes: input.merchant.trim()
  }
}

async function planAccount(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'account' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  const current = await accountRow(db, id)
  if (command.type === 'create') {
    const input: AccountInput = command.payload
    const row: AccountRow = {
      id, name: input.name.trim(), kind: input.kind, icon: input.icon, color: input.color,
      opening_balance_cents: input.openingBalanceCents, opening_date: input.openingDate,
      archived_at: null, created_at: now, updated_at: now, revision: 1
    }
    return {
      ok: true,
      data: {
        primary: {
          sql: `INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date,
            archived_at, created_at, updated_at, revision) SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1`,
          params: [id, row.name, row.kind, row.icon, row.color, row.opening_balance_cents,
            row.opening_date, now, now]
        },
        followUps: [],
        guard: null,
        changes: [{ action: 'upsert', entityId: id, revision: 1, payload: { entity: 'account', record: toAccountRecord(row) } }],
        outcome: { entity: 'account', entityId: id, revision: 1 }
      }
    }
  }
  if (!current) return notFound('That account was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const guard = guardFor('account', id, expected)
  if (command.type === 'archive') {
    const input: ArchiveInput = command.payload
    const archivedAt = input.archived ? now : null
    const row: AccountRow = { ...current, archived_at: archivedAt, updated_at: now, revision }
    return {
      ok: true,
      data: {
        primary: {
          sql: 'UPDATE accounts SET archived_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL',
          params: [archivedAt, now, id, expected]
        },
        followUps: [],
        guard,
        changes: [{ action: 'upsert', entityId: id, revision, payload: { entity: 'account', record: toAccountRecord(row) } }],
        outcome: { entity: 'account', entityId: id, revision }
      }
    }
  }
  const input: AccountInput = command.payload
  const row: AccountRow = {
    ...current, name: input.name.trim(), kind: input.kind, icon: input.icon, color: input.color,
    opening_balance_cents: input.openingBalanceCents, opening_date: input.openingDate,
    updated_at: now, revision
  }
  return {
    ok: true,
    data: {
      primary: {
        sql: `UPDATE accounts SET name = ?, kind = ?, icon = ?, color = ?, opening_balance_cents = ?,
          opening_date = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        params: [row.name, row.kind, row.icon, row.color, row.opening_balance_cents,
          row.opening_date, now, id, expected]
      },
      followUps: [],
      guard,
      changes: [{ action: 'upsert', entityId: id, revision, payload: { entity: 'account', record: toAccountRecord(row) } }],
      outcome: { entity: 'account', entityId: id, revision }
    }
  }
}

async function planCategory(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'category' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  const current = await categoryRow(db, id)
  if (command.type === 'create') {
    const input: CategoryInput = command.payload
    const row: CategoryRow = {
      id, name: input.name.trim(), kind: input.kind, icon: input.icon, color: input.color,
      archived_at: null, created_at: now, updated_at: now, revision: 1
    }
    return {
      ok: true,
      data: {
        primary: {
          sql: `INSERT INTO categories (id, name, kind, icon, color, archived_at, created_at, updated_at, revision)
            SELECT ?, ?, ?, ?, ?, NULL, ?, ?, 1`,
          params: [id, row.name, row.kind, row.icon, row.color, now, now]
        },
        followUps: [],
        guard: null,
        changes: [{ action: 'upsert', entityId: id, revision: 1, payload: { entity: 'category', record: toCategoryRecord(row) } }],
        outcome: { entity: 'category', entityId: id, revision: 1 }
      }
    }
  }
  if (!current) return notFound('That category was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const guard = guardFor('category', id, expected)
  if (command.type === 'archive') {
    const archivedAt = command.payload.archived ? now : null
    const row: CategoryRow = { ...current, archived_at: archivedAt, updated_at: now, revision }
    return {
      ok: true,
      data: {
        primary: {
          sql: 'UPDATE categories SET archived_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL',
          params: [archivedAt, now, id, expected]
        },
        followUps: [],
        guard,
        changes: [{ action: 'upsert', entityId: id, revision, payload: { entity: 'category', record: toCategoryRecord(row) } }],
        outcome: { entity: 'category', entityId: id, revision }
      }
    }
  }
  const input: CategoryInput = command.payload
  const used = await query<{ total: number }>(db,
    'SELECT COUNT(*) AS total FROM transactions WHERE category_id = ? AND kind <> ? AND deleted_at IS NULL',
    [id, input.kind])
  if ((used[0]?.total ?? 0) > 0) return conflict('A used category cannot change type')
  const row: CategoryRow = {
    ...current, name: input.name.trim(), kind: input.kind, icon: input.icon, color: input.color,
    updated_at: now, revision
  }
  return {
    ok: true,
    data: {
      primary: {
        sql: `UPDATE categories SET name = ?, kind = ?, icon = ?, color = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        params: [row.name, row.kind, row.icon, row.color, now, id, expected]
      },
      followUps: [],
      guard,
      changes: [{ action: 'upsert', entityId: id, revision, payload: { entity: 'category', record: toCategoryRecord(row) } }],
      outcome: { entity: 'category', entityId: id, revision }
    }
  }
}

async function planTransaction(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'transaction' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type !== 'delete') {
    const problem = await checkTransactionReferences(db, command.payload)
    if (problem) return conflict(problem)
  }
  if (command.type === 'create') {
    const record = transactionRecordFrom(id, command.payload, now, now, 1)
    return {
      ok: true,
      data: {
        primary: insertTransaction(id, command.payload, now),
        followUps: [],
        guard: null,
        changes: [{ action: 'upsert', entityId: id, revision: 1, payload: { entity: 'transaction', record } }],
        outcome: { entity: 'transaction', entityId: id, revision: 1 }
      }
    }
  }
  const current = await transactionRow(db, id)
  if (!current) return notFound('That transaction was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const guard = guardFor('transaction', id, expected)
  if (command.type === 'update') {
    const record = transactionRecordFrom(id, command.payload, current.created_at, now, revision)
    return {
      ok: true,
      data: {
        primary: updateTransaction(id, command.payload, now, expected),
        followUps: [],
        guard,
        changes: [{ action: 'upsert', entityId: id, revision, payload: { entity: 'transaction', record } }],
        outcome: { entity: 'transaction', entityId: id, revision }
      }
    }
  }
  const receipt = await query<PurchaseRow>(db,
    'SELECT * FROM purchases WHERE transaction_id = ? AND deleted_at IS NULL', [id])
  const purchase = receipt[0]
  const changes: Plan['changes'] = [
    { action: 'delete', entityId: id, revision, payload: { entity: 'transaction', record: null } }
  ]
  const followUps: Statement[] = []
  if (purchase) {
    followUps.push(guarded({
      sql: 'UPDATE purchases SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL',
      params: [now, now, purchase.id]
    }, guard))
    changes.push({
      action: 'delete', entityId: purchase.id, revision: purchase.revision + 1,
      payload: { entity: 'purchase', record: null }
    })
  }
  return {
    ok: true,
    data: {
      primary: {
        sql: 'UPDATE transactions SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL',
        params: [now, now, id, expected]
      },
      followUps,
      guard,
      changes,
      outcome: { entity: 'transaction', entityId: id, revision }
    }
  }
}

async function planPurchase(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'purchase' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type !== 'delete') {
    const problem = await checkPurchaseReferences(db, command.payload)
    if (problem) return conflict(problem)
  }
  if (command.type === 'create') {
    const input = command.payload
    const transactionId = `${id}-t`
    const items = receiptItemStatements(id, input)
    const row = purchaseRowFrom(id, transactionId, input, now, now, 1)
    const transaction = transactionRecordFrom(transactionId, purchaseTransactionInput(input), now, now, 1)
    return {
      ok: true,
      data: {
        primary: insertTransaction(transactionId, purchaseTransactionInput(input), now),
        followUps: [
          {
            sql: `INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency, subtotal_cents,
              discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at, revision)
              SELECT ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, 1`,
            params: [id, transactionId, row.merchant, row.purchase_date, row.subtotal_cents,
              row.discount_cents, row.tax_cents, row.fees_cents, row.total_cents, now, now]
          },
          ...items.statements
        ],
        guard: null,
        changes: [
          { action: 'upsert', entityId: transactionId, revision: 1, payload: { entity: 'transaction', record: transaction } },
          {
            action: 'upsert', entityId: id, revision: 1,
            payload: { entity: 'purchase', record: toPurchaseRecord(row, items.rows.map(toReceiptItem)) }
          }
        ],
        outcome: { entity: 'purchase', entityId: id, revision: 1 }
      }
    }
  }
  const current = await purchaseRow(db, id)
  if (!current) return notFound('That receipt was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const guard = guardFor('purchase', id, expected)
  const transaction = await transactionRow(db, current.transaction_id)
  if (!transaction) return notFound('The receipt transaction was not found')
  if (command.type === 'delete') {
    return {
      ok: true,
      data: {
        primary: {
          sql: 'UPDATE purchases SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL',
          params: [now, now, id, expected]
        },
        followUps: [guarded({
          sql: 'UPDATE transactions SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL',
          params: [now, now, transaction.id]
        }, guard)],
        guard,
        changes: [
          { action: 'delete', entityId: id, revision, payload: { entity: 'purchase', record: null } },
          {
            action: 'delete', entityId: transaction.id, revision: transaction.revision + 1,
            payload: { entity: 'transaction', record: null }
          }
        ],
        outcome: { entity: 'purchase', entityId: id, revision }
      }
    }
  }
  const input = command.payload
  const items = receiptItemStatements(id, input)
  const row = purchaseRowFrom(id, transaction.id, input, current.created_at, now, revision)
  const transactionInput = purchaseTransactionInput(input)
  const transactionRecord = transactionRecordFrom(
    transaction.id, transactionInput, transaction.created_at, now, transaction.revision + 1)
  return {
    ok: true,
    data: {
      primary: {
        sql: `UPDATE purchases SET merchant = ?, purchase_date = ?, subtotal_cents = ?, discount_cents = ?,
          tax_cents = ?, fees_cents = ?, total_cents = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
        params: [row.merchant, row.purchase_date, row.subtotal_cents, row.discount_cents,
          row.tax_cents, row.fees_cents, row.total_cents, now, id, expected]
      },
      followUps: [
        guarded({
          sql: `UPDATE transactions SET account_id = ?, category_id = ?, amount_cents = ?, date = ?, notes = ?,
            updated_at = ?, revision = revision + 1 WHERE id = ? AND deleted_at IS NULL`,
          params: [transactionInput.accountId, transactionInput.categoryId, transactionInput.amountCents,
            transactionInput.date, transactionInput.notes, now, transaction.id]
        }, guard),
        guarded({ sql: 'DELETE FROM receipt_items WHERE purchase_id = ?', params: [id] }, guard),
        ...items.statements.map((statement) => guarded(statement, guard))
      ],
      guard,
      changes: [
        { action: 'upsert', entityId: transaction.id, revision: transaction.revision + 1, payload: { entity: 'transaction', record: transactionRecord } },
        {
          action: 'upsert', entityId: id, revision,
          payload: { entity: 'purchase', record: toPurchaseRecord(row, items.rows.map(toReceiptItem)) }
        }
      ],
      outcome: { entity: 'purchase', entityId: id, revision }
    }
  }
}

async function planBudget(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'budget' }>, now: string
): Promise<ApiResult<Plan>> {
  const month = operation.entityId
  const current = await budgetRow(db, month)
  if (command.type === 'delete') {
    if (!current) return notFound('That budget was not found')
    const expected = operation.expectedRevision ?? 0
    const revision = expected + 1
    return {
      ok: true,
      data: {
        primary: {
          sql: 'UPDATE budgets SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE month = ? AND revision = ? AND deleted_at IS NULL',
          params: [now, now, month, expected]
        },
        followUps: [],
        guard: guardFor('budget', month, expected),
        changes: [{ action: 'delete', entityId: month, revision, payload: { entity: 'budget', record: null } }],
        outcome: { entity: 'budget', entityId: month, revision }
      }
    }
  }
  const input: BudgetInput = command.payload
  if (input.month !== month) return invalid('The budget month must match the operation entity ID')
  const problem = await checkBudgetReferences(db, input)
  if (problem) return conflict(problem)
  const cleared = current ? null : await clearedBudgetRow(db, month)
  const budgetId = current?.id ?? cleared?.id ?? `budget-${month}`
  const allocationRows: BudgetAllocationRow[] = input.allocations.map((allocation, index) => ({
    id: `${budgetId}-${index}`, budget_id: budgetId, category_id: allocation.categoryId,
    amount_cents: allocation.amountCents
  }))
  const allocationStatements: Statement[] = allocationRows.map((allocation) => ({
    sql: 'INSERT INTO budget_allocations (id, budget_id, category_id, amount_cents) SELECT ?, ?, ?, ?',
    params: [allocation.id, allocation.budget_id, allocation.category_id, allocation.amount_cents]
  }))
  const expected = operation.expectedRevision ?? 0
  const revision = current ? expected + 1 : cleared ? cleared.revision + 1 : 1
  const guard: Guard | null = current
    ? guardFor('budget', month, expected)
    : cleared
      ? {
        sql: 'EXISTS (SELECT 1 FROM budgets WHERE month = ? AND revision = ? AND deleted_at IS NOT NULL)',
        params: [month, cleared.revision]
      }
      : null
  const row: BudgetRow = {
    id: budgetId, month, planned_income_cents: input.plannedIncomeCents,
    created_at: current?.created_at ?? cleared?.created_at ?? now, updated_at: now, revision
  }
  const primary: Statement = current
    ? {
      sql: 'UPDATE budgets SET planned_income_cents = ?, updated_at = ?, revision = revision + 1 WHERE month = ? AND revision = ? AND deleted_at IS NULL',
      params: [input.plannedIncomeCents, now, month, expected]
    }
    : cleared
      ? {
        sql: 'UPDATE budgets SET planned_income_cents = ?, updated_at = ?, deleted_at = NULL, revision = revision + 1 WHERE month = ? AND revision = ? AND deleted_at IS NOT NULL',
        params: [input.plannedIncomeCents, now, month, cleared.revision]
      }
      : {
        sql: 'INSERT INTO budgets (id, month, planned_income_cents, created_at, updated_at, revision) SELECT ?, ?, ?, ?, ?, 1',
        params: [budgetId, month, input.plannedIncomeCents, now, now]
      }
  return {
    ok: true,
    data: {
      primary,
      followUps: [
        guarded({ sql: 'DELETE FROM budget_allocations WHERE budget_id = ?', params: [budgetId] }, guard),
        ...allocationStatements.map((statement) => guarded(statement, guard))
      ],
      guard,
      changes: [{
        action: 'upsert', entityId: month, revision,
        payload: { entity: 'budget', record: toBudgetRecord(row, allocationRows) }
      }],
      outcome: { entity: 'budget', entityId: month, revision }
    }
  }
}

async function liveRow<T>(db: D1Database, entity: SyncEntity, id: string): Promise<T | null> {
  const rows = await query<T>(db, `SELECT * FROM ${TABLES[entity]} WHERE id = ? AND deleted_at IS NULL`, [id])
  return rows[0] ?? null
}

function both(first: Guard, second: Guard): Guard {
  return { sql: `${first.sql} AND ${second.sql}`, params: [...first.params, ...second.params] }
}

function liveGuard(entity: SyncEntity, id: string): Guard {
  return { sql: `EXISTS (SELECT 1 FROM ${TABLES[entity]} WHERE id = ? AND deleted_at IS NULL)`, params: [id] }
}

/**
 * A create carries a guard too when it depends on another row, so the parent disappearing between
 * the check and the batch leaves nothing half-written: every statement shares the same condition.
 */
function upsertPlan(
  entity: SyncEntity, id: string, revision: number, payload: ChangePayload, primary: Statement, guard: Guard | null
): Plan {
  return {
    primary,
    followUps: [],
    guard,
    changes: [{ action: 'upsert', entityId: id, revision, payload }],
    outcome: { entity, entityId: id, revision }
  }
}

function deletePlan(entity: SyncEntity, id: string, expected: number, now: string, guard: Guard, payload: ChangePayload): Plan {
  const revision = expected + 1
  return {
    primary: {
      sql: `UPDATE ${TABLES[entity]} SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [now, now, id, expected]
    },
    followUps: [],
    guard,
    changes: [{ action: 'delete', entityId: id, revision, payload }],
    outcome: { entity, entityId: id, revision }
  }
}

async function planGymCategory(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'gymCategory' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'create') {
    const input = command.payload
    const row: GymCategoryRow = { id, name: input.name.trim(), color: input.color, created_at: now, updated_at: now, revision: 1 }
    return {
      ok: true,
      data: upsertPlan('gymCategory', id, 1, { entity: 'gymCategory', record: toGymCategoryRecord(row) }, {
        sql: 'INSERT INTO gym_categories (id, name, color, created_at, updated_at, revision) SELECT ?, ?, ?, ?, ?, 1',
        params: [id, row.name, row.color, now, now]
      }, null)
    }
  }
  const current = await liveRow<GymCategoryRow>(db, 'gymCategory', id)
  if (!current) return notFound('That category was not found')
  const expected = operation.expectedRevision ?? 0
  const guard = guardFor('gymCategory', id, expected)
  if (command.type === 'delete') {
    const used = await query<{ total: number }>(db,
      'SELECT COUNT(*) AS total FROM gym_exercises WHERE category_id = ? AND deleted_at IS NULL', [id])
    if ((used[0]?.total ?? 0) > 0) return conflict('Move or delete the exercises in this category first')
    const empty: Guard = {
      sql: 'NOT EXISTS (SELECT 1 FROM gym_exercises WHERE category_id = ? AND deleted_at IS NULL)',
      params: [id]
    }
    const plan = deletePlan('gymCategory', id, expected, now, both(guard, empty), { entity: 'gymCategory', record: null })
    return { ok: true, data: { ...plan, primary: { sql: `${plan.primary.sql} AND ${empty.sql}`, params: [...plan.primary.params, ...empty.params] } } }
  }
  const input = command.payload
  const revision = expected + 1
  const row: GymCategoryRow = { ...current, name: input.name.trim(), color: input.color, updated_at: now, revision }
  return {
    ok: true,
    data: upsertPlan('gymCategory', id, revision, { entity: 'gymCategory', record: toGymCategoryRecord(row) }, {
      sql: 'UPDATE gym_categories SET name = ?, color = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL',
      params: [row.name, row.color, now, id, expected]
    }, guard)
  }
}

/** Deleting an exercise keeps its sets. Every read joins on live exercises, so they stop showing. */
async function planGymExercise(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'gymExercise' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'delete') {
    if (!await liveRow<GymExerciseRow>(db, 'gymExercise', id)) return notFound('That exercise was not found')
    const expected = operation.expectedRevision ?? 0
    return {
      ok: true,
      data: deletePlan('gymExercise', id, expected, now, guardFor('gymExercise', id, expected), { entity: 'gymExercise', record: null })
    }
  }
  const input = command.payload
  if (!await liveRow<GymCategoryRow>(db, 'gymCategory', input.categoryId)) return conflict('That category was deleted')
  const category = liveGuard('gymCategory', input.categoryId)
  if (command.type === 'create') {
    const row: GymExerciseRow = {
      id, name: input.name.trim(), category_id: input.categoryId, type: input.type, weight_unit: input.weightUnit,
      notes: input.notes.trim(), created_at: now, updated_at: now, revision: 1
    }
    return {
      ok: true,
      data: upsertPlan('gymExercise', id, 1, { entity: 'gymExercise', record: toGymExerciseRecord(row) }, guarded({
        sql: `INSERT INTO gym_exercises (id, name, category_id, type, weight_unit, notes, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.name, row.category_id, row.type, row.weight_unit, row.notes, now, now]
      }, category), category)
    }
  }
  const current = await liveRow<GymExerciseRow>(db, 'gymExercise', id)
  if (!current) return notFound('That exercise was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const row: GymExerciseRow = {
    ...current, name: input.name.trim(), category_id: input.categoryId, type: input.type,
    weight_unit: input.weightUnit, notes: input.notes.trim(), updated_at: now, revision
  }
  return {
    ok: true,
    data: upsertPlan('gymExercise', id, revision, { entity: 'gymExercise', record: toGymExerciseRecord(row) }, {
      sql: `UPDATE gym_exercises SET name = ?, category_id = ?, type = ?, weight_unit = ?, notes = ?, updated_at = ?,
        revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.name, row.category_id, row.type, row.weight_unit, row.notes, now, id, expected]
    }, both(guardFor('gymExercise', id, expected), category))
  }
}

function gymSetRowFrom(id: string, input: GymSetInput, createdAt: string, updatedAt: string, revision: number): GymSetRow {
  return {
    id, exercise_id: input.exerciseId, date: input.date, position: input.position, weight: input.weight,
    weight_unit: input.weightUnit, reps: input.reps, distance: input.distance, distance_unit: input.distanceUnit,
    duration_seconds: input.durationSeconds, comment: input.comment.trim(), created_at: createdAt,
    updated_at: updatedAt, revision
  }
}

async function planGymSet(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'gymSet' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'delete') {
    if (!await liveRow<GymSetRow>(db, 'gymSet', id)) return notFound('That set was not found')
    const expected = operation.expectedRevision ?? 0
    return {
      ok: true,
      data: deletePlan('gymSet', id, expected, now, guardFor('gymSet', id, expected), { entity: 'gymSet', record: null })
    }
  }
  const input = command.payload
  if (!await liveRow<GymExerciseRow>(db, 'gymExercise', input.exerciseId)) {
    return conflict('That exercise was deleted on another device')
  }
  const exercise = liveGuard('gymExercise', input.exerciseId)
  if (command.type === 'create') {
    const row = gymSetRowFrom(id, input, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('gymSet', id, 1, { entity: 'gymSet', record: toGymSetRecord(row) }, guarded({
        sql: `INSERT INTO gym_sets (id, exercise_id, date, position, weight, weight_unit, reps, distance, distance_unit,
          duration_seconds, comment, created_at, updated_at, revision) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.exercise_id, row.date, row.position, row.weight, row.weight_unit, row.reps, row.distance,
          row.distance_unit, row.duration_seconds, row.comment, now, now]
      }, exercise), exercise)
    }
  }
  const current = await liveRow<GymSetRow>(db, 'gymSet', id)
  if (!current) return notFound('That set was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const row = gymSetRowFrom(id, input, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('gymSet', id, revision, { entity: 'gymSet', record: toGymSetRecord(row) }, {
      sql: `UPDATE gym_sets SET exercise_id = ?, date = ?, position = ?, weight = ?, weight_unit = ?, reps = ?,
        distance = ?, distance_unit = ?, duration_seconds = ?, comment = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.exercise_id, row.date, row.position, row.weight, row.weight_unit, row.reps, row.distance,
        row.distance_unit, row.duration_seconds, row.comment, now, id, expected]
    }, both(guardFor('gymSet', id, expected), exercise))
  }
}

/** A day's record is created by its first save and updated by every later one. */
async function planGymWorkout(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'gymWorkout' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  const input = command.payload
  const current = await liveRow<GymWorkoutRow>(db, 'gymWorkout', id)
  const order = JSON.stringify(input.exerciseOrder)
  const supersets = JSON.stringify(input.supersets)
  const notes = input.notes.trim()
  if (!current) {
    if (operation.expectedRevision !== null) return notFound('That workout was not found')
    const row: GymWorkoutRow = { id, exercise_order: order, supersets, notes, created_at: now, updated_at: now, revision: 1 }
    return {
      ok: true,
      data: upsertPlan('gymWorkout', id, 1, { entity: 'gymWorkout', record: toGymWorkoutRecord(row) }, {
        sql: `INSERT INTO gym_workouts (id, exercise_order, supersets, notes, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, 1`,
        params: [id, order, supersets, notes, now, now]
      }, null)
    }
  }
  if (operation.expectedRevision === null) {
    return conflict('This day was arranged on another device', await readLatestChange(db, 'gymWorkout', id))
  }
  const expected = operation.expectedRevision
  const revision = expected + 1
  const row: GymWorkoutRow = { ...current, exercise_order: order, supersets, notes, updated_at: now, revision }
  return {
    ok: true,
    data: upsertPlan('gymWorkout', id, revision, { entity: 'gymWorkout', record: toGymWorkoutRecord(row) }, {
      sql: `UPDATE gym_workouts SET exercise_order = ?, supersets = ?, notes = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [order, supersets, notes, now, id, expected]
    }, guardFor('gymWorkout', id, expected))
  }
}

function gymPlanRowFrom(id: string, input: GymPlanInput, createdAt: string, updatedAt: string, revision: number): GymPlanRow {
  return {
    id, name: input.name.trim(), exercise_order: JSON.stringify(input.exerciseOrder),
    supersets: JSON.stringify(input.supersets), created_at: createdAt, updated_at: updatedAt, revision
  }
}

async function planGymPlan(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'gymPlan' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'create') {
    const row = gymPlanRowFrom(id, command.payload, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('gymPlan', id, 1, { entity: 'gymPlan', record: toGymPlanRecord(row) }, {
        sql: `INSERT INTO gym_plans (id, name, exercise_order, supersets, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.name, row.exercise_order, row.supersets, now, now]
      }, null)
    }
  }
  const current = await liveRow<GymPlanRow>(db, 'gymPlan', id)
  if (!current) return notFound('That plan was not found')
  const expected = operation.expectedRevision ?? 0
  const guard = guardFor('gymPlan', id, expected)
  if (command.type === 'delete') {
    return { ok: true, data: deletePlan('gymPlan', id, expected, now, guard, { entity: 'gymPlan', record: null }) }
  }
  const revision = expected + 1
  const row = gymPlanRowFrom(id, command.payload, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('gymPlan', id, revision, { entity: 'gymPlan', record: toGymPlanRecord(row) }, {
      sql: `UPDATE gym_plans SET name = ?, exercise_order = ?, supersets = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.name, row.exercise_order, row.supersets, now, id, expected]
    }, guard)
  }
}

async function planMood(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'mood' }>, now: string
): Promise<ApiResult<Plan>> {
  const date = operation.entityId
  const current = await moodRow(db, date)
  if (command.type === 'delete') {
    if (!current) return notFound('That mood entry was not found')
    const expected = operation.expectedRevision ?? 0
    const revision = expected + 1
    return {
      ok: true,
      data: {
        primary: {
          sql: 'UPDATE mood_entries SET deleted_at = ?, updated_at = ?, revision = revision + 1 WHERE date = ? AND revision = ? AND deleted_at IS NULL',
          params: [now, now, date, expected]
        },
        followUps: [],
        guard: guardFor('mood', date, expected),
        changes: [{ action: 'delete', entityId: date, revision, payload: { entity: 'mood', record: null } }],
        outcome: { entity: 'mood', entityId: date, revision }
      }
    }
  }
  const input: MoodInput = command.payload
  if (input.date !== date) return invalid('The mood date must match the operation entity ID')
  const cleared = current ? null : await clearedMoodRow(db, date)
  const expected = operation.expectedRevision ?? 0
  const revision = current ? expected + 1 : cleared ? cleared.revision + 1 : 1
  const row: MoodRow = {
    id: current?.id ?? cleared?.id ?? `mood-${date}`, date, mood: input.mood, note: input.note.trim(),
    created_at: current?.created_at ?? cleared?.created_at ?? now, updated_at: now, revision
  }
  const guard: Guard | null = current
    ? guardFor('mood', date, expected)
    : cleared
      ? {
        sql: 'EXISTS (SELECT 1 FROM mood_entries WHERE date = ? AND revision = ? AND deleted_at IS NOT NULL)',
        params: [date, cleared.revision]
      }
      : null
  const primary: Statement = current
    ? {
      sql: 'UPDATE mood_entries SET mood = ?, note = ?, updated_at = ?, revision = revision + 1 WHERE date = ? AND revision = ? AND deleted_at IS NULL',
      params: [row.mood, row.note, now, date, expected]
    }
    : cleared
      ? {
        sql: 'UPDATE mood_entries SET mood = ?, note = ?, updated_at = ?, deleted_at = NULL, revision = revision + 1 WHERE date = ? AND revision = ? AND deleted_at IS NOT NULL',
        params: [row.mood, row.note, now, date, cleared.revision]
      }
      : {
        sql: 'INSERT INTO mood_entries (id, date, mood, note, created_at, updated_at, revision) SELECT ?, ?, ?, ?, ?, ?, 1',
        params: [row.id, date, row.mood, row.note, now, now]
      }
  return {
    ok: true,
    data: {
      primary,
      followUps: [],
      guard,
      changes: [{ action: 'upsert', entityId: date, revision, payload: { entity: 'mood', record: toMoodRecord(row) } }],
      outcome: { entity: 'mood', entityId: date, revision }
    }
  }
}

/** A field an older build leaves out keeps its saved value, so that build cannot reset it. */
function habitRowFrom(
  id: string, input: HabitInput, current: HabitRow | null, createdAt: string, updatedAt: string, revision: number
): HabitRow {
  return {
    id, name: input.name.trim(), icon: input.icon.trim(), kind: input.kind, start_date: input.startDate,
    position: input.position, target: input.target ?? current?.target ?? 1, period: input.period ?? current?.period ?? 'day',
    started_at: input.startedAt === undefined ? current?.started_at ?? null : input.startedAt,
    created_at: createdAt, updated_at: updatedAt, revision
  }
}

async function planHabit(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'habit' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'create') {
    const row = habitRowFrom(id, command.payload, null, now, now, 1)
    if (row.target > HABIT_TARGET_LIMIT[row.period]) return invalid(`A weekly habit can ask for at most ${HABIT_TARGET_LIMIT.week} days`)
    return {
      ok: true,
      data: upsertPlan('habit', id, 1, { entity: 'habit', record: toHabitRecord(row) }, {
        sql: `INSERT INTO habits (id, name, icon, kind, start_date, position, target, period, started_at, created_at,
          updated_at, revision) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.name, row.icon, row.kind, row.start_date, row.position, row.target, row.period, row.started_at, now, now]
      }, null)
    }
  }
  const current = await liveRow<HabitRow>(db, 'habit', id)
  if (!current) return notFound('That habit was not found')
  const expected = operation.expectedRevision ?? 0
  const guard = guardFor('habit', id, expected)
  if (command.type === 'delete') {
    return { ok: true, data: deletePlan('habit', id, expected, now, guard, { entity: 'habit', record: null }) }
  }
  if (command.payload.kind !== current.kind) return invalid('A habit cannot switch between building and breaking')
  const revision = expected + 1
  const row = habitRowFrom(id, command.payload, current, current.created_at, now, revision)
  if (row.target > HABIT_TARGET_LIMIT[row.period]) return invalid(`A weekly habit can ask for at most ${HABIT_TARGET_LIMIT.week} days`)
  return {
    ok: true,
    data: upsertPlan('habit', id, revision, { entity: 'habit', record: toHabitRecord(row) }, {
      sql: `UPDATE habits SET name = ?, icon = ?, start_date = ?, position = ?, target = ?, period = ?, started_at = ?,
        updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.name, row.icon, row.start_date, row.position, row.target, row.period, row.started_at, now, id, expected]
    }, guard)
  }
}

/** Entries are only ever added or removed. Unchecking a day deletes its `done` entry. */
async function planHabitEntry(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'habitEntry' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'delete') {
    if (!await liveRow<HabitEntryRow>(db, 'habitEntry', id)) return notFound('That entry was not found')
    const expected = operation.expectedRevision ?? 0
    return {
      ok: true,
      data: deletePlan('habitEntry', id, expected, now, guardFor('habitEntry', id, expected), { entity: 'habitEntry', record: null })
    }
  }
  const input = command.payload
  const habit = await liveRow<HabitRow>(db, 'habit', input.habitId)
  if (!habit) return conflict('That habit was deleted on another device')
  if (!entryKindFits(habit.kind, input.kind)) return invalid(`A habit to ${habit.kind} cannot log ${input.kind}`)
  const parent = liveGuard('habit', input.habitId)
  const row: HabitEntryRow = {
    id, habit_id: input.habitId, date: input.date, kind: input.kind, logged_at: input.loggedAt ?? null,
    created_at: now, updated_at: now, revision: 1
  }
  return {
    ok: true,
    data: upsertPlan('habitEntry', id, 1, { entity: 'habitEntry', record: toHabitEntryRecord(row) }, guarded({
      sql: `INSERT INTO habit_entries (id, habit_id, date, kind, logged_at, created_at, updated_at, revision)
        SELECT ?, ?, ?, ?, ?, ?, ?, 1`,
      params: [id, row.habit_id, row.date, row.kind, row.logged_at, now, now]
    }, parent), parent)
  }
}

/** The files a message names that have not finished uploading. */
async function missingDiaryMedia(db: D1Database, input: DiaryMessageInput): Promise<string[]> {
  const ids = diaryMediaIds(input)
  if (ids.length === 0) return []
  const rows = await query<{ id: string }>(db,
    `SELECT id FROM diary_media WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
  const found = new Set(rows.map((row) => row.id))
  return ids.filter((id) => !found.has(id))
}

function diaryRowFrom(
  id: string, input: DiaryMessageInput, createdAt: string, updatedAt: string, revision: number
): DiaryMessageRow {
  return {
    id, sent_at: input.sentAt, text: input.text, entities: JSON.stringify(input.entities),
    attachments: JSON.stringify(input.attachments), reply_to_id: input.replyToId, forwarded: input.forwarded ? 1 : 0,
    forwarded_from: input.forwardedFrom, pinned_at: input.pinnedAt, edited_at: input.editedAt, source: input.source,
    created_at: createdAt, updated_at: updatedAt, revision
  }
}

async function planDiaryMessage(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'diaryMessage' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'delete') {
    if (!await liveRow<DiaryMessageRow>(db, 'diaryMessage', id)) return notFound('That message was not found')
    const expected = operation.expectedRevision ?? 0
    return {
      ok: true,
      data: deletePlan('diaryMessage', id, expected, now, guardFor('diaryMessage', id, expected), { entity: 'diaryMessage', record: null })
    }
  }
  const input = command.payload
  const missing = await missingDiaryMedia(db, input)
  if (missing.length > 0) {
    return invalid(missing.length === 1 ? 'Upload the attached file before sending' : `Upload the ${missing.length} attached files before sending`)
  }
  if (command.type === 'create') {
    const row = diaryRowFrom(id, input, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('diaryMessage', id, 1, { entity: 'diaryMessage', record: toDiaryMessageRecord(row) }, {
        sql: `INSERT INTO diary_messages (id, sent_at, text, entities, attachments, reply_to_id, forwarded, forwarded_from,
          pinned_at, edited_at, source, created_at, updated_at, revision) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.sent_at, row.text, row.entities, row.attachments, row.reply_to_id, row.forwarded, row.forwarded_from,
          row.pinned_at, row.edited_at, row.source, now, now]
      }, null)
    }
  }
  const current = await liveRow<DiaryMessageRow>(db, 'diaryMessage', id)
  if (!current) return notFound('That message was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const row = diaryRowFrom(id, input, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('diaryMessage', id, revision, { entity: 'diaryMessage', record: toDiaryMessageRecord(row) }, {
      sql: `UPDATE diary_messages SET sent_at = ?, text = ?, entities = ?, attachments = ?, reply_to_id = ?, forwarded = ?,
        forwarded_from = ?, pinned_at = ?, edited_at = ?, source = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.sent_at, row.text, row.entities, row.attachments, row.reply_to_id, row.forwarded, row.forwarded_from,
        row.pinned_at, row.edited_at, row.source, now, id, expected]
    }, guardFor('diaryMessage', id, expected))
  }
}

function taskBoardRowFrom(id: string, input: TaskBoardInput, createdAt: string, updatedAt: string, revision: number): TaskBoardRow {
  return {
    id, name: input.name.trim(), icon: input.icon.trim(), position: input.position, hide_done: input.hideDone ? 1 : 0,
    archived_at: input.archivedAt, created_at: createdAt, updated_at: updatedAt, revision
  }
}

async function planTaskBoard(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'taskBoard' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'create') {
    const row = taskBoardRowFrom(id, command.payload, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('taskBoard', id, 1, { entity: 'taskBoard', record: toTaskBoardRecord(row) }, {
        sql: `INSERT INTO task_boards (id, name, icon, position, hide_done, archived_at, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.name, row.icon, row.position, row.hide_done, row.archived_at, now, now]
      }, null)
    }
  }
  const current = await liveRow<TaskBoardRow>(db, 'taskBoard', id)
  if (!current) return notFound('That board was not found')
  const expected = operation.expectedRevision ?? 0
  const guard = guardFor('taskBoard', id, expected)
  if (command.type === 'delete') {
    return { ok: true, data: deletePlan('taskBoard', id, expected, now, guard, { entity: 'taskBoard', record: null }) }
  }
  const revision = expected + 1
  const row = taskBoardRowFrom(id, command.payload, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('taskBoard', id, revision, { entity: 'taskBoard', record: toTaskBoardRecord(row) }, {
      sql: `UPDATE task_boards SET name = ?, icon = ?, position = ?, hide_done = ?, archived_at = ?, updated_at = ?,
        revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.name, row.icon, row.position, row.hide_done, row.archived_at, now, id, expected]
    }, guard)
  }
}

function taskListRowFrom(id: string, input: TaskListInput, createdAt: string, updatedAt: string, revision: number): TaskListRow {
  return {
    id, board_id: input.boardId, name: input.name.trim(), position: input.position, archived_at: input.archivedAt,
    created_at: createdAt, updated_at: updatedAt, revision
  }
}

async function planTaskList(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'taskList' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'create') {
    const input = command.payload
    if (!await liveRow<TaskBoardRow>(db, 'taskBoard', input.boardId)) return conflict('That board was deleted on another device')
    const parent = liveGuard('taskBoard', input.boardId)
    const row = taskListRowFrom(id, input, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('taskList', id, 1, { entity: 'taskList', record: toTaskListRecord(row) }, guarded({
        sql: `INSERT INTO task_lists (id, board_id, name, position, archived_at, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.board_id, row.name, row.position, row.archived_at, now, now]
      }, parent), parent)
    }
  }
  const current = await liveRow<TaskListRow>(db, 'taskList', id)
  if (!current) return notFound('That list was not found')
  const expected = operation.expectedRevision ?? 0
  const guard = guardFor('taskList', id, expected)
  if (command.type === 'delete') {
    return { ok: true, data: deletePlan('taskList', id, expected, now, guard, { entity: 'taskList', record: null }) }
  }
  if (command.payload.boardId !== current.board_id) return invalid('A list cannot move to another board')
  const revision = expected + 1
  const row = taskListRowFrom(id, command.payload, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('taskList', id, revision, { entity: 'taskList', record: toTaskListRecord(row) }, {
      sql: `UPDATE task_lists SET name = ?, position = ?, archived_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.name, row.position, row.archived_at, now, id, expected]
    }, guard)
  }
}

function taskLabelRowFrom(id: string, input: TaskLabelInput, createdAt: string, updatedAt: string, revision: number): TaskLabelRow {
  return {
    id, board_id: input.boardId, name: input.name.trim(), color: input.color, position: input.position,
    created_at: createdAt, updated_at: updatedAt, revision
  }
}

async function planTaskLabel(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'taskLabel' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'create') {
    const input = command.payload
    if (!await liveRow<TaskBoardRow>(db, 'taskBoard', input.boardId)) return conflict('That board was deleted on another device')
    const parent = liveGuard('taskBoard', input.boardId)
    const row = taskLabelRowFrom(id, input, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('taskLabel', id, 1, { entity: 'taskLabel', record: toTaskLabelRecord(row) }, guarded({
        sql: `INSERT INTO task_labels (id, board_id, name, color, position, created_at, updated_at, revision)
          SELECT ?, ?, ?, ?, ?, ?, ?, 1`,
        params: [id, row.board_id, row.name, row.color, row.position, now, now]
      }, parent), parent)
    }
  }
  const current = await liveRow<TaskLabelRow>(db, 'taskLabel', id)
  if (!current) return notFound('That label was not found')
  const expected = operation.expectedRevision ?? 0
  const guard = guardFor('taskLabel', id, expected)
  if (command.type === 'delete') {
    return { ok: true, data: deletePlan('taskLabel', id, expected, now, guard, { entity: 'taskLabel', record: null }) }
  }
  if (command.payload.boardId !== current.board_id) return invalid('A label cannot move to another board')
  const revision = expected + 1
  const row = taskLabelRowFrom(id, command.payload, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('taskLabel', id, revision, { entity: 'taskLabel', record: toTaskLabelRecord(row) }, {
      sql: `UPDATE task_labels SET name = ?, color = ?, position = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [row.name, row.color, row.position, now, id, expected]
    }, guard)
  }
}

/** The files a card names that have not finished uploading. */
async function missingTaskMedia(db: D1Database, input: TaskCardInput): Promise<string[]> {
  const ids = taskMediaIds(input)
  if (ids.length === 0) return []
  const rows = await query<{ id: string }>(db,
    `SELECT id FROM task_media WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
  const found = new Set(rows.map((row) => row.id))
  return ids.filter((id) => !found.has(id))
}

function taskCardRowFrom(id: string, input: TaskCardInput, createdAt: string, updatedAt: string, revision: number): TaskCardRow {
  return {
    id, board_id: input.boardId, list_id: input.listId, title: input.title.trim(), description: input.description,
    position: input.position, label_ids: JSON.stringify(input.labelIds), priority: input.priority,
    due_date: input.dueDate, due_time: input.dueTime, reminder_minutes: input.reminderMinutes,
    done_at: input.doneAt, archived_at: input.archivedAt,
    checklists: JSON.stringify(input.checklists), attachments: JSON.stringify(input.attachments),
    activity: JSON.stringify(input.activity), created_at: createdAt, updated_at: updatedAt, revision
  }
}

const TASK_CARD_COLUMNS = [
  'board_id', 'list_id', 'title', 'description', 'position', 'label_ids', 'priority', 'due_date', 'due_time',
  'reminder_minutes', 'done_at', 'archived_at', 'checklists', 'attachments', 'activity'
] as const

function taskCardValues(row: TaskCardRow): unknown[] {
  return TASK_CARD_COLUMNS.map((column) => row[column])
}

/**
 * Label IDs are not checked: a label deleted on another device just stops showing. The list is,
 * because a card in a list that is gone, or on another board, would vanish from every screen.
 */
async function planTaskCard(
  db: D1Database, operation: SyncOperation, command: Extract<SyncCommand, { entity: 'taskCard' }>, now: string
): Promise<ApiResult<Plan>> {
  const id = operation.entityId
  if (command.type === 'delete') {
    if (!await liveRow<TaskCardRow>(db, 'taskCard', id)) return notFound('That card was not found')
    const expected = operation.expectedRevision ?? 0
    return {
      ok: true,
      data: deletePlan('taskCard', id, expected, now, guardFor('taskCard', id, expected), { entity: 'taskCard', record: null })
    }
  }
  const input = command.payload
  const list = await liveRow<TaskListRow>(db, 'taskList', input.listId)
  if (!list || !await liveRow<TaskBoardRow>(db, 'taskBoard', input.boardId)) return conflict('That list was deleted on another device')
  if (list.board_id !== input.boardId) return invalid('That list is on another board')
  const missing = await missingTaskMedia(db, input)
  if (missing.length > 0) {
    return invalid(missing.length === 1 ? 'Upload the attached file before saving' : `Upload the ${missing.length} attached files before saving`)
  }
  const parents = both(liveGuard('taskList', input.listId), liveGuard('taskBoard', input.boardId))
  if (command.type === 'create') {
    const row = taskCardRowFrom(id, input, now, now, 1)
    return {
      ok: true,
      data: upsertPlan('taskCard', id, 1, { entity: 'taskCard', record: toTaskCardRecord(row) }, guarded({
        sql: `INSERT INTO task_cards (id, ${TASK_CARD_COLUMNS.join(', ')}, created_at, updated_at, revision)
          SELECT ?, ${TASK_CARD_COLUMNS.map(() => '?').join(', ')}, ?, ?, 1`,
        params: [id, ...taskCardValues(row), now, now]
      }, parents), parents)
    }
  }
  const current = await liveRow<TaskCardRow>(db, 'taskCard', id)
  if (!current) return notFound('That card was not found')
  const expected = operation.expectedRevision ?? 0
  const revision = expected + 1
  const row = taskCardRowFrom(id, input, current.created_at, now, revision)
  return {
    ok: true,
    data: upsertPlan('taskCard', id, revision, { entity: 'taskCard', record: toTaskCardRecord(row) }, guarded({
      sql: `UPDATE task_cards SET ${TASK_CARD_COLUMNS.map((column) => `${column} = ?`).join(', ')}, updated_at = ?,
        revision = revision + 1 WHERE id = ? AND revision = ? AND deleted_at IS NULL`,
      params: [...taskCardValues(row), now, id, expected]
    }, parents), both(guardFor('taskCard', id, expected), parents))
  }
}

function planFor(db: D1Database, operation: SyncOperation, now: string): Promise<ApiResult<Plan>> {
  switch (operation.command.entity) {
    case 'account': return planAccount(db, operation, operation.command, now)
    case 'category': return planCategory(db, operation, operation.command, now)
    case 'transaction': return planTransaction(db, operation, operation.command, now)
    case 'purchase': return planPurchase(db, operation, operation.command, now)
    case 'budget': return planBudget(db, operation, operation.command, now)
    case 'gymCategory': return planGymCategory(db, operation, operation.command, now)
    case 'gymExercise': return planGymExercise(db, operation, operation.command, now)
    case 'gymSet': return planGymSet(db, operation, operation.command, now)
    case 'gymWorkout': return planGymWorkout(db, operation, operation.command, now)
    case 'gymPlan': return planGymPlan(db, operation, operation.command, now)
    case 'mood': return planMood(db, operation, operation.command, now)
    case 'habit': return planHabit(db, operation, operation.command, now)
    case 'habitEntry': return planHabitEntry(db, operation, operation.command, now)
    case 'diaryMessage': return planDiaryMessage(db, operation, operation.command, now)
    case 'taskBoard': return planTaskBoard(db, operation, operation.command, now)
    case 'taskList': return planTaskList(db, operation, operation.command, now)
    case 'taskLabel': return planTaskLabel(db, operation, operation.command, now)
    case 'taskCard': return planTaskCard(db, operation, operation.command, now)
  }
}

interface ReceiptRow {
  operation_id: string
  payload_hash: string
  entity: SyncEntity
  entity_id: string
  revision: number
  server_sequence: number
}

export async function applyOperation(
  db: D1Database, operation: SyncOperation, now: string
): Promise<ApiResult<OperationOutcome>> {
  const hash = await payloadHash(operation)
  const existing = await query<ReceiptRow>(db,
    'SELECT * FROM operations WHERE operation_id = ?', [operation.operationId])
  const receipt = existing[0]
  if (receipt) {
    if (receipt.payload_hash !== hash) {
      return invalid('That operation ID was already used with a different payload')
    }
    return {
      ok: true,
      data: {
        operationId: operation.operationId, status: 'duplicate', entity: receipt.entity,
        entityId: receipt.entity_id, revision: receipt.revision, serverSequence: receipt.server_sequence
      }
    }
  }
  const plan = await planFor(db, operation, now)
  if (!plan.ok) return plan
  const { primary, followUps, changes, guard, outcome } = plan.data
  const changeStatements = changes.map((change) => guarded({
    sql: `INSERT INTO changes (entity, entity_id, action, revision, committed_at, payload)
      SELECT ?, ?, ?, ?, ?, ?`,
    params: [change.payload.entity, change.entityId, change.action, change.revision, now,
      change.action === 'delete' ? null : JSON.stringify(change.payload.record)]
  }, guard))
  const receiptStatement = guarded({
    sql: `INSERT INTO operations (operation_id, payload_hash, entity, entity_id, revision, server_sequence, created_at)
      SELECT ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) FROM changes), ?`,
    params: [operation.operationId, hash, outcome.entity, outcome.entityId, outcome.revision, now]
  }, guard)
  const guardedFirst = [...followUps, ...changeStatements, receiptStatement]
  const statements = guard ? [...guardedFirst, primary] : [primary, ...guardedFirst]
  const primaryIndex = guard ? statements.length - 1 : 0
  let results: D1Result[]
  try {
    results = await db.batch(statements.map((statement) =>
      statement.params.length > 0 ? db.prepare(statement.sql).bind(...statement.params) : db.prepare(statement.sql)))
  } catch {
    return conflict('That record could not be written as requested',
      await readLatestChange(db, outcome.entity, outcome.entityId))
  }
  if ((results[primaryIndex]?.meta.changes ?? 0) === 0) {
    return conflict('That record changed on another device',
      await readLatestChange(db, outcome.entity, outcome.entityId))
  }
  const applied = await query<ReceiptRow>(db,
    'SELECT * FROM operations WHERE operation_id = ?', [operation.operationId])
  return {
    ok: true,
    data: {
      operationId: operation.operationId,
      status: 'applied',
      entity: outcome.entity,
      entityId: outcome.entityId,
      revision: outcome.revision,
      serverSequence: applied[0]?.server_sequence ?? await serverSequence(db)
    }
  }
}

export async function applyOperations(
  db: D1Database, operations: SyncOperation[], now: string
): Promise<OperationResponse> {
  const results: OperationOutcome[] = []
  for (const operation of operations) {
    const result = await applyOperation(db, operation, now)
    if (!result.ok) {
      return {
        results,
        failed: { operationId: operation.operationId, error: result.error },
        serverSequence: await serverSequence(db)
      }
    }
    results.push(result.data)
  }
  return { results, failed: null, serverSequence: await serverSequence(db) }
}
