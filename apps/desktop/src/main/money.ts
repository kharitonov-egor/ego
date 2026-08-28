import { randomUUID } from 'crypto'
import {
  calculateAccountBalance,
  createPurchaseStatements,
  deleteBudgetStatements,
  deletePurchaseStatements,
  isAccountInput,
  isBudgetInput,
  isCategoryInput,
  isMoneySnapshot,
  isPurchaseInput,
  isTransactionInput,
  MONEY_SCHEMA_QUERIES,
  saveBudgetStatements,
  updatePurchaseStatements,
  type AccountInput,
  type AccountKind,
  type ArchiveInput,
  type BudgetInput,
  type CategoryInput,
  type CategoryKind,
  type MoneyAccount,
  type MoneyCategory,
  type MoneyPurchase,
  type MoneyResult,
  type MoneySnapshot,
  type MoneySyncConfigInput,
  type MoneyTransaction,
  type MonthlyBudget,
  type PurchaseInput,
  type ReceiptItem,
  type TransactionInput,
  type TransactionKind
} from '@ego/core'
import {
  getMoneyApiToken,
  getMoneyCache,
  getMoneySyncStatus,
  setMoneyCache,
  setMoneySyncConfig
} from './settings'

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
  currency: 'USD'
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

interface BudgetAllocationRow {
  id: string
  budget_id: string
  category_id: string
  amount_cents: number
}

interface D1Query {
  sql: string
  params?: unknown[]
}

interface D1QueryResult {
  success?: boolean
  results?: unknown[]
}

interface CloudflareError {
  message?: string
}

interface D1Response {
  success?: boolean
  result?: D1QueryResult[]
  errors?: CloudflareError[]
}

class MoneyApiError extends Error {
  constructor(
    message: string,
    readonly code: 'AUTH_REQUIRED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'OFFLINE' | 'NOT_CONFIGURED' | 'SERVER_ERROR'
  ) {
    super(message)
  }
}

let schemaReady = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isD1Response(value: unknown): value is D1Response {
  return isRecord(value) && (value.success === true || value.success === false)
}

function failure<T>(error: unknown): MoneyResult<T> {
  if (error instanceof MoneyApiError) {
    return { ok: false, code: error.code, message: error.message }
  }
  return { ok: false, code: 'SERVER_ERROR', message: 'D1 could not complete the request' }
}

function offline(error: unknown): MoneyResult<MoneySnapshot> {
  const base = failure<MoneySnapshot>(error)
  const cachedData = getMoneyCache()
  return cachedData && !base.ok ? { ...base, cachedData } : base
}

async function d1Batch(queries: D1Query[]): Promise<D1QueryResult[]> {
  const status = getMoneySyncStatus()
  const apiToken = getMoneyApiToken()
  if (!status.configured || !apiToken) {
    throw new MoneyApiError('Add the Cloudflare account ID, D1 database ID, and API token in Settings', 'NOT_CONFIGURED')
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(status.accountId)}/d1/database/${encodeURIComponent(status.databaseId)}/query`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(queries.length === 1 ? queries[0] : { batch: queries }),
      signal: AbortSignal.timeout(15000)
    })
  } catch {
    throw new MoneyApiError('Cloudflare is unreachable', 'OFFLINE')
  }
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new MoneyApiError('Cloudflare returned an unreadable response', 'SERVER_ERROR')
  }
  if (!isD1Response(value)) throw new MoneyApiError('Cloudflare returned an invalid D1 response', 'SERVER_ERROR')
  if (!response.ok || !value.success) {
    const message = value.errors?.find((item) => item.message)?.message ?? `Cloudflare returned HTTP ${response.status}`
    throw new MoneyApiError(message, response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'SERVER_ERROR')
  }
  const results = value.result ?? []
  if (results.length < queries.length || results.some((result) => result.success === false)) {
    throw new MoneyApiError('A D1 query failed', 'SERVER_ERROR')
  }
  return results
}

async function ensureSchema(): Promise<void> {
  if (schemaReady) return
  await d1Batch(MONEY_SCHEMA_QUERIES.map((sql) => ({ sql })))
  schemaReady = true
}

function rows<T>(result: D1QueryResult): T[] {
  return (result.results ?? []) as T[]
}

function mapTransaction(row: TransactionRow): MoneyTransaction {
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

async function loadSnapshot(): Promise<MoneySnapshot> {
  await ensureSchema()
  const [accountResult, categoryResult, transactionResult, purchaseResult, itemResult,
    budgetResult, allocationResult] = await d1Batch([
    { sql: 'SELECT * FROM accounts ORDER BY created_at' },
    { sql: 'SELECT * FROM categories ORDER BY kind, name COLLATE NOCASE' },
    { sql: 'SELECT * FROM transactions ORDER BY date DESC, created_at DESC' },
    { sql: 'SELECT * FROM purchases ORDER BY purchase_date DESC, created_at DESC' },
    { sql: 'SELECT * FROM receipt_items ORDER BY purchase_id, position' },
    { sql: 'SELECT * FROM budgets ORDER BY month DESC' },
    { sql: 'SELECT * FROM budget_allocations' }
  ])
  const transactions = rows<TransactionRow>(transactionResult).map(mapTransaction)
  const accounts = rows<AccountRow>(accountResult).map((row): MoneyAccount => {
    const account = {
      id: row.id,
      name: row.name,
      kind: row.kind,
      icon: row.icon,
      color: row.color,
      openingBalanceCents: row.opening_balance_cents,
      openingDate: row.opening_date,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
    return { ...account, balanceCents: calculateAccountBalance(account, transactions) }
  })
  const categories = rows<CategoryRow>(categoryResult).map((row): MoneyCategory => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    color: row.color,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
  const receiptItems = rows<ReceiptItemRow>(itemResult).map((row): ReceiptItem => ({
    id: row.id, purchaseId: row.purchase_id, position: row.position, name: row.name,
    quantity: row.quantity, unitPriceCents: row.unit_price_cents,
    grossPriceCents: row.gross_price_cents, discountCents: row.discount_cents,
    lineTotalCents: row.line_total_cents
  }))
  const purchases = rows<PurchaseRow>(purchaseResult).map((row): MoneyPurchase => ({
    id: row.id, transactionId: row.transaction_id, merchant: row.merchant,
    purchaseDate: row.purchase_date, currency: row.currency,
    subtotalCents: row.subtotal_cents, discountCents: row.discount_cents,
    taxCents: row.tax_cents, feesCents: row.fees_cents, totalCents: row.total_cents,
    createdAt: row.created_at, updatedAt: row.updated_at,
    items: receiptItems.filter((item) => item.purchaseId === row.id)
  }))
  const allocations = rows<BudgetAllocationRow>(allocationResult).map((row) => ({
    id: row.id, budgetId: row.budget_id, categoryId: row.category_id, amountCents: row.amount_cents
  }))
  const budgets = rows<BudgetRow>(budgetResult).map((row): MonthlyBudget => ({
    id: row.id, month: row.month, plannedIncomeCents: row.planned_income_cents,
    createdAt: row.created_at, updatedAt: row.updated_at,
    allocations: allocations.filter((item) => item.budgetId === row.id)
  }))
  const snapshot = { accounts, categories, transactions, purchases, budgets, syncedAt: new Date().toISOString() }
  if (!isMoneySnapshot(snapshot)) throw new MoneyApiError('D1 returned invalid money data', 'SERVER_ERROR')
  setMoneyCache(snapshot)
  return snapshot
}

async function mutate(query: D1Query): Promise<MoneyResult<MoneySnapshot>> {
  try {
    await ensureSchema()
    await d1Batch([query])
    return { ok: true, data: await loadSnapshot() }
  } catch (error: unknown) {
    return error instanceof MoneyApiError && error.code === 'OFFLINE' ? offline(error) : failure(error)
  }
}

async function mutateBatch(queries: D1Query[]): Promise<MoneyResult<MoneySnapshot>> {
  try {
    await ensureSchema()
    await d1Batch(queries)
    return { ok: true, data: await loadSnapshot() }
  } catch (error: unknown) {
    return error instanceof MoneyApiError && error.code === 'OFFLINE' ? offline(error) : failure(error)
  }
}

async function currentSnapshot(): Promise<MoneySnapshot> {
  return loadSnapshot()
}

function cleanAccount(input: AccountInput): AccountInput {
  return { ...input, name: input.name.trim(), icon: input.icon.trim(), color: input.color.trim() }
}

function cleanCategory(input: CategoryInput): CategoryInput {
  return { ...input, name: input.name.trim(), icon: input.icon.trim(), color: input.color.trim() }
}

async function validateTransactionReferences(input: TransactionInput): Promise<void> {
  const snapshot = await currentSnapshot()
  const source = snapshot.accounts.find((account) => account.id === input.accountId)
  if (!source) throw new MoneyApiError('Source account was not found', 'NOT_FOUND')
  if (source.archivedAt) throw new MoneyApiError('Source account is archived', 'CONFLICT')
  if (input.kind === 'transfer') {
    const destination = snapshot.accounts.find((account) => account.id === input.destinationAccountId)
    if (!destination) throw new MoneyApiError('Destination account was not found', 'NOT_FOUND')
    if (destination.archivedAt) throw new MoneyApiError('Destination account is archived', 'CONFLICT')
  } else {
    const category = snapshot.categories.find((item) => item.id === input.categoryId)
    if (!category) throw new MoneyApiError('Category was not found', 'NOT_FOUND')
    if (category.archivedAt) throw new MoneyApiError('Category is archived', 'CONFLICT')
    if (category.kind !== input.kind) throw new MoneyApiError(`This transaction needs an ${input.kind} category`, 'CONFLICT')
  }
}

async function validatePurchaseReferences(input: PurchaseInput): Promise<void> {
  const snapshot = await currentSnapshot()
  const account = snapshot.accounts.find((item) => item.id === input.accountId)
  const category = snapshot.categories.find((item) => item.id === input.categoryId)
  if (!account) throw new MoneyApiError('Account was not found', 'NOT_FOUND')
  if (account.archivedAt) throw new MoneyApiError('Account is archived', 'CONFLICT')
  if (!category) throw new MoneyApiError('Category was not found', 'NOT_FOUND')
  if (category.archivedAt || category.kind !== 'expense') {
    throw new MoneyApiError('Choose an active expense category', 'CONFLICT')
  }
}

async function validateBudgetReferences(input: BudgetInput): Promise<void> {
  if (input.allocations.length === 0) return
  const snapshot = await currentSnapshot()
  input.allocations.forEach((allocation) => {
    const category = snapshot.categories.find((item) => item.id === allocation.categoryId)
    if (!category) throw new MoneyApiError('Category was not found', 'NOT_FOUND')
    if (category.archivedAt || category.kind !== 'expense') {
      throw new MoneyApiError('Budget only covers active expense categories', 'CONFLICT')
    }
  })
}

export const money = {
  getSyncStatus: getMoneySyncStatus,

  async setSyncConfig(input: MoneySyncConfigInput): Promise<MoneyResult<{ connected: true }>> {
    if (!/^[a-f0-9]{32}$/i.test(input.accountId.trim())) {
      return { ok: false, code: 'INVALID_REQUEST', message: 'Enter the 32-character Cloudflare account ID' }
    }
    if (!/^[a-f0-9-]{32,36}$/i.test(input.databaseId.trim())) {
      return { ok: false, code: 'INVALID_REQUEST', message: 'Enter the D1 database UUID' }
    }
    setMoneySyncConfig(input)
    schemaReady = false
    return this.testConnection()
  },

  async testConnection(): Promise<MoneyResult<{ connected: true }>> {
    try {
      await ensureSchema()
      await d1Batch([{ sql: 'SELECT 1 AS connected' }])
      return { ok: true, data: { connected: true } }
    } catch (error: unknown) {
      return failure(error)
    }
  },

  async getSnapshot(): Promise<MoneyResult<MoneySnapshot>> {
    try {
      return { ok: true, data: await loadSnapshot() }
    } catch (error: unknown) {
      return offline(error)
    }
  },

  async createAccount(input: AccountInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isAccountInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the account fields' }
    const value = cleanAccount(input)
    const now = new Date().toISOString()
    return mutate({
      sql: `INSERT INTO accounts
        (id, name, kind, icon, color, opening_balance_cents, opening_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [randomUUID(), value.name, value.kind, value.icon, value.color, value.openingBalanceCents, value.openingDate, now, now]
    })
  },

  async updateAccount(id: string, input: AccountInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isAccountInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the account fields' }
    const snapshot = await this.getSnapshot()
    if (!snapshot.ok) return snapshot
    if (!snapshot.data.accounts.some((account) => account.id === id)) return { ok: false, code: 'NOT_FOUND', message: 'Account was not found' }
    const value = cleanAccount(input)
    return mutate({
      sql: `UPDATE accounts SET name = ?, kind = ?, icon = ?, color = ?,
        opening_balance_cents = ?, opening_date = ?, updated_at = ? WHERE id = ?`,
      params: [value.name, value.kind, value.icon, value.color, value.openingBalanceCents, value.openingDate, new Date().toISOString(), id]
    })
  },

  async archiveAccount(id: string, input: ArchiveInput): Promise<MoneyResult<MoneySnapshot>> {
    if (typeof input.archived !== 'boolean') return { ok: false, code: 'INVALID_REQUEST', message: 'Archive state is required' }
    return mutate({
      sql: 'UPDATE accounts SET archived_at = ?, updated_at = ? WHERE id = ?',
      params: [input.archived ? new Date().toISOString() : null, new Date().toISOString(), id]
    })
  },

  async createCategory(input: CategoryInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isCategoryInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the category fields' }
    const value = cleanCategory(input)
    const now = new Date().toISOString()
    return mutate({
      sql: 'INSERT INTO categories (id, name, kind, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: [randomUUID(), value.name, value.kind, value.icon, value.color, now, now]
    })
  },

  async updateCategory(id: string, input: CategoryInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isCategoryInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the category fields' }
    const snapshot = await this.getSnapshot()
    if (!snapshot.ok) return snapshot
    if (!snapshot.data.categories.some((category) => category.id === id)) return { ok: false, code: 'NOT_FOUND', message: 'Category was not found' }
    if (snapshot.data.transactions.some((transaction) => transaction.categoryId === id && transaction.kind !== input.kind)) {
      return { ok: false, code: 'CONFLICT', message: 'A used category cannot change type' }
    }
    const value = cleanCategory(input)
    return mutate({
      sql: 'UPDATE categories SET name = ?, kind = ?, icon = ?, color = ?, updated_at = ? WHERE id = ?',
      params: [value.name, value.kind, value.icon, value.color, new Date().toISOString(), id]
    })
  },

  async archiveCategory(id: string, input: ArchiveInput): Promise<MoneyResult<MoneySnapshot>> {
    if (typeof input.archived !== 'boolean') return { ok: false, code: 'INVALID_REQUEST', message: 'Archive state is required' }
    return mutate({
      sql: 'UPDATE categories SET archived_at = ?, updated_at = ? WHERE id = ?',
      params: [input.archived ? new Date().toISOString() : null, new Date().toISOString(), id]
    })
  },

  async createTransaction(input: TransactionInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isTransactionInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the transaction fields' }
    try {
      await validateTransactionReferences(input)
    } catch (error: unknown) {
      return failure(error)
    }
    const now = new Date().toISOString()
    return mutate({
      sql: `INSERT INTO transactions
        (id, kind, account_id, destination_account_id, category_id, amount_cents, date, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [randomUUID(), input.kind, input.accountId, input.destinationAccountId, input.categoryId, input.amountCents, input.date, input.notes.trim(), now, now]
    })
  },

  async updateTransaction(id: string, input: TransactionInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isTransactionInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the transaction fields' }
    try {
      const snapshot = await currentSnapshot()
      if (!snapshot.transactions.some((transaction) => transaction.id === id)) throw new MoneyApiError('Transaction was not found', 'NOT_FOUND')
      await validateTransactionReferences(input)
    } catch (error: unknown) {
      return failure(error)
    }
    return mutate({
      sql: `UPDATE transactions SET kind = ?, account_id = ?, destination_account_id = ?,
        category_id = ?, amount_cents = ?, date = ?, notes = ?, updated_at = ? WHERE id = ?`,
      params: [input.kind, input.accountId, input.destinationAccountId, input.categoryId, input.amountCents, input.date, input.notes.trim(), new Date().toISOString(), id]
    })
  },

  async deleteTransaction(id: string): Promise<MoneyResult<MoneySnapshot>> {
    const snapshot = await this.getSnapshot()
    if (!snapshot.ok) return snapshot
    if (!snapshot.data.transactions.some((transaction) => transaction.id === id)) return { ok: false, code: 'NOT_FOUND', message: 'Transaction was not found' }
    return mutate({ sql: 'DELETE FROM transactions WHERE id = ?', params: [id] })
  },

  async saveBudget(input: BudgetInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isBudgetInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the budget amounts' }
    try { await validateBudgetReferences(input) } catch (error: unknown) { return failure(error) }
    return mutateBatch(saveBudgetStatements(input, {
      budgetId: randomUUID(), allocationIds: input.allocations.map(() => randomUUID())
    }, new Date().toISOString()))
  },

  async deleteBudget(month: string): Promise<MoneyResult<MoneySnapshot>> {
    return mutateBatch(deleteBudgetStatements(month))
  },

  async createPurchase(input: PurchaseInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isPurchaseInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the purchase fields' }
    try { await validatePurchaseReferences(input) } catch (error: unknown) { return failure(error) }
    const purchaseId = randomUUID()
    const transactionId = randomUUID()
    const now = new Date().toISOString()
    return mutateBatch(createPurchaseStatements(input, {
      purchaseId, transactionId, itemIds: input.items.map(() => randomUUID())
    }, now))
  },

  async updatePurchase(id: string, input: PurchaseInput): Promise<MoneyResult<MoneySnapshot>> {
    if (!isPurchaseInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the purchase fields' }
    let purchase: MoneyPurchase | undefined
    try {
      const snapshot = await currentSnapshot()
      purchase = snapshot.purchases.find((item) => item.id === id)
      if (!purchase) throw new MoneyApiError('Purchase was not found', 'NOT_FOUND')
      await validatePurchaseReferences(input)
    } catch (error: unknown) { return failure(error) }
    const now = new Date().toISOString()
    return mutateBatch(updatePurchaseStatements(id, purchase.transactionId, input,
      input.items.map(() => randomUUID()), now))
  },

  async deletePurchase(id: string): Promise<MoneyResult<MoneySnapshot>> {
    const snapshot = await this.getSnapshot()
    if (!snapshot.ok) return snapshot
    const purchase = snapshot.data.purchases.find((item) => item.id === id)
    if (!purchase) return { ok: false, code: 'NOT_FOUND', message: 'Purchase was not found' }
    return mutateBatch(deletePurchaseStatements(purchase.transactionId))
  }
}
