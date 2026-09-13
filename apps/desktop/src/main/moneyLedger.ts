import { randomUUID } from 'node:crypto'
import type { OperationResponse, SyncCommand, SyncOperation } from '@ego/api-contracts'
import {
  isAccountInput, isBudgetInput, isCategoryInput, isPurchaseInput, isTransactionInput,
  type AccountInput, type ArchiveInput, type BudgetInput, type CategoryInput, type MoneyResult,
  type MoneySnapshot, type PurchaseInput, type TransactionInput
} from '@ego/core'
import { getLedgerConfig, getLedgerToken, getMoneyCache, setMoneyCache } from './settings'

interface LegacyRevisions {
  accounts: Record<string, number>
  categories: Record<string, number>
  transactions: Record<string, number>
  purchases: Record<string, number>
  budgets: Record<string, number>
}

const EMPTY_REVISIONS: LegacyRevisions = {
  accounts: {}, categories: {}, transactions: {}, purchases: {}, budgets: {}
}

let revisions: LegacyRevisions = EMPTY_REVISIONS

export function isLedgerConfigured(): boolean {
  const config = getLedgerConfig()
  return Boolean(config.url && config.hasToken)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function send<T>(path: string, init?: RequestInit): Promise<MoneyResult<T>> {
  const config = getLedgerConfig()
  const token = getLedgerToken()
  if (!config.url || !token) {
    return { ok: false, code: 'NOT_CONFIGURED', message: 'Add the ledger address and device token in Settings' }
  }
  let response: Response
  try {
    response = await fetch(`${config.url.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(15000)
    })
  } catch {
    return { ok: false, code: 'OFFLINE', message: 'The ledger service is unreachable' }
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, code: 'SERVER_ERROR', message: 'The ledger service answered with something unreadable' }
  }
  if (!isRecord(payload) || payload.ok !== true) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    const code = typeof error?.code === 'string' ? error.code : 'SERVER_ERROR'
    const message = typeof error?.message === 'string' ? error.message : `The ledger service returned HTTP ${response.status}`
    return {
      ok: false,
      code: code === 'AUTH_REQUIRED' || code === 'INVALID_REQUEST' || code === 'NOT_FOUND' ||
        code === 'CONFLICT' || code === 'OFFLINE' ? code : 'SERVER_ERROR',
      message
    }
  }
  return { ok: true, data: payload.data as T }
}

async function loadSnapshot(): Promise<MoneyResult<MoneySnapshot>> {
  const snapshot = await send<MoneySnapshot>('/v1/legacy/snapshot')
  if (!snapshot.ok) {
    const cachedData = getMoneyCache()
    return cachedData ? { ...snapshot, cachedData } : snapshot
  }
  const next = await send<LegacyRevisions>('/v1/legacy/revisions')
  revisions = next.ok ? next.data : EMPTY_REVISIONS
  setMoneyCache(snapshot.data)
  return snapshot
}

/**
 * One command per user action, with the revision this desktop last saw. A stale revision comes
 * back as a conflict instead of quietly overwriting the phone's edit.
 */
async function apply(
  entityId: string, expectedRevision: number | null, command: SyncCommand
): Promise<MoneyResult<MoneySnapshot>> {
  const operation: SyncOperation = {
    operationId: randomUUID(),
    entityId,
    expectedRevision,
    createdAt: new Date().toISOString(),
    command
  }
  const response = await send<OperationResponse>('/v1/operations', {
    method: 'POST',
    body: JSON.stringify({ operations: [operation] })
  })
  if (!response.ok) return response
  const failed = response.data.failed
  if (failed) {
    return {
      ok: false,
      code: failed.error.code === 'CONFLICT' ? 'CONFLICT' : failed.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST',
      message: failed.error.message
    }
  }
  return loadSnapshot()
}

const invalid = (message: string): MoneyResult<MoneySnapshot> =>
  ({ ok: false, code: 'INVALID_REQUEST', message })

const revisionOf = (table: keyof LegacyRevisions, id: string): number | null =>
  revisions[table][id] ?? null

const missing = (label: string): MoneyResult<MoneySnapshot> =>
  ({ ok: false, code: 'NOT_FOUND', message: `${label} was not found. Refresh and try again.` })

export const ledgerMoney = {
  async testConnection(): Promise<MoneyResult<{ connected: true }>> {
    const result = await send<{ accounts: unknown[] }>('/v1/reference')
    return result.ok ? { ok: true, data: { connected: true } } : result
  },

  getSnapshot: loadSnapshot,

  async createAccount(input: AccountInput) {
    if (!isAccountInput(input)) return invalid('Check the account fields')
    return apply(randomUUID(), null, { entity: 'account', type: 'create', payload: input })
  },

  async updateAccount(id: string, input: AccountInput) {
    if (!isAccountInput(input)) return invalid('Check the account fields')
    const revision = revisionOf('accounts', id)
    if (revision === null) return missing('Account')
    return apply(id, revision, { entity: 'account', type: 'update', payload: input })
  },

  async archiveAccount(id: string, input: ArchiveInput) {
    const revision = revisionOf('accounts', id)
    if (revision === null) return missing('Account')
    return apply(id, revision, { entity: 'account', type: 'archive', payload: input })
  },

  async createCategory(input: CategoryInput) {
    if (!isCategoryInput(input)) return invalid('Check the category fields')
    return apply(randomUUID(), null, { entity: 'category', type: 'create', payload: input })
  },

  async updateCategory(id: string, input: CategoryInput) {
    if (!isCategoryInput(input)) return invalid('Check the category fields')
    const revision = revisionOf('categories', id)
    if (revision === null) return missing('Category')
    return apply(id, revision, { entity: 'category', type: 'update', payload: input })
  },

  async archiveCategory(id: string, input: ArchiveInput) {
    const revision = revisionOf('categories', id)
    if (revision === null) return missing('Category')
    return apply(id, revision, { entity: 'category', type: 'archive', payload: input })
  },

  async createTransaction(input: TransactionInput) {
    if (!isTransactionInput(input)) return invalid('Check the transaction fields')
    return apply(randomUUID(), null, { entity: 'transaction', type: 'create', payload: input })
  },

  async updateTransaction(id: string, input: TransactionInput) {
    if (!isTransactionInput(input)) return invalid('Check the transaction fields')
    const revision = revisionOf('transactions', id)
    if (revision === null) return missing('Transaction')
    return apply(id, revision, { entity: 'transaction', type: 'update', payload: input })
  },

  async deleteTransaction(id: string) {
    const revision = revisionOf('transactions', id)
    if (revision === null) return missing('Transaction')
    return apply(id, revision, { entity: 'transaction', type: 'delete' })
  },

  async saveBudget(input: BudgetInput) {
    if (!isBudgetInput(input)) return invalid('Check the budget amounts')
    return apply(input.month, revisionOf('budgets', input.month), { entity: 'budget', type: 'save', payload: input })
  },

  async deleteBudget(month: string) {
    const revision = revisionOf('budgets', month)
    if (revision === null) return missing('Budget')
    return apply(month, revision, { entity: 'budget', type: 'delete' })
  },

  async createPurchase(input: PurchaseInput) {
    if (!isPurchaseInput(input)) return invalid('Check the purchase fields')
    return apply(randomUUID(), null, { entity: 'purchase', type: 'create', payload: input })
  },

  async updatePurchase(id: string, input: PurchaseInput) {
    if (!isPurchaseInput(input)) return invalid('Check the purchase fields')
    const revision = revisionOf('purchases', id)
    if (revision === null) return missing('Purchase')
    return apply(id, revision, { entity: 'purchase', type: 'update', payload: input })
  },

  async deletePurchase(id: string) {
    const revision = revisionOf('purchases', id)
    if (revision === null) return missing('Purchase')
    return apply(id, revision, { entity: 'purchase', type: 'delete' })
  }
}
