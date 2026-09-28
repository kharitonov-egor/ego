import { BALANCES_SQL } from '@ego/api-contracts'
import type {
  AccountKind, BudgetAllocation, CategoryKind, MoneyAccount, MoneyCategory, MoneyPurchase,
  MoneySnapshot, MoneyTransaction, MonthlyBudget, ReceiptItem, TransactionKind, BudgetBreach
} from '@ego/core'
import type { LocalDatabase } from '../database/types'

interface AccountRow {
  id: string
  name: string
  kind: AccountKind
  icon: string
  color: string
  opening_balance_cents: number
  opening_date: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface CategoryRow {
  id: string
  name: string
  kind: CategoryKind
  icon: string
  color: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

interface TransactionRow {
  id: string
  kind: TransactionKind
  account_id: string
  destination_account_id: string | null
  category_id: string | null
  amount_cents: number
  date: string
  notes: string
  created_at: string
  updated_at: string
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
}

interface ReceiptItemRow {
  id: string
  purchase_id: string
  position: number
  name: string
  quantity: number
  unit_price_cents: number | null
  gross_price_cents: number
  discount_cents: number
  line_total_cents: number
}

interface BudgetRow {
  id: string
  month: string
  planned_income_cents: number
  created_at: string
  updated_at: string
}

interface AllocationRow {
  id: string
  budget_id: string
  category_id: string
  amount_cents: number
}

function toTransaction(row: TransactionRow): MoneyTransaction {
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
    updatedAt: row.updated_at
  }
}

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

/**
 * The whole ledger as the screens expect it, read from this device. Balances come from the same
 * SQL the server uses, so they agree with Activity and include undelivered local changes.
 */
export async function localSnapshot(
  db: LocalDatabase, syncedAt: string, options: {
    accounts?: boolean
    budgets?: boolean
    purchases?: boolean
    receiptItems?: boolean
    budgetMonth?: string
    transactionFrom?: string | null
    transactionLimit?: number
    transactionTo?: string | null
    transactions?: boolean
  } = {}
): Promise<MoneySnapshot> {
  const accounts = options.accounts === false ? [] : await db.all<AccountRow>(
    'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at')
  const categories = await db.all<CategoryRow>(
    'SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY kind, name COLLATE NOCASE')
  const transactionLimit = options.transactionLimit
  const transactionClauses = ['deleted_at IS NULL']
  const transactionParams: Array<string | number> = []
  if (options.transactionFrom) {
    transactionClauses.push('date >= ?')
    transactionParams.push(options.transactionFrom)
  }
  if (options.transactionTo) {
    transactionClauses.push('date <= ?')
    transactionParams.push(options.transactionTo)
  }
  if (transactionLimit) transactionParams.push(transactionLimit)
  const transactions = options.transactions === false ? [] : await db.all<TransactionRow>(
    `SELECT * FROM transactions WHERE ${transactionClauses.join(' AND ')}
      ORDER BY date DESC, created_at DESC, id DESC${transactionLimit ? ' LIMIT ?' : ''}`,
    transactionParams)
  const purchases = options.purchases === false ? [] : await db.all<PurchaseRow>(
    'SELECT * FROM purchases WHERE deleted_at IS NULL AND items_loaded = 1 ORDER BY purchase_date DESC, created_at DESC')
  const items = options.purchases === false || options.receiptItems === false ? [] : await db.all<ReceiptItemRow>(
    `SELECT i.* FROM receipt_items i JOIN purchases p ON p.id = i.purchase_id
      WHERE p.deleted_at IS NULL ORDER BY i.purchase_id, i.position`)
  const budgets = options.budgets === false ? [] : await db.all<BudgetRow>(
    `SELECT * FROM budgets WHERE deleted_at IS NULL${options.budgetMonth ? ' AND month = ?' : ''} ORDER BY month DESC`,
    options.budgetMonth ? [options.budgetMonth] : [])
  const allocations = options.budgets === false ? [] : await db.all<AllocationRow>(
    options.budgetMonth
      ? 'SELECT al.* FROM budget_allocations al JOIN budgets b ON b.id = al.budget_id WHERE b.month = ?'
      : 'SELECT * FROM budget_allocations',
    options.budgetMonth ? [options.budgetMonth] : [])
  const balances = options.accounts === false ? [] : await db.all<{ account_id: string; balance_cents: number }>(BALANCES_SQL)

  const balanceById = new Map(balances.map((row) => [row.account_id, row.balance_cents]))
  const itemsByPurchase = groupBy(items, (item) => item.purchase_id)
  const allocationsByBudget = groupBy(allocations, (allocation) => allocation.budget_id)

  return {
    accounts: accounts.map((row): MoneyAccount => ({
      id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
      openingBalanceCents: row.opening_balance_cents, openingDate: row.opening_date,
      balanceCents: balanceById.get(row.id) ?? row.opening_balance_cents,
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at
    })),
    categories: categories.map((row): MoneyCategory => ({
      id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at
    })),
    transactions: transactions.map(toTransaction),
    purchases: purchases.map((row): MoneyPurchase => ({
      id: row.id, transactionId: row.transaction_id, merchant: row.merchant,
      purchaseDate: row.purchase_date, currency: 'USD',
      subtotalCents: row.subtotal_cents, discountCents: row.discount_cents,
      taxCents: row.tax_cents, feesCents: row.fees_cents, totalCents: row.total_cents,
      createdAt: row.created_at, updatedAt: row.updated_at,
      items: (itemsByPurchase.get(row.id) ?? []).map((item): ReceiptItem => ({
        id: item.id, purchaseId: item.purchase_id, position: item.position, name: item.name,
        quantity: item.quantity, unitPriceCents: item.unit_price_cents,
        grossPriceCents: item.gross_price_cents, discountCents: item.discount_cents,
        lineTotalCents: item.line_total_cents
      }))
    })),
    budgets: budgets.map((row): MonthlyBudget => ({
      id: row.id, month: row.month, plannedIncomeCents: row.planned_income_cents,
      createdAt: row.created_at, updatedAt: row.updated_at,
      allocations: (allocationsByBudget.get(row.id) ?? []).map((allocation): BudgetAllocation => ({
        id: allocation.id, budgetId: allocation.budget_id,
        categoryId: allocation.category_id, amountCents: allocation.amount_cents
      }))
    })),
    syncedAt
  }
}

export async function localTransactionsInRange(
  db: LocalDatabase, from: string | null, to: string | null
): Promise<MoneyTransaction[]> {
  const clauses = ['deleted_at IS NULL']
  const params: string[] = []
  if (from) {
    clauses.push('date >= ?')
    params.push(from)
  }
  if (to) {
    clauses.push('date <= ?')
    params.push(to)
  }
  const rows = await db.all<TransactionRow>(`SELECT * FROM transactions
    WHERE ${clauses.join(' AND ')} ORDER BY date DESC, created_at DESC, id DESC`, params)
  return rows.map(toTransaction)
}

export async function localTransactionBounds(
  db: LocalDatabase
): Promise<{ earliest: string | null; latest: string | null }> {
  const rows = await db.all<{ earliest: string | null; latest: string | null }>(
    'SELECT MIN(date) AS earliest, MAX(date) AS latest FROM transactions WHERE deleted_at IS NULL')
  return rows[0] ?? { earliest: null, latest: null }
}

export async function localBalanceAt(db: LocalDatabase, day: string): Promise<number> {
  const rows = await db.all<{ total_cents: number }>(`SELECT COALESCE(SUM(
      a.opening_balance_cents
      + COALESCE((SELECT SUM(CASE t.kind WHEN 'income' THEN t.amount_cents ELSE -t.amount_cents END)
          FROM transactions t
          WHERE t.deleted_at IS NULL AND t.account_id = a.id AND t.date <= ?), 0)
      + COALESCE((SELECT SUM(t.amount_cents) FROM transactions t
          WHERE t.deleted_at IS NULL AND t.kind = 'transfer'
            AND t.destination_account_id = a.id AND t.date <= ?), 0)
    ), 0) AS total_cents
    FROM accounts a WHERE a.deleted_at IS NULL AND a.archived_at IS NULL`, [day, day])
  return rows[0]?.total_cents ?? 0
}

/** Current allocated categories whose monthly spending is over their limit. */
export async function localBudgetBreaches(db: LocalDatabase): Promise<BudgetBreach[]> {
  const rows = await db.all<{
    month: string
    category_id: string
    name: string
    icon: string
    color: string
    allocated_cents: number
    spent_cents: number
  }>(`SELECT b.month, c.id AS category_id, c.name, c.icon, c.color,
      al.amount_cents AS allocated_cents, COALESCE(SUM(t.amount_cents), 0) AS spent_cents
    FROM budgets b
    JOIN budget_allocations al ON al.budget_id = b.id
    JOIN categories c ON c.id = al.category_id
    LEFT JOIN transactions t ON t.category_id = c.id
      AND t.kind = 'expense' AND t.deleted_at IS NULL AND substr(t.date, 1, 7) = b.month
    WHERE b.deleted_at IS NULL
    GROUP BY b.month, c.id, c.name, c.icon, c.color, al.amount_cents
    HAVING COALESCE(SUM(t.amount_cents), 0) > al.amount_cents`)
  return rows.map((row) => ({
    month: row.month,
    category: {
      categoryId: row.category_id,
      name: row.name,
      icon: row.icon,
      color: row.color,
      allocatedCents: row.allocated_cents,
      spentCents: row.spent_cents,
      remainingCents: row.allocated_cents - row.spent_cents,
      usedRatio: row.spent_cents / row.allocated_cents,
      state: 'over'
    }
  }))
}

export type RevisionTable = 'accounts' | 'categories' | 'transactions' | 'purchases' | 'budgets'

/** The revision a write must name. Budgets are keyed by month, everything else by ID. */
export async function localRevision(db: LocalDatabase, table: RevisionTable, key: string): Promise<number | null> {
  const column = table === 'budgets' ? 'month' : 'id'
  const rows = await db.all<{ revision: number }>(
    `SELECT revision FROM ${table} WHERE ${column} = ? AND deleted_at IS NULL`, [key])
  return rows[0]?.revision ?? null
}
