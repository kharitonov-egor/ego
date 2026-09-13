import type { FeedCursor } from './cursor'
import { LIKE_ESCAPE, searchPattern, type TransactionFilters } from './filters'

export interface SqlQuery {
  sql: string
  params: unknown[]
}

export const FEED_FROM = `FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN accounts d ON d.id = t.destination_account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN purchases p ON p.transaction_id = t.id AND p.deleted_at IS NULL`

export const FEED_COLUMNS = `t.id, t.kind, t.account_id, t.destination_account_id, t.category_id,
  t.amount_cents, t.date, t.notes, t.created_at, t.updated_at, t.revision,
  a.name AS account_name, d.name AS destination_account_name,
  c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
  p.merchant AS merchant, p.id AS purchase_id`

const SEARCH_COLUMNS = ['t.notes', 'c.name', 'a.name', 'd.name', 'p.merchant']

interface Conditions {
  clauses: string[]
  params: unknown[]
}

export function feedConditions(filters: TransactionFilters): Conditions {
  const clauses = ['t.deleted_at IS NULL']
  const params: unknown[] = []
  if (filters.from) {
    clauses.push('t.date >= ?')
    params.push(filters.from)
  }
  if (filters.to) {
    clauses.push('t.date <= ?')
    params.push(filters.to)
  }
  if (filters.kinds.length > 0) {
    clauses.push(`t.kind IN (${filters.kinds.map(() => '?').join(', ')})`)
    params.push(...filters.kinds)
  }
  if (filters.accountIds.length > 0) {
    const placeholders = filters.accountIds.map(() => '?').join(', ')
    clauses.push(`(t.account_id IN (${placeholders}) OR t.destination_account_id IN (${placeholders}))`)
    params.push(...filters.accountIds, ...filters.accountIds)
  }
  if (filters.categoryIds.length > 0) {
    clauses.push(`t.category_id IN (${filters.categoryIds.map(() => '?').join(', ')})`)
    params.push(...filters.categoryIds)
  }
  if (filters.search.length > 0) {
    const pattern = searchPattern(filters.search)
    const matches = SEARCH_COLUMNS.map((column) => `${column} LIKE ? ESCAPE '${LIKE_ESCAPE}'`)
    clauses.push(`(${matches.join(' OR ')})`)
    params.push(...SEARCH_COLUMNS.map(() => pattern))
  }
  return { clauses, params }
}

/** Descending keyset. The cursor is the last row of the preceding page. */
export function cursorCondition(cursor: FeedCursor | null): Conditions {
  if (!cursor) return { clauses: [], params: [] }
  return {
    clauses: [`(t.date < ?
      OR (t.date = ? AND t.created_at < ?)
      OR (t.date = ? AND t.created_at = ? AND t.id < ?))`],
    params: [cursor.date, cursor.date, cursor.createdAt, cursor.date, cursor.createdAt, cursor.id]
  }
}

function combine(...parts: Conditions[]): Conditions {
  return {
    clauses: parts.flatMap((part) => part.clauses),
    params: parts.flatMap((part) => part.params)
  }
}

export function feedPageSql(filters: TransactionFilters, cursor: FeedCursor | null, limit: number): SqlQuery {
  const where = combine(feedConditions(filters), cursorCondition(cursor))
  return {
    sql: `SELECT ${FEED_COLUMNS} ${FEED_FROM}
      WHERE ${where.clauses.join(' AND ')}
      ORDER BY t.date DESC, t.created_at DESC, t.id DESC
      LIMIT ?`,
    params: [...where.params, limit]
  }
}

export function feedCountSql(filters: TransactionFilters): SqlQuery {
  const where = feedConditions(filters)
  return {
    sql: `SELECT COUNT(*) AS total ${FEED_FROM} WHERE ${where.clauses.join(' AND ')}`,
    params: where.params
  }
}

/**
 * A complete balance over the whole ledger. Both the server and the phone run this, so a
 * loaded page can never change what either one reports.
 */
export const BALANCES_SQL = `SELECT a.id AS account_id,
    a.opening_balance_cents
    + COALESCE((
        SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount_cents ELSE -t.amount_cents END)
        FROM transactions t
        WHERE t.deleted_at IS NULL AND t.account_id = a.id
      ), 0)
    + COALESCE((
        SELECT SUM(t.amount_cents)
        FROM transactions t
        WHERE t.deleted_at IS NULL AND t.kind = 'transfer' AND t.destination_account_id = a.id
      ), 0) AS balance_cents
  FROM accounts a
  WHERE a.deleted_at IS NULL`

function rangeClause(from: string | null, to: string | null, column: string, length: number): SqlQuery {
  const clauses: string[] = []
  const params: unknown[] = []
  if (from) {
    clauses.push(`${column} >= ?`)
    params.push(from.slice(0, length))
  }
  if (to) {
    clauses.push(`${column} <= ?`)
    params.push(to.slice(0, length))
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params }
}

/** Transfers move money between accounts, so they contribute zero to cash flow. */
export function summarySql(from: string | null, to: string | null): SqlQuery {
  const range = rangeClause(from, to, 'date', 10)
  return {
    sql: `SELECT
      COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_cents ELSE 0 END), 0) AS income_cents,
      COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents,
      COALESCE(SUM(CASE WHEN kind = 'transfer' THEN amount_cents ELSE 0 END), 0) AS transfer_cents
    FROM transactions WHERE deleted_at IS NULL${range.sql}`,
    params: range.params
  }
}

export function budgetTotalsSql(from: string | null, to: string | null): SqlQuery {
  const range = rangeClause(from, to, 'b.month', 7)
  return {
    sql: `SELECT COALESCE(SUM(b.planned_income_cents), 0) AS planned_income_cents,
      COALESCE(SUM((
        SELECT COALESCE(SUM(al.amount_cents), 0) FROM budget_allocations al WHERE al.budget_id = b.id
      )), 0) AS allocated_cents
    FROM budgets b WHERE b.deleted_at IS NULL${range.sql}`,
    params: range.params
  }
}
