import * as SecureStore from 'expo-secure-store'
import {
  MONEY_SCHEMA_QUERIES,
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
  parseCachedSnapshot,
  saveBudgetStatements,
  updatePurchaseStatements,
  type AccountInput,
  type AccountKind,
  type BudgetInput,
  type ArchiveInput,
  type CategoryInput,
  type CategoryKind,
  type MoneyAccount,
  type MoneyCategory,
  type MoneyPurchase,
  type MonthlyBudget,
  type MoneyResult,
  type MoneySnapshot,
  type MoneyTransaction,
  type PurchaseInput,
  type ReceiptItem,
  type TransactionInput,
  type TransactionKind
} from '@ego/core'
import type { EgoSettings } from './settings'

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
  id: string; transaction_id: string; merchant: string; purchase_date: string; currency: 'USD'
  subtotal_cents: number; discount_cents: number; tax_cents: number; fees_cents: number
  total_cents: number; created_at: string; updated_at: string
}

interface ReceiptItemRow {
  id: string; purchase_id: string; position: number; name: string; quantity: number
  unit_price_cents: number | null; gross_price_cents: number; discount_cents: number
  line_total_cents: number
}

interface BudgetRow {
  id: string; month: string; planned_income_cents: number; created_at: string; updated_at: string
}

interface BudgetAllocationRow {
  id: string; budget_id: string; category_id: string; amount_cents: number
}

interface D1Query { sql: string; params?: unknown[] }
interface D1QueryResult { success?: boolean; results?: unknown[] }
interface D1Response {
  success?: boolean
  result?: D1QueryResult[]
  errors?: Array<{ message?: string }>
}

export interface MobileMoneyClient {
  testConnection: () => Promise<MoneyResult<{ connected: true }>>
  getSnapshot: () => Promise<MoneyResult<MoneySnapshot>>
  createAccount: (input: AccountInput) => Promise<MoneyResult<MoneySnapshot>>
  updateAccount: (id: string, input: AccountInput) => Promise<MoneyResult<MoneySnapshot>>
  archiveAccount: (id: string, input: ArchiveInput) => Promise<MoneyResult<MoneySnapshot>>
  createCategory: (input: CategoryInput) => Promise<MoneyResult<MoneySnapshot>>
  updateCategory: (id: string, input: CategoryInput) => Promise<MoneyResult<MoneySnapshot>>
  archiveCategory: (id: string, input: ArchiveInput) => Promise<MoneyResult<MoneySnapshot>>
  createTransaction: (input: TransactionInput) => Promise<MoneyResult<MoneySnapshot>>
  updateTransaction: (id: string, input: TransactionInput) => Promise<MoneyResult<MoneySnapshot>>
  deleteTransaction: (id: string) => Promise<MoneyResult<MoneySnapshot>>
  deleteTransactions: (ids: string[]) => Promise<MoneyResult<MoneySnapshot>>
  saveBudget: (input: BudgetInput) => Promise<MoneyResult<MoneySnapshot>>
  deleteBudget: (month: string) => Promise<MoneyResult<MoneySnapshot>>
  createPurchase: (input: PurchaseInput) => Promise<MoneyResult<MoneySnapshot>>
  updatePurchase: (id: string, input: PurchaseInput) => Promise<MoneyResult<MoneySnapshot>>
  deletePurchase: (id: string) => Promise<MoneyResult<MoneySnapshot>>
}

class D1Error extends Error {
  constructor(message: string, readonly code: 'AUTH_REQUIRED' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'OFFLINE' | 'NOT_CONFIGURED' | 'SERVER_ERROR') {
    super(message)
  }
}

const CACHE_KEY = 'ego.money.snapshot'
const CACHE_META_KEY = `${CACHE_KEY}.meta`
const CACHE_CHUNK_SIZE = 1800
const initialized = new Set<string>()

async function readCache(): Promise<MoneySnapshot | null> {
  const metaRaw = await SecureStore.getItemAsync(CACHE_META_KEY)
  if (!metaRaw) return null
  const meta: unknown = JSON.parse(metaRaw)
  if (!isRecord(meta) || !Number.isSafeInteger(meta.chunks) || Number(meta.chunks) < 1) return null
  const parts = await Promise.all(Array.from({ length: Number(meta.chunks) }, (_, index) => SecureStore.getItemAsync(`${CACHE_KEY}.${index}`)))
  if (parts.some((part) => part === null)) return null
  return parseCachedSnapshot(parts.join(''))
}

async function writeCache(snapshot: MoneySnapshot): Promise<void> {
  const raw = JSON.stringify(snapshot)
  const chunks = Array.from({ length: Math.ceil(raw.length / CACHE_CHUNK_SIZE) }, (_, index) => raw.slice(index * CACHE_CHUNK_SIZE, (index + 1) * CACHE_CHUNK_SIZE))
  const previousRaw = await SecureStore.getItemAsync(CACHE_META_KEY)
  let previousCount = 0
  try {
    const previous: unknown = previousRaw ? JSON.parse(previousRaw) : null
    if (isRecord(previous) && Number.isSafeInteger(previous.chunks)) previousCount = Number(previous.chunks)
  } catch {
    previousCount = 0
  }
  await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(`${CACHE_KEY}.${index}`, chunk)))
  await SecureStore.setItemAsync(CACHE_META_KEY, JSON.stringify({ chunks: chunks.length }))
  await Promise.all(Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_, index) => SecureStore.deleteItemAsync(`${CACHE_KEY}.${chunks.length + index}`)))
}

function id(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isD1Response(value: unknown): value is D1Response {
  return isRecord(value) && typeof value.success === 'boolean'
}

function failure<T>(error: unknown): MoneyResult<T> {
  if (error instanceof D1Error) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'SERVER_ERROR', message: 'D1 could not complete the request' }
}

async function cachedFailure(error: unknown): Promise<MoneyResult<MoneySnapshot>> {
  const base = failure<MoneySnapshot>(error)
  try {
    const value = await readCache()
    return value && !base.ok ? { ...base, cachedData: value } : base
  } catch {
    return base
  }
}

function rows<T>(result: D1QueryResult): T[] {
  return (result.results ?? []) as T[]
}

function transaction(row: TransactionRow): MoneyTransaction {
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

export function moneyClientFor(settings: Pick<EgoSettings, 'cloudflareAccountId' | 'd1DatabaseId' | 'd1ApiToken'>): MobileMoneyClient {
  const configKey = `${settings.cloudflareAccountId}:${settings.d1DatabaseId}`

  const batch = async (queries: D1Query[]): Promise<D1QueryResult[]> => {
    if (!settings.cloudflareAccountId || !settings.d1DatabaseId || !settings.d1ApiToken) {
      throw new D1Error('Add the Cloudflare account ID, D1 database ID, and API token in Settings', 'NOT_CONFIGURED')
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(settings.cloudflareAccountId)}/d1/database/${encodeURIComponent(settings.d1DatabaseId)}/query`
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${settings.d1ApiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(queries.length === 1 ? queries[0] : { batch: queries })
      })
    } catch {
      throw new D1Error('Cloudflare is unreachable', 'OFFLINE')
    }
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new D1Error('Cloudflare returned an unreadable response', 'SERVER_ERROR')
    }
    if (!isD1Response(value)) throw new D1Error('Cloudflare returned an invalid D1 response', 'SERVER_ERROR')
    if (!response.ok || !value.success) {
      const message = value.errors?.find((item) => item.message)?.message ?? `Cloudflare returned HTTP ${response.status}`
      throw new D1Error(message, response.status === 401 || response.status === 403 ? 'AUTH_REQUIRED' : 'SERVER_ERROR')
    }
    const results = value.result ?? []
    if (results.length < queries.length || results.some((item) => item.success === false)) throw new D1Error('A D1 query failed', 'SERVER_ERROR')
    return results
  }

  const ensureSchema = async (): Promise<void> => {
    if (initialized.has(configKey)) return
    await batch(MONEY_SCHEMA_QUERIES.map((sql) => ({ sql })))
    initialized.add(configKey)
  }

  const snapshotQueries: D1Query[] = [
    { sql: 'SELECT * FROM accounts ORDER BY created_at' },
    { sql: 'SELECT * FROM categories ORDER BY kind, name COLLATE NOCASE' },
    { sql: 'SELECT * FROM transactions ORDER BY date DESC, created_at DESC' },
    { sql: 'SELECT * FROM purchases ORDER BY purchase_date DESC, created_at DESC' },
    { sql: 'SELECT * FROM receipt_items ORDER BY purchase_id, position' },
    { sql: 'SELECT * FROM budgets ORDER BY month DESC' },
    { sql: 'SELECT * FROM budget_allocations' }
  ]
  let latestSnapshot: MoneySnapshot | null = null

  const snapshotFrom = (results: D1QueryResult[]): MoneySnapshot => {
    const [accountResult, categoryResult, transactionResult, purchaseResult, itemResult,
      budgetResult, allocationResult] = results
    const transactions = rows<TransactionRow>(transactionResult).map(transaction)
    const accounts = rows<AccountRow>(accountResult).map((row): MoneyAccount => {
      const account = {
        id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
        openingBalanceCents: row.opening_balance_cents, openingDate: row.opening_date,
        archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at
      }
      return { ...account, balanceCents: calculateAccountBalance(account, transactions) }
    })
    const categories = rows<CategoryRow>(categoryResult).map((row): MoneyCategory => ({
      id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at
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
    if (!isMoneySnapshot(snapshot)) throw new D1Error('D1 returned invalid money data', 'SERVER_ERROR')
    latestSnapshot = snapshot
    void writeCache(snapshot).catch(() => undefined)
    return snapshot
  }

  const load = async (): Promise<MoneySnapshot> => {
    await ensureSchema()
    return snapshotFrom(await batch(snapshotQueries))
  }

  const localSnapshot = async (): Promise<MoneySnapshot> => {
    if (latestSnapshot) return latestSnapshot
    try {
      const cached = await readCache()
      if (cached) return cached
    } catch {
      // A broken cache should not block an online write.
    }
    return load()
  }

  const mutateBatch = async (queries: D1Query[]): Promise<MoneyResult<MoneySnapshot>> => {
    try {
      await ensureSchema()
      const results = await batch([...queries, ...snapshotQueries])
      return { ok: true, data: snapshotFrom(results.slice(queries.length)) }
    } catch (error: unknown) {
      return cachedFailure(error)
    }
  }

  const mutate = (query: D1Query): Promise<MoneyResult<MoneySnapshot>> => mutateBatch([query])

  const references = async (input: TransactionInput): Promise<void> => {
    const snapshot = await localSnapshot()
    const source = snapshot.accounts.find((item) => item.id === input.accountId)
    if (!source) throw new D1Error('Source account was not found', 'NOT_FOUND')
    if (source.archivedAt) throw new D1Error('Source account is archived', 'CONFLICT')
    if (input.kind === 'transfer') {
      const destination = snapshot.accounts.find((item) => item.id === input.destinationAccountId)
      if (!destination) throw new D1Error('Destination account was not found', 'NOT_FOUND')
      if (destination.archivedAt) throw new D1Error('Destination account is archived', 'CONFLICT')
    } else {
      const category = snapshot.categories.find((item) => item.id === input.categoryId)
      if (!category) throw new D1Error('Category was not found', 'NOT_FOUND')
      if (category.archivedAt || category.kind !== input.kind) throw new D1Error(`Choose an active ${input.kind} category`, 'CONFLICT')
    }
  }

  const purchaseReferences = async (input: PurchaseInput): Promise<void> => {
    const snapshot = await localSnapshot()
    const account = snapshot.accounts.find((item) => item.id === input.accountId)
    const category = snapshot.categories.find((item) => item.id === input.categoryId)
    if (!account) throw new D1Error('Account was not found', 'NOT_FOUND')
    if (account.archivedAt) throw new D1Error('Account is archived', 'CONFLICT')
    if (!category) throw new D1Error('Category was not found', 'NOT_FOUND')
    if (category.archivedAt || category.kind !== 'expense') throw new D1Error('Choose an active expense category', 'CONFLICT')
  }

  const budgetReferences = async (input: BudgetInput): Promise<void> => {
    if (input.allocations.length === 0) return
    const snapshot = await localSnapshot()
    input.allocations.forEach((allocation) => {
      const category = snapshot.categories.find((item) => item.id === allocation.categoryId)
      if (!category) throw new D1Error('Category was not found', 'NOT_FOUND')
      if (category.archivedAt || category.kind !== 'expense') throw new D1Error('Budget only covers active expense categories', 'CONFLICT')
    })
  }

  return {
    async testConnection() {
      try {
        await ensureSchema()
        await batch([{ sql: 'SELECT 1 AS connected' }])
        return { ok: true, data: { connected: true } }
      } catch (error: unknown) {
        return failure(error)
      }
    },
    async getSnapshot() {
      try { return { ok: true, data: await load() } } catch (error: unknown) { return cachedFailure(error) }
    },
    async createAccount(input) {
      if (!isAccountInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the account fields' }
      const now = new Date().toISOString()
      return mutate({ sql: 'INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [id(), input.name.trim(), input.kind, input.icon, input.color, input.openingBalanceCents, input.openingDate, now, now] })
    },
    async updateAccount(accountId, input) {
      if (!isAccountInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the account fields' }
      return mutate({ sql: 'UPDATE accounts SET name = ?, kind = ?, icon = ?, color = ?, opening_balance_cents = ?, opening_date = ?, updated_at = ? WHERE id = ?', params: [input.name.trim(), input.kind, input.icon, input.color, input.openingBalanceCents, input.openingDate, new Date().toISOString(), accountId] })
    },
    archiveAccount: (accountId, input) => mutate({ sql: 'UPDATE accounts SET archived_at = ?, updated_at = ? WHERE id = ?', params: [input.archived ? new Date().toISOString() : null, new Date().toISOString(), accountId] }),
    async createCategory(input) {
      if (!isCategoryInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the category fields' }
      const now = new Date().toISOString()
      return mutate({ sql: 'INSERT INTO categories (id, name, kind, icon, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', params: [id(), input.name.trim(), input.kind, input.icon, input.color, now, now] })
    },
    async updateCategory(categoryId, input) {
      if (!isCategoryInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the category fields' }
      try {
        const snapshot = await localSnapshot()
        if (snapshot.transactions.some((item) => item.categoryId === categoryId && item.kind !== input.kind)) {
          return { ok: false, code: 'CONFLICT', message: 'A used category cannot change type' }
        }
      } catch (error: unknown) {
        return failure(error)
      }
      return mutate({ sql: 'UPDATE categories SET name = ?, kind = ?, icon = ?, color = ?, updated_at = ? WHERE id = ?', params: [input.name.trim(), input.kind, input.icon, input.color, new Date().toISOString(), categoryId] })
    },
    archiveCategory: (categoryId, input) => mutate({ sql: 'UPDATE categories SET archived_at = ?, updated_at = ? WHERE id = ?', params: [input.archived ? new Date().toISOString() : null, new Date().toISOString(), categoryId] }),
    async createTransaction(input) {
      if (!isTransactionInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the transaction fields' }
      try { await references(input) } catch (error: unknown) { return failure(error) }
      const now = new Date().toISOString()
      return mutate({ sql: 'INSERT INTO transactions (id, kind, account_id, destination_account_id, category_id, amount_cents, date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', params: [id(), input.kind, input.accountId, input.destinationAccountId, input.categoryId, input.amountCents, input.date, input.notes.trim(), now, now] })
    },
    async updateTransaction(transactionId, input) {
      if (!isTransactionInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the transaction fields' }
      try { await references(input) } catch (error: unknown) { return failure(error) }
      return mutate({ sql: 'UPDATE transactions SET kind = ?, account_id = ?, destination_account_id = ?, category_id = ?, amount_cents = ?, date = ?, notes = ?, updated_at = ? WHERE id = ?', params: [input.kind, input.accountId, input.destinationAccountId, input.categoryId, input.amountCents, input.date, input.notes.trim(), new Date().toISOString(), transactionId] })
    },
    deleteTransaction: (transactionId) => mutate({ sql: 'DELETE FROM transactions WHERE id = ?', params: [transactionId] }),
    deleteTransactions: (transactionIds) => transactionIds.length === 0
      ? mutateBatch([])
      : mutateBatch(transactionIds.map((transactionId) => ({ sql: 'DELETE FROM transactions WHERE id = ?', params: [transactionId] }))),
    async saveBudget(input) {
      if (!isBudgetInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the budget amounts' }
      try { await budgetReferences(input) } catch (error: unknown) { return failure(error) }
      return mutateBatch(saveBudgetStatements(input, {
        budgetId: id(), allocationIds: input.allocations.map(() => id())
      }, new Date().toISOString()))
    },
    deleteBudget: (month) => mutateBatch(deleteBudgetStatements(month)),
    async createPurchase(input) {
      if (!isPurchaseInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the purchase fields' }
      try { await purchaseReferences(input) } catch (error: unknown) { return failure(error) }
      const purchaseId = id()
      const transactionId = id()
      const now = new Date().toISOString()
      return mutateBatch(createPurchaseStatements(input, {
        purchaseId, transactionId, itemIds: input.items.map(() => id())
      }, now))
    },
    async updatePurchase(purchaseId, input) {
      if (!isPurchaseInput(input)) return { ok: false, code: 'INVALID_REQUEST', message: 'Check the purchase fields' }
      let purchase: MoneyPurchase | undefined
      try {
        const snapshot = await localSnapshot()
        purchase = snapshot.purchases.find((item) => item.id === purchaseId)
        if (!purchase) throw new D1Error('Purchase was not found', 'NOT_FOUND')
        await purchaseReferences(input)
      } catch (error: unknown) { return failure(error) }
      const now = new Date().toISOString()
      return mutateBatch(updatePurchaseStatements(purchaseId, purchase.transactionId, input,
        input.items.map(() => id()), now))
    },
    async deletePurchase(purchaseId) {
      let snapshot: MoneySnapshot
      try { snapshot = await localSnapshot() } catch (error: unknown) { return failure(error) }
      const purchase = snapshot.purchases.find((item) => item.id === purchaseId)
      if (!purchase) return { ok: false, code: 'NOT_FOUND', message: 'Purchase was not found' }
      return mutateBatch(deletePurchaseStatements(purchase.transactionId))
    }
  }
}
