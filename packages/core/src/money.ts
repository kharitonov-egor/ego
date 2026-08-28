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

export interface MoneySnapshot {
  accounts: MoneyAccount[]
  categories: MoneyCategory[]
  transactions: MoneyTransaction[]
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
  'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_destination ON transactions(destination_account_id)',
  'CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)'
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isMoneySnapshot(value: unknown): value is MoneySnapshot {
  if (!isRecord(value) || !Array.isArray(value.accounts) || !Array.isArray(value.categories) ||
    !Array.isArray(value.transactions) || typeof value.syncedAt !== 'string') return false
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
  return value.accounts.every(validAccount) && value.categories.every(validCategory) &&
    value.transactions.every(validTransaction)
}
