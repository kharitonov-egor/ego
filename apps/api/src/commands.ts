import {
  conflict, invalid, notFound,
  type ApiResult, type ChangePayload, type OperationOutcome, type OperationResponse,
  type SyncCommand, type SyncEntity, type SyncOperation
} from '@ego/api-contracts'
import type {
  AccountInput, ArchiveInput, BudgetInput, CategoryInput, PurchaseInput, TransactionInput
} from '@ego/core'
import { query, readLatestChange, serverSequence } from './reads'
import {
  toAccountRecord, toBudgetRecord, toCategoryRecord, toPurchaseRecord, toReceiptItem,
  toTransactionRecord,
  type AccountRow, type BudgetAllocationRow, type BudgetRow, type CategoryRow, type PurchaseRow,
  type ReceiptItemRow, type TransactionRow
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
  budget: 'budgets'
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
  const column = entity === 'budget' ? 'month' : 'id'
  return {
    sql: `EXISTS (SELECT 1 FROM ${TABLES[entity]} WHERE ${column} = ? AND revision = ? AND deleted_at IS NULL)`,
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
  const budgetId = current?.id ?? `budget-${month}`
  const allocationRows: BudgetAllocationRow[] = input.allocations.map((allocation, index) => ({
    id: `${budgetId}-${index}`, budget_id: budgetId, category_id: allocation.categoryId,
    amount_cents: allocation.amountCents
  }))
  const allocationStatements: Statement[] = allocationRows.map((allocation) => ({
    sql: 'INSERT INTO budget_allocations (id, budget_id, category_id, amount_cents) SELECT ?, ?, ?, ?',
    params: [allocation.id, allocation.budget_id, allocation.category_id, allocation.amount_cents]
  }))
  const expected = operation.expectedRevision ?? 0
  const revision = current ? expected + 1 : 1
  const guard = current ? guardFor('budget', month, expected) : null
  const row: BudgetRow = {
    id: budgetId, month, planned_income_cents: input.plannedIncomeCents,
    created_at: current?.created_at ?? now, updated_at: now, revision
  }
  const primary: Statement = current
    ? {
      sql: 'UPDATE budgets SET planned_income_cents = ?, updated_at = ?, revision = revision + 1 WHERE month = ? AND revision = ? AND deleted_at IS NULL',
      params: [input.plannedIncomeCents, now, month, (operation.expectedRevision ?? 0)]
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

function planFor(db: D1Database, operation: SyncOperation, now: string): Promise<ApiResult<Plan>> {
  switch (operation.command.entity) {
    case 'account': return planAccount(db, operation, operation.command, now)
    case 'category': return planCategory(db, operation, operation.command, now)
    case 'transaction': return planTransaction(db, operation, operation.command, now)
    case 'purchase': return planPurchase(db, operation, operation.command, now)
    case 'budget': return planBudget(db, operation, operation.command, now)
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
