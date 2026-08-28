export type AccountKind =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit-card'
  | 'investment'
  | 'crypto'
  | 'other'

export type CategoryKind = 'income' | 'expense'
export type TransactionKind = CategoryKind | 'transfer'

export interface MoneyAccount {
  id: string
  name: string
  kind: AccountKind
  icon: string
  color: string
  openingBalanceCents: number
  openingDate: string
  balanceCents: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MoneyCategory {
  id: string
  name: string
  kind: CategoryKind
  icon: string
  color: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MoneyTransaction {
  id: string
  kind: TransactionKind
  accountId: string
  destinationAccountId: string | null
  categoryId: string | null
  amountCents: number
  date: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface ReceiptItem {
  id: string
  purchaseId: string
  position: number
  name: string
  quantity: number
  unitPriceCents: number | null
  grossPriceCents: number
  discountCents: number
  lineTotalCents: number
}

export interface MoneyPurchase {
  id: string
  transactionId: string
  merchant: string
  purchaseDate: string
  currency: 'USD'
  subtotalCents: number
  discountCents: number
  taxCents: number
  feesCents: number
  totalCents: number
  items: ReceiptItem[]
  createdAt: string
  updatedAt: string
}

export interface ReceiptItemInput {
  name: string
  quantity: number
  unitPriceCents: number | null
  grossPriceCents: number
  discountCents: number
  lineTotalCents: number
}

export interface ReceiptDraft {
  merchant: string
  purchaseDate: string
  currency: string
  subtotalCents: number
  discountCents: number
  taxCents: number
  feesCents: number
  totalCents: number
  items: ReceiptItemInput[]
}

export interface AnalyzedTransactionDraft {
  kind: CategoryKind
  counterparty: string
  date: string | null
  currency: string
  amountCents: number
  notes: string
  categoryId: string | null
  receipt: ReceiptDraft | null
}

export interface ImageAnalysisCategory {
  id: string
  name: string
  kind: CategoryKind
}

export interface PurchaseInput extends ReceiptDraft {
  accountId: string
  categoryId: string
}

export interface BudgetAllocation {
  id: string
  budgetId: string
  categoryId: string
  amountCents: number
}

export interface MonthlyBudget {
  id: string
  month: string
  plannedIncomeCents: number
  allocations: BudgetAllocation[]
  createdAt: string
  updatedAt: string
}

export interface BudgetAllocationInput {
  categoryId: string
  amountCents: number
}

export interface BudgetInput {
  month: string
  plannedIncomeCents: number
  allocations: BudgetAllocationInput[]
}

export type BudgetState = 'unplanned' | 'under' | 'close' | 'over'

export interface CategoryBudgetStatus {
  categoryId: string
  name: string
  icon: string
  color: string
  allocatedCents: number
  spentCents: number
  remainingCents: number
  usedRatio: number
  state: BudgetState
}

export interface BudgetSummary {
  month: string
  plannedIncomeCents: number
  actualIncomeCents: number
  allocatedCents: number
  spentCents: number
  unallocatedCents: number
  unplannedSpentCents: number
  categories: CategoryBudgetStatus[]
  overspent: CategoryBudgetStatus[]
}

export interface BudgetBreach {
  month: string
  category: CategoryBudgetStatus
}

export interface MoneySnapshot {
  accounts: MoneyAccount[]
  categories: MoneyCategory[]
  transactions: MoneyTransaction[]
  purchases: MoneyPurchase[]
  budgets: MonthlyBudget[]
  syncedAt: string
}

export interface AccountInput {
  name: string
  kind: AccountKind
  icon: string
  color: string
  openingBalanceCents: number
  openingDate: string
}

export interface CategoryInput {
  name: string
  kind: CategoryKind
  icon: string
  color: string
}

export interface TransactionInput {
  kind: TransactionKind
  accountId: string
  destinationAccountId: string | null
  categoryId: string | null
  amountCents: number
  date: string
  notes: string
}

export interface ArchiveInput {
  archived: boolean
}

export type MoneyErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OFFLINE'
  | 'NOT_CONFIGURED'
  | 'SERVER_ERROR'

export type MoneyResult<T> =
  | { ok: true; data: T; cached?: boolean }
  | { ok: false; code: MoneyErrorCode; message: string; cachedData?: MoneySnapshot }

export interface MoneySyncStatus {
  configured: boolean
  accountId: string
  databaseId: string
  hasApiToken: boolean
}

export interface MoneySyncConfigInput {
  accountId: string
  databaseId: string
  apiToken?: string
}

export type PeriodPreset = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom'

export interface DateRange {
  from: string | null
  to: string | null
}

export const MONEY_SCHEMA_QUERIES = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    kind TEXT NOT NULL CHECK(kind IN ('checking', 'savings', 'cash', 'credit-card', 'investment', 'crypto', 'other')),
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    opening_balance_cents INTEGER NOT NULL,
    opening_date TEXT NOT NULL CHECK(opening_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
    kind TEXT NOT NULL CHECK(kind IN ('income', 'expense')),
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('income', 'expense', 'transfer')),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    destination_account_id TEXT REFERENCES accounts(id),
    category_id TEXT REFERENCES categories(id),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 500),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(
      (kind = 'transfer' AND destination_account_id IS NOT NULL AND destination_account_id <> account_id AND category_id IS NULL)
      OR
      (kind IN ('income', 'expense') AND destination_account_id IS NULL AND category_id IS NOT NULL)
    )
  )`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
    merchant TEXT NOT NULL CHECK(length(trim(merchant)) BETWEEN 1 AND 120),
    purchase_date TEXT NOT NULL CHECK(purchase_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    currency TEXT NOT NULL CHECK(currency = 'USD'),
    subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
    discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
    tax_cents INTEGER NOT NULL CHECK(tax_cents >= 0),
    fees_cents INTEGER NOT NULL CHECK(fees_cents >= 0),
    total_cents INTEGER NOT NULL CHECK(total_cents > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS receipt_items (
    id TEXT PRIMARY KEY,
    purchase_id TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK(position >= 0),
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),
    quantity REAL NOT NULL CHECK(quantity > 0),
    unit_price_cents INTEGER CHECK(unit_price_cents IS NULL OR unit_price_cents >= 0),
    gross_price_cents INTEGER NOT NULL CHECK(gross_price_cents >= 0),
    discount_cents INTEGER NOT NULL CHECK(discount_cents >= 0),
    line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0),
    UNIQUE(purchase_id, position)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_destination ON transactions(destination_account_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)',
  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    month TEXT NOT NULL UNIQUE CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
    planned_income_cents INTEGER NOT NULL CHECK(planned_income_cents >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS budget_allocations (
    id TEXT PRIMARY KEY,
    budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    UNIQUE(budget_id, category_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_receipt_items_purchase ON receipt_items(purchase_id, position)',
  'CREATE INDEX IF NOT EXISTS idx_budget_allocations_budget ON budget_allocations(budget_id)'
] as const

export function calculateAccountBalance(
  account: Pick<MoneyAccount, 'id' | 'openingBalanceCents'>,
  transactions: MoneyTransaction[]
): number {
  return transactions.reduce((balance, transaction) => {
    if (transaction.kind === 'income' && transaction.accountId === account.id) {
      return balance + transaction.amountCents
    }
    if (transaction.kind === 'expense' && transaction.accountId === account.id) {
      return balance - transaction.amountCents
    }
    if (transaction.kind === 'transfer') {
      if (transaction.accountId === account.id) return balance - transaction.amountCents
      if (transaction.destinationAccountId === account.id) return balance + transaction.amountCents
    }
    return balance
  }, account.openingBalanceCents)
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const ACCOUNT_KINDS: AccountKind[] = [
  'checking', 'savings', 'cash', 'credit-card', 'investment', 'crypto', 'other'
]
const CATEGORY_KINDS: CategoryKind[] = ['income', 'expense']
const TRANSACTION_KINDS: TransactionKind[] = ['income', 'expense', 'transfer']

export function isAccountInput(value: unknown): value is AccountInput {
  if (!isRecord(value)) return false
  return typeof value.name === 'string' && value.name.trim().length > 0 && value.name.trim().length <= 80 &&
    typeof value.kind === 'string' && ACCOUNT_KINDS.includes(value.kind as AccountKind) &&
    typeof value.icon === 'string' && value.icon.length > 0 && value.icon.length <= 40 &&
    typeof value.color === 'string' && value.color.length > 0 && value.color.length <= 20 &&
    Number.isSafeInteger(value.openingBalanceCents) &&
    typeof value.openingDate === 'string' && isDateString(value.openingDate)
}

export function isCategoryInput(value: unknown): value is CategoryInput {
  if (!isRecord(value)) return false
  return typeof value.name === 'string' && value.name.trim().length > 0 && value.name.trim().length <= 80 &&
    typeof value.kind === 'string' && CATEGORY_KINDS.includes(value.kind as CategoryKind) &&
    typeof value.icon === 'string' && value.icon.length > 0 && value.icon.length <= 40 &&
    typeof value.color === 'string' && value.color.length > 0 && value.color.length <= 20
}

export function isTransactionInput(value: unknown): value is TransactionInput {
  if (!isRecord(value) || typeof value.kind !== 'string' ||
    !TRANSACTION_KINDS.includes(value.kind as TransactionKind) ||
    typeof value.accountId !== 'string' || value.accountId.length === 0 ||
    !Number.isSafeInteger(value.amountCents) || Number(value.amountCents) <= 0 ||
    typeof value.date !== 'string' || !isDateString(value.date) ||
    typeof value.notes !== 'string' || value.notes.length > 500) return false
  if (value.kind === 'transfer') {
    return typeof value.destinationAccountId === 'string' && value.destinationAccountId.length > 0 &&
      value.destinationAccountId !== value.accountId && value.categoryId === null
  }
  return value.destinationAccountId === null && typeof value.categoryId === 'string' && value.categoryId.length > 0
}

function isNonNegativeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isReceiptItemInput(value: unknown): value is ReceiptItemInput {
  return isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0 &&
    value.name.trim().length <= 160 && typeof value.quantity === 'number' &&
    Number.isFinite(value.quantity) && value.quantity > 0 && value.quantity <= 100000 &&
    (value.unitPriceCents === null || isNonNegativeCents(value.unitPriceCents)) &&
    isNonNegativeCents(value.grossPriceCents) && isNonNegativeCents(value.discountCents) &&
    isNonNegativeCents(value.lineTotalCents)
}

export function isReceiptDraft(value: unknown): value is ReceiptDraft {
  return isRecord(value) && typeof value.merchant === 'string' &&
    value.merchant.trim().length > 0 && value.merchant.trim().length <= 120 &&
    typeof value.purchaseDate === 'string' && isDateString(value.purchaseDate) &&
    value.currency === 'USD' && isNonNegativeCents(value.subtotalCents) &&
    isNonNegativeCents(value.discountCents) && isNonNegativeCents(value.taxCents) &&
    isNonNegativeCents(value.feesCents) && Number.isSafeInteger(value.totalCents) &&
    Number(value.totalCents) > 0 && Array.isArray(value.items) && value.items.length > 0 &&
    value.items.length <= 500 && value.items.every(isReceiptItemInput)
}

export function isPurchaseInput(value: unknown): value is PurchaseInput {
  return isReceiptDraft(value) && 'accountId' in value && typeof value.accountId === 'string' &&
    value.accountId.length > 0 && 'categoryId' in value && typeof value.categoryId === 'string' &&
    value.categoryId.length > 0
}

export function isMonthString(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) return false
  const month = Number(value.slice(5))
  return month >= 1 && month <= 12
}

export function isBudgetInput(value: unknown): value is BudgetInput {
  if (!isRecord(value) || typeof value.month !== 'string' || !isMonthString(value.month)) return false
  if (!isNonNegativeCents(value.plannedIncomeCents)) return false
  if (!Array.isArray(value.allocations) || value.allocations.length > 200) return false
  const categoryIds = new Set<string>()
  return value.allocations.every((item) => {
    if (!isRecord(item) || typeof item.categoryId !== 'string' || item.categoryId.length === 0) return false
    if (!Number.isSafeInteger(item.amountCents) || Number(item.amountCents) <= 0) return false
    if (categoryIds.has(item.categoryId)) return false
    categoryIds.add(item.categoryId)
    return true
  })
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

const CLOSE_TO_LIMIT = 0.8

export function summarizeBudget(snapshot: MoneySnapshot, month: string): BudgetSummary {
  const budget = snapshot.budgets.find((item) => item.month === month)
  const inMonth = snapshot.transactions.filter((item) => monthOf(item.date) === month)
  const allocationFor = (categoryId: string): number =>
    budget?.allocations.find((item) => item.categoryId === categoryId)?.amountCents ?? 0
  const spentFor = (categoryId: string): number => inMonth.reduce((sum, item) =>
    item.kind === 'expense' && item.categoryId === categoryId ? sum + item.amountCents : sum, 0)
  const categories = snapshot.categories
    .filter((category) => category.kind === 'expense')
    .map((category): CategoryBudgetStatus => {
      const allocatedCents = allocationFor(category.id)
      const spentCents = spentFor(category.id)
      const usedRatio = allocatedCents > 0 ? spentCents / allocatedCents : spentCents > 0 ? 1 : 0
      const state: BudgetState = allocatedCents === 0
        ? 'unplanned'
        : spentCents > allocatedCents
          ? 'over'
          : usedRatio >= CLOSE_TO_LIMIT ? 'close' : 'under'
      return {
        categoryId: category.id, name: category.name, icon: category.icon, color: category.color,
        allocatedCents, spentCents, remainingCents: allocatedCents - spentCents, usedRatio, state
      }
    })
    .filter((status) => !snapshot.categories.find((category) => category.id === status.categoryId)?.archivedAt ||
      status.allocatedCents > 0 || status.spentCents > 0)
  const allocatedCents = categories.reduce((sum, item) => sum + item.allocatedCents, 0)
  const spentCents = categories.reduce((sum, item) => sum + item.spentCents, 0)
  const plannedIncomeCents = budget?.plannedIncomeCents ?? 0
  return {
    month,
    plannedIncomeCents,
    actualIncomeCents: inMonth.reduce((sum, item) => item.kind === 'income' ? sum + item.amountCents : sum, 0),
    allocatedCents,
    spentCents,
    unallocatedCents: plannedIncomeCents - allocatedCents,
    unplannedSpentCents: categories.reduce((sum, item) => item.allocatedCents === 0 ? sum + item.spentCents : sum, 0),
    categories,
    overspent: categories.filter((item) => item.state === 'over')
  }
}

export function budgetBreaches(before: MoneySnapshot | null, after: MoneySnapshot): BudgetBreach[] {
  return after.budgets.flatMap((budget) => {
    const wasOver = before ? summarizeBudget(before, budget.month).overspent : []
    return summarizeBudget(after, budget.month).overspent
      .filter((status) => !wasOver.some((item) => item.categoryId === status.categoryId))
      .map((status) => ({ month: budget.month, category: status }))
  })
}

export function budgetBreachMessage(breach: BudgetBreach, style: 'long' | 'short' = 'long'): string {
  const amount = (cents: number): string =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
  const over = breach.category.spentCents - breach.category.allocatedCents
  if (style === 'short') return `${breach.category.name} is ${amount(over)} over budget`
  const month = new Date(`${breach.month}-01T00:00:00Z`)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return `${breach.category.name} is ${amount(over)} over its ${amount(breach.category.allocatedCents)} budget for ${month}`
}

export function receiptReconciliationWarnings(value: ReceiptDraft): string[] {
  const warnings: string[] = []
  const calculatedTotal = value.subtotalCents - value.discountCents + value.taxCents + value.feesCents
  if (calculatedTotal !== value.totalCents) warnings.push('Receipt totals do not add up')
  const itemTotal = value.items.reduce((sum, item) => sum + item.lineTotalCents, 0)
  if (itemTotal !== value.subtotalCents) warnings.push('Item prices do not match the subtotal')
  return warnings
}

export interface D1Statement {
  sql: string
  params?: unknown[]
}

export interface PurchaseMutationIds {
  purchaseId: string
  transactionId: string
  itemIds: string[]
}

function receiptItemStatements(purchaseId: string, input: PurchaseInput, itemIds: string[]): D1Statement[] {
  if (itemIds.length !== input.items.length) throw new Error('Every receipt item needs an ID')
  return input.items.map((item, position) => ({
    sql: 'INSERT INTO receipt_items (id, purchase_id, position, name, quantity, unit_price_cents, gross_price_cents, discount_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params: [itemIds[position], purchaseId, position, item.name.trim(), item.quantity,
      item.unitPriceCents, item.grossPriceCents, item.discountCents, item.lineTotalCents]
  }))
}

export function createPurchaseStatements(input: PurchaseInput, ids: PurchaseMutationIds, now: string): D1Statement[] {
  return [
    {
      sql: "INSERT INTO transactions (id, kind, account_id, destination_account_id, category_id, amount_cents, date, notes, created_at, updated_at) VALUES (?, 'expense', ?, NULL, ?, ?, ?, ?, ?, ?)",
      params: [ids.transactionId, input.accountId, input.categoryId, input.totalCents,
        input.purchaseDate, input.merchant.trim(), now, now]
    },
    {
      sql: "INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency, subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?)",
      params: [ids.purchaseId, ids.transactionId, input.merchant.trim(), input.purchaseDate,
        input.subtotalCents, input.discountCents, input.taxCents, input.feesCents,
        input.totalCents, now, now]
    },
    ...receiptItemStatements(ids.purchaseId, input, ids.itemIds)
  ]
}

export function updatePurchaseStatements(
  purchaseId: string,
  transactionId: string,
  input: PurchaseInput,
  itemIds: string[],
  now: string
): D1Statement[] {
  return [
    {
      sql: 'UPDATE transactions SET account_id = ?, category_id = ?, amount_cents = ?, date = ?, notes = ?, updated_at = ? WHERE id = ?',
      params: [input.accountId, input.categoryId, input.totalCents, input.purchaseDate,
        input.merchant.trim(), now, transactionId]
    },
    {
      sql: 'UPDATE purchases SET merchant = ?, purchase_date = ?, subtotal_cents = ?, discount_cents = ?, tax_cents = ?, fees_cents = ?, total_cents = ?, updated_at = ? WHERE id = ?',
      params: [input.merchant.trim(), input.purchaseDate, input.subtotalCents, input.discountCents,
        input.taxCents, input.feesCents, input.totalCents, now, purchaseId]
    },
    { sql: 'DELETE FROM receipt_items WHERE purchase_id = ?', params: [purchaseId] },
    ...receiptItemStatements(purchaseId, input, itemIds)
  ]
}

export interface BudgetMutationIds {
  budgetId: string
  allocationIds: string[]
}

export function saveBudgetStatements(input: BudgetInput, ids: BudgetMutationIds, now: string): D1Statement[] {
  if (ids.allocationIds.length !== input.allocations.length) throw new Error('Every allocation needs an ID')
  return [
    {
      sql: 'INSERT INTO budgets (id, month, planned_income_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(month) DO UPDATE SET planned_income_cents = excluded.planned_income_cents, updated_at = excluded.updated_at',
      params: [ids.budgetId, input.month, input.plannedIncomeCents, now, now]
    },
    {
      sql: 'DELETE FROM budget_allocations WHERE budget_id = (SELECT id FROM budgets WHERE month = ?)',
      params: [input.month]
    },
    ...input.allocations.map((allocation, index) => ({
      sql: 'INSERT INTO budget_allocations (id, budget_id, category_id, amount_cents) VALUES (?, (SELECT id FROM budgets WHERE month = ?), ?, ?)',
      params: [ids.allocationIds[index], input.month, allocation.categoryId, allocation.amountCents]
    }))
  ]
}

export function deleteBudgetStatements(month: string): D1Statement[] {
  return [{ sql: 'DELETE FROM budgets WHERE month = ?', params: [month] }]
}

export function deletePurchaseStatements(transactionId: string): D1Statement[] {
  return [{ sql: 'DELETE FROM transactions WHERE id = ?', params: [transactionId] }]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseCachedSnapshot(raw: string | null): MoneySnapshot | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!isRecord(parsed)) return null
  const value = {
    ...parsed,
    purchases: 'purchases' in parsed ? parsed.purchases : [],
    budgets: 'budgets' in parsed ? parsed.budgets : []
  }
  return isMoneySnapshot(value) ? value : null
}

export function isMoneySnapshot(value: unknown): value is MoneySnapshot {
  if (!isRecord(value) || !Array.isArray(value.accounts) || !Array.isArray(value.categories) ||
    !Array.isArray(value.transactions) || !Array.isArray(value.purchases) ||
    !Array.isArray(value.budgets) || typeof value.syncedAt !== 'string') return false
  const validAccount = (account: unknown): boolean => isRecord(account) &&
    typeof account.id === 'string' && typeof account.name === 'string' &&
    typeof account.kind === 'string' && typeof account.icon === 'string' &&
    typeof account.color === 'string' && Number.isSafeInteger(account.openingBalanceCents) &&
    typeof account.openingDate === 'string' && Number.isSafeInteger(account.balanceCents) &&
    (account.archivedAt === null || typeof account.archivedAt === 'string') &&
    typeof account.createdAt === 'string' && typeof account.updatedAt === 'string'
  const validCategory = (category: unknown): boolean => isRecord(category) &&
    typeof category.id === 'string' && typeof category.name === 'string' &&
    (category.kind === 'income' || category.kind === 'expense') &&
    typeof category.icon === 'string' && typeof category.color === 'string' &&
    (category.archivedAt === null || typeof category.archivedAt === 'string') &&
    typeof category.createdAt === 'string' && typeof category.updatedAt === 'string'
  const validTransaction = (transaction: unknown): boolean => isRecord(transaction) &&
    typeof transaction.id === 'string' &&
    (transaction.kind === 'income' || transaction.kind === 'expense' || transaction.kind === 'transfer') &&
    typeof transaction.accountId === 'string' &&
    (transaction.destinationAccountId === null || typeof transaction.destinationAccountId === 'string') &&
    (transaction.categoryId === null || typeof transaction.categoryId === 'string') &&
    Number.isSafeInteger(transaction.amountCents) && typeof transaction.date === 'string' &&
    typeof transaction.notes === 'string' && typeof transaction.createdAt === 'string' &&
    typeof transaction.updatedAt === 'string'
  const validItem = (item: unknown): boolean => isRecord(item) && typeof item.id === 'string' &&
    typeof item.purchaseId === 'string' && Number.isSafeInteger(item.position) && Number(item.position) >= 0 &&
    isReceiptItemInput(item)
  const validPurchase = (purchase: unknown): boolean => isRecord(purchase) &&
    typeof purchase.id === 'string' && typeof purchase.transactionId === 'string' &&
    isReceiptDraft(purchase) && Array.isArray(purchase.items) && purchase.items.every(validItem) &&
    typeof purchase.createdAt === 'string' && typeof purchase.updatedAt === 'string'
  const validAllocation = (allocation: unknown): boolean => isRecord(allocation) &&
    typeof allocation.id === 'string' && typeof allocation.budgetId === 'string' &&
    typeof allocation.categoryId === 'string' && Number.isSafeInteger(allocation.amountCents) &&
    Number(allocation.amountCents) > 0
  const validBudget = (budget: unknown): boolean => isRecord(budget) && typeof budget.id === 'string' &&
    typeof budget.month === 'string' && isMonthString(budget.month) &&
    isNonNegativeCents(budget.plannedIncomeCents) && Array.isArray(budget.allocations) &&
    budget.allocations.every(validAllocation) && typeof budget.createdAt === 'string' &&
    typeof budget.updatedAt === 'string'
  return value.accounts.every(validAccount) && value.categories.every(validCategory) &&
    value.transactions.every(validTransaction) && value.purchases.every(validPurchase) &&
    value.budgets.every(validBudget)
}
