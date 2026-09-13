import {
  BALANCES_SQL, FEED_COLUMNS, FEED_FROM, budgetTotalsSql, cursorCondition, encodeCursor,
  feedConditions, summarySql, transactionQueryIdentity,
  type AccountBalance, type FeedCursor, type FeedTransaction, type PeriodSummary,
  type PurchaseRecord, type ReferenceData, type TransactionFilters
} from '@ego/api-contracts'
import type { ReceiptItem } from '@ego/core'
import type { LocalDatabase, SqlParam } from '../database/types'

export type PendingState = 'none' | 'pending' | 'failed' | 'conflict'

export interface LocalFeedTransaction extends FeedTransaction {
  pending: PendingState
}

export interface LocalTransactionPage {
  items: LocalFeedTransaction[]
  nextCursor: string | null
  hasMore: boolean
  totalCount: number
  queryIdentity: string
}

interface FeedRow {
  id: string
  kind: FeedTransaction['kind']
  account_id: string
  destination_account_id: string | null
  category_id: string | null
  amount_cents: number
  date: string
  notes: string
  created_at: string
  updated_at: string
  revision: number
  account_name: string
  destination_account_name: string | null
  category_name: string | null
  category_icon: string | null
  category_color: string | null
  merchant: string | null
  purchase_id: string | null
  pending_status: PendingState | null
}

const PENDING_COLUMN = `(SELECT o.status FROM outbox o
    WHERE (o.entity = 'transaction' AND o.entity_id = t.id)
       OR (o.entity = 'purchase' AND o.entity_id = p.id)
    ORDER BY CASE o.status WHEN 'conflict' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END, o.created_at
    LIMIT 1) AS pending_status`

function params(values: unknown[]): SqlParam[] {
  return values as SqlParam[]
}

function toFeedTransaction(row: FeedRow): LocalFeedTransaction {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id,
    destinationAccountId: row.destination_account_id,
    categoryId: row.category_id,
    amountCents: row.amount_cents,
    date: row.date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    accountName: row.account_name,
    destinationAccountName: row.destination_account_name,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
    merchant: row.merchant,
    purchaseId: row.purchase_id,
    hasReceipt: row.purchase_id !== null,
    pending: row.pending_status ?? 'none'
  }
}

/**
 * The same keyset predicate the API uses, run against the phone's own database, plus the
 * delivery state of any operation still waiting for the server.
 */
export async function localTransactionPage(
  db: LocalDatabase, filters: TransactionFilters, cursor: FeedCursor | null, pageSize: number
): Promise<LocalTransactionPage> {
  const conditions = feedConditions(filters)
  const keyset = cursorCondition(cursor)
  const where = [...conditions.clauses, ...keyset.clauses].join(' AND ')
  const rows = await db.all<FeedRow>(
    `SELECT ${FEED_COLUMNS}, ${PENDING_COLUMN} ${FEED_FROM}
      WHERE ${where}
      ORDER BY t.date DESC, t.created_at DESC, t.id DESC
      LIMIT ?`,
    params([...conditions.params, ...keyset.params, pageSize + 1]))
  const totals = await db.all<{ total: number }>(
    `SELECT COUNT(*) AS total ${FEED_FROM} WHERE ${conditions.clauses.join(' AND ')}`,
    params(conditions.params))
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

export async function localTransaction(db: LocalDatabase, id: string): Promise<LocalFeedTransaction | null> {
  const rows = await db.all<FeedRow>(
    `SELECT ${FEED_COLUMNS}, ${PENDING_COLUMN} ${FEED_FROM} WHERE t.deleted_at IS NULL AND t.id = ?`, [id])
  return rows[0] ? toFeedTransaction(rows[0]) : null
}

interface PurchaseRow {
  id: string
  transaction_id: string
  merchant: string
  purchase_date: string
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  fees_cents: number
  total_cents: number
  created_at: string
  updated_at: string
  revision: number
  items_loaded: number
}

export interface LocalReceipt {
  purchase: PurchaseRecord
  itemsLoaded: boolean
}

export async function localReceipt(db: LocalDatabase, purchaseId: string): Promise<LocalReceipt | null> {
  const rows = await db.all<PurchaseRow>(
    'SELECT * FROM purchases WHERE id = ? AND deleted_at IS NULL', [purchaseId])
  const row = rows[0]
  if (!row) return null
  const items = await db.all<{
    id: string; purchase_id: string; position: number; name: string; quantity: number
    unit_price_cents: number | null; gross_price_cents: number; discount_cents: number; line_total_cents: number
  }>('SELECT * FROM receipt_items WHERE purchase_id = ? ORDER BY position', [purchaseId])
  return {
    itemsLoaded: row.items_loaded === 1,
    purchase: {
      id: row.id,
      transactionId: row.transaction_id,
      merchant: row.merchant,
      purchaseDate: row.purchase_date,
      currency: 'USD',
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      taxCents: row.tax_cents,
      feesCents: row.fees_cents,
      totalCents: row.total_cents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      items: items.map((item): ReceiptItem => ({
        id: item.id,
        purchaseId: item.purchase_id,
        position: item.position,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unit_price_cents,
        grossPriceCents: item.gross_price_cents,
        discountCents: item.discount_cents,
        lineTotalCents: item.line_total_cents
      }))
    }
  }
}

export async function localReference(db: LocalDatabase): Promise<ReferenceData> {
  const accounts = await db.all<{
    id: string; name: string; kind: ReferenceData['accounts'][number]['kind']; icon: string; color: string
    opening_balance_cents: number; opening_date: string; archived_at: string | null
    created_at: string; updated_at: string; revision: number
  }>('SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at')
  const categories = await db.all<{
    id: string; name: string; kind: 'income' | 'expense'; icon: string; color: string
    archived_at: string | null; created_at: string; updated_at: string; revision: number
  }>('SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE')
  const state = await db.all<{ server_sequence: number }>('SELECT server_sequence FROM sync_state WHERE id = 1')
  return {
    accounts: accounts.map((row) => ({
      id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
      openingBalanceCents: row.opening_balance_cents, openingDate: row.opening_date,
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
      revision: row.revision
    })),
    categories: categories.map((row) => ({
      id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
      revision: row.revision
    })),
    serverSequence: state[0]?.server_sequence ?? 0
  }
}

export async function localBalances(db: LocalDatabase): Promise<AccountBalance[]> {
  const rows = await db.all<{ account_id: string; balance_cents: number }>(BALANCES_SQL)
  return rows.map((row) => ({ accountId: row.account_id, balanceCents: row.balance_cents }))
}

export async function localSummary(
  db: LocalDatabase, from: string | null, to: string | null
): Promise<PeriodSummary> {
  const flows = summarySql(from, to)
  const budgets = budgetTotalsSql(from, to)
  const totals = await db.all<{ income_cents: number; expense_cents: number; transfer_cents: number }>(
    flows.sql, params(flows.params))
  const planned = await db.all<{ planned_income_cents: number; allocated_cents: number }>(
    budgets.sql, params(budgets.params))
  const income = totals[0]?.income_cents ?? 0
  const expense = totals[0]?.expense_cents ?? 0
  return {
    from,
    to,
    incomeCents: income,
    expenseCents: expense,
    netCents: income - expense,
    transferCents: totals[0]?.transfer_cents ?? 0,
    plannedIncomeCents: planned[0]?.planned_income_cents ?? 0,
    allocatedCents: planned[0]?.allocated_cents ?? 0
  }
}
