import type { MoneyTransaction, TransactionInput } from '@ego/core'
import type { SyncOperation } from '@ego/api-contracts'
import { createTestDatabase } from './d1'

export const NOW = '2026-09-12T10:00:00.000Z'

export async function exec(db: D1Database, sql: string, params: unknown[] = []): Promise<void> {
  await db.prepare(sql).bind(...params).run()
}

export interface Ledger {
  db: D1Database
  close: () => void
  transactions: MoneyTransaction[]
}

export async function seedLedger(): Promise<Ledger> {
  const { db, close } = createTestDatabase()
  await exec(db, `INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date,
    created_at, updated_at, revision) VALUES ('acc-check', 'Checking', 'checking', 'wallet', 'blue', 10000,
    '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`)
  await exec(db, `INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date,
    created_at, updated_at, revision) VALUES ('acc-savings', 'Savings', 'savings', 'bank', 'green', 500,
    '2026-01-01', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`)
  await exec(db, `INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date,
    archived_at, created_at, updated_at, revision) VALUES ('acc-old', 'Closed card', 'credit-card', 'card',
    'grey', 0, '2026-01-01', '2026-06-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`)
  await exec(db, `INSERT INTO categories (id, name, kind, icon, color, created_at, updated_at, revision)
    VALUES ('cat-food', 'Food', 'expense', 'cart', 'orange', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`)
  await exec(db, `INSERT INTO categories (id, name, kind, icon, color, created_at, updated_at, revision)
    VALUES ('cat-salary', 'Salary', 'income', 'coins', 'green', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`)
  return { db, close, transactions: [] }
}

export async function addTransaction(ledger: Ledger, transaction: MoneyTransaction): Promise<void> {
  await exec(ledger.db, `INSERT INTO transactions (id, kind, account_id, destination_account_id, category_id,
    amount_cents, date, notes, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  [transaction.id, transaction.kind, transaction.accountId, transaction.destinationAccountId,
    transaction.categoryId, transaction.amountCents, transaction.date, transaction.notes,
    transaction.createdAt, transaction.updatedAt])
  ledger.transactions.push(transaction)
}

export function expense(id: string, date: string, amountCents: number, overrides: Partial<MoneyTransaction> = {}): MoneyTransaction {
  return {
    id, kind: 'expense', accountId: 'acc-check', destinationAccountId: null, categoryId: 'cat-food',
    amountCents, date, notes: '', createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
    ...overrides
  }
}

export function transactionInput(overrides: Partial<TransactionInput> = {}): TransactionInput {
  return {
    kind: 'expense', accountId: 'acc-check', destinationAccountId: null, categoryId: 'cat-food',
    amountCents: 4220, date: '2026-09-12', notes: 'Groceries', ...overrides
  }
}

export function operation(overrides: Partial<SyncOperation> = {}): SyncOperation {
  return {
    operationId: 'op-1',
    entityId: 'tx-new',
    expectedRevision: null,
    createdAt: NOW,
    command: { entity: 'transaction', type: 'create', payload: transactionInput() },
    ...overrides
  }
}
