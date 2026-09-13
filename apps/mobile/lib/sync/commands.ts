import type { SyncCommand, SyncOperation } from '@ego/api-contracts'
import type {
  AccountInput, BudgetInput, CategoryInput, PurchaseInput, TransactionInput
} from '@ego/core'
import type { LocalDatabase } from '../database/types'
import { applyCommandLocally } from './local-apply'
import { commitLocalWrite } from './outbox'

/** Generated once per record and per operation, and reused on every retry. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

export async function submit(
  db: LocalDatabase,
  entityId: string,
  expectedRevision: number | null,
  command: SyncCommand,
  now: string
): Promise<SyncOperation> {
  const operation: SyncOperation = {
    operationId: newId(),
    entityId,
    expectedRevision,
    createdAt: now,
    command
  }
  await commitLocalWrite(db, operation, (tx) => applyCommandLocally(tx, operation, now))
  return operation
}

export const createTransaction = (db: LocalDatabase, input: TransactionInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'transaction', type: 'create', payload: input }, now)

export const updateTransaction = (
  db: LocalDatabase, id: string, revision: number, input: TransactionInput, now: string
) => submit(db, id, revision, { entity: 'transaction', type: 'update', payload: input }, now)

export const deleteTransaction = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'transaction', type: 'delete' }, now)

export const createPurchase = (db: LocalDatabase, input: PurchaseInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'purchase', type: 'create', payload: input }, now)

export const updatePurchase = (
  db: LocalDatabase, id: string, revision: number, input: PurchaseInput, now: string
) => submit(db, id, revision, { entity: 'purchase', type: 'update', payload: input }, now)

export const deletePurchase = (db: LocalDatabase, id: string, revision: number, now: string) =>
  submit(db, id, revision, { entity: 'purchase', type: 'delete' }, now)

export const createAccount = (db: LocalDatabase, input: AccountInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'account', type: 'create', payload: input }, now)

export const updateAccount = (
  db: LocalDatabase, id: string, revision: number, input: AccountInput, now: string
) => submit(db, id, revision, { entity: 'account', type: 'update', payload: input }, now)

export const archiveAccount = (
  db: LocalDatabase, id: string, revision: number, archived: boolean, now: string
) => submit(db, id, revision, { entity: 'account', type: 'archive', payload: { archived } }, now)

export const createCategory = (db: LocalDatabase, input: CategoryInput, now: string, id = newId()) =>
  submit(db, id, null, { entity: 'category', type: 'create', payload: input }, now)

export const updateCategory = (
  db: LocalDatabase, id: string, revision: number, input: CategoryInput, now: string
) => submit(db, id, revision, { entity: 'category', type: 'update', payload: input }, now)

export const archiveCategory = (
  db: LocalDatabase, id: string, revision: number, archived: boolean, now: string
) => submit(db, id, revision, { entity: 'category', type: 'archive', payload: { archived } }, now)

export const saveBudget = (
  db: LocalDatabase, input: BudgetInput, revision: number | null, now: string
) => submit(db, input.month, revision, { entity: 'budget', type: 'save', payload: input }, now)

export const deleteBudget = (db: LocalDatabase, month: string, revision: number, now: string) =>
  submit(db, month, revision, { entity: 'budget', type: 'delete' }, now)
