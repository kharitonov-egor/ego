import type {
  AccountBalances, ApiError, ApiResult, ChangePage, FeedCursor, OperationResponse, ReceiptDetail,
  ReferenceData, SyncOperation, TransactionFilters, TransactionPage
} from '@ego/api-contracts'
import { encodeCursor } from '@ego/api-contracts'

export interface MoneyApi {
  reference: () => Promise<ApiResult<ReferenceData>>
  transactions: (
    filters: TransactionFilters, cursor: FeedCursor | null, limit: number
  ) => Promise<ApiResult<TransactionPage>>
  receipt: (purchaseId: string) => Promise<ApiResult<ReceiptDetail>>
  balances: () => Promise<ApiResult<AccountBalances>>
  changes: (after: number, limit: number) => Promise<ApiResult<ChangePage>>
  operations: (operations: SyncOperation[]) => Promise<ApiResult<OperationResponse>>
}

export interface ApiConfig {
  url: string
  token: string
}

const REQUEST_TIMEOUT_MS = 15000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorFrom(value: unknown, status: number): ApiError {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string' &&
    typeof value.error.message === 'string') {
    return value.error as unknown as ApiError
  }
  if (status === 401 || status === 403) return { code: 'AUTH_REQUIRED', message: 'Connect this device again' }
  return { code: 'SERVER_ERROR', message: `The server answered with HTTP ${status}` }
}

export function filterQuery(filters: TransactionFilters, cursor: FeedCursor | null, limit: number): string {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.accountIds.length > 0) params.set('accounts', filters.accountIds.join(','))
  if (filters.categoryIds.length > 0) params.set('categories', filters.categoryIds.join(','))
  if (filters.kinds.length > 0) params.set('kinds', filters.kinds.join(','))
  if (filters.search) params.set('search', filters.search)
  params.set('limit', String(limit))
  if (cursor) params.set('cursor', encodeCursor(cursor, filters))
  return params.toString()
}

export function isMoneyApiConfigured(config: ApiConfig): boolean {
  return Boolean(config.url.trim() && config.token.trim())
}

export function moneyApiFor(config: ApiConfig): MoneyApi {
  const base = config.url.trim().replace(/\/+$/, '')

  const send = async <T>(path: string, init?: RequestInit): Promise<ApiResult<T>> => {
    if (!isMoneyApiConfigured(config)) {
      return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Add the API address and device token in Settings' } }
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...init?.headers,
          authorization: `Bearer ${config.token.trim()}`,
          'content-type': 'application/json'
        }
      })
    } catch {
      return { ok: false, error: { code: 'OFFLINE', message: 'The ledger service is unreachable' } }
    } finally {
      clearTimeout(timeout)
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { ok: false, error: { code: 'SERVER_ERROR', message: 'The server answered with something unreadable' } }
    }
    if (!response.ok || !isRecord(payload) || payload.ok !== true) {
      return { ok: false, error: errorFrom(payload, response.status) }
    }
    return { ok: true, data: payload.data as T }
  }

  return {
    reference: () => send<ReferenceData>('/v1/reference'),
    transactions: (filters, cursor, limit) =>
      send<TransactionPage>(`/v1/transactions?${filterQuery(filters, cursor, limit)}`),
    receipt: (purchaseId) => send<ReceiptDetail>(`/v1/receipts/${encodeURIComponent(purchaseId)}`),
    balances: () => send<AccountBalances>('/v1/balances'),
    changes: (after, limit) => send<ChangePage>(`/v1/changes?after=${after}&limit=${limit}`),
    operations: (operations) => send<OperationResponse>('/v1/operations', {
      method: 'POST',
      body: JSON.stringify({ operations })
    })
  }
}
