import type {
  AccountBalances, ApiResult, ChangePage, ChangeRecord, FeedTransaction, OperationOutcome,
  OperationResponse, ReceiptDetail, ReferenceData, SyncOperation, TransactionPage
} from '@ego/api-contracts'
import type { MoneyApi } from '../lib/api-client'

export interface FakeApiScript {
  reference?: Array<ApiResult<ReferenceData>>
  transactions?: Array<ApiResult<TransactionPage>>
  changes?: Array<ApiResult<ChangePage>>
  operations?: Array<ApiResult<OperationResponse>>
}

export interface FakeApi extends MoneyApi {
  sentOperations: SyncOperation[][]
}

const emptyPage: TransactionPage = {
  items: [], nextCursor: null, hasMore: false, totalCount: 0, queryIdentity: 'empty'
}

function next<T>(queue: Array<ApiResult<T>> | undefined, fallback: ApiResult<T>): ApiResult<T> {
  if (!queue || queue.length === 0) return fallback
  return queue.length === 1 ? queue[0] : (queue.shift() as ApiResult<T>)
}

export function fakeApi(script: FakeApiScript = {}): FakeApi {
  const sentOperations: SyncOperation[][] = []
  return {
    sentOperations,
    reference: async () => next(script.reference, {
      ok: true, data: { accounts: [], categories: [], serverSequence: 0 }
    }),
    transactions: async () => next(script.transactions, { ok: true, data: emptyPage }),
    receipt: async (): Promise<ApiResult<ReceiptDetail>> =>
      ({ ok: false, error: { code: 'NOT_FOUND', message: 'No receipt' } }),
    balances: async (): Promise<ApiResult<AccountBalances>> =>
      ({ ok: true, data: { balances: [], serverSequence: 0 } }),
    changes: async () => next(script.changes, {
      ok: true, data: { changes: [], cursor: 0, hasMore: false }
    }),
    operations: async (operations) => {
      sentOperations.push(operations)
      return next(script.operations, {
        ok: true,
        data: {
          results: operations.map((operation): OperationOutcome => ({
            operationId: operation.operationId,
            status: 'applied',
            entity: operation.command.entity,
            entityId: operation.entityId,
            revision: (operation.expectedRevision ?? 0) + 1,
            serverSequence: 1
          })),
          failed: null,
          serverSequence: 1
        }
      })
    }
  }
}

export function feedRow(overrides: Partial<FeedTransaction> = {}): FeedTransaction {
  return {
    id: 'tx-1', kind: 'expense', accountId: 'acc-check', destinationAccountId: null,
    categoryId: 'cat-food', amountCents: 4220, date: '2026-09-12', notes: 'Groceries',
    createdAt: '2026-09-12T09:00:00.000Z', updatedAt: '2026-09-12T09:00:00.000Z', revision: 1,
    accountName: 'Checking', destinationAccountName: null, categoryName: 'Food',
    categoryIcon: 'cart', categoryColor: 'orange', merchant: null, purchaseId: null,
    hasReceipt: false, ...overrides
  }
}

type TransactionChange = Extract<ChangeRecord, { entity: 'transaction' }>

export function transactionChange(overrides: Partial<TransactionChange> = {}): TransactionChange {
  const base: TransactionChange = {
    seq: 1, entityId: 'tx-1', action: 'upsert', revision: 1, committedAt: '2026-09-12T10:00:00.000Z',
    entity: 'transaction',
    record: {
      id: 'tx-1', kind: 'expense', accountId: 'acc-check', destinationAccountId: null,
      categoryId: 'cat-food', amountCents: 4220, date: '2026-09-12', notes: 'Groceries',
      createdAt: '2026-09-12T09:00:00.000Z', updatedAt: '2026-09-12T09:00:00.000Z', revision: 1
    }
  }
  return { ...base, ...overrides }
}
