import type {
  AccountBalances, ApiError, ApiErrorCode, ApiResult, BootstrapData, ChangePage, FeedCursor,
  MoneyAgentRequest, MoneyAgentResponse, OperationResponse, ReceiptDetail, ReferenceData,
  SessionInfo, SignInResult, SignInStartResult, SyncOperation, TransactionFilters,
  TransactionPage, TrelloCardRequest, TrelloCardResponse
} from '@ego/api-contracts'
import { encodeCursor } from '@ego/api-contracts'
import type { TrelloBoardSummary, TrelloListSummary } from '@ego/core'

export interface MoneyApi {
  reference: () => Promise<ApiResult<ReferenceData>>
  bootstrap: () => Promise<ApiResult<BootstrapData>>
  transactions: (
    filters: TransactionFilters, cursor: FeedCursor | null, limit: number
  ) => Promise<ApiResult<TransactionPage>>
  receipt: (purchaseId: string) => Promise<ApiResult<ReceiptDetail>>
  balances: () => Promise<ApiResult<AccountBalances>>
  changes: (after: number, limit: number) => Promise<ApiResult<ChangePage>>
  operations: (operations: SyncOperation[]) => Promise<ApiResult<OperationResponse>>
}

export interface AttachmentFile {
  uri: string
  name: string
  mimeType: string
}

export interface EgoApi extends MoneyApi {
  session: () => Promise<ApiResult<SessionInfo>>
  signOut: () => Promise<ApiResult<{ signedOut: true }>>
  moneyAgent: (request: MoneyAgentRequest) => Promise<ApiResult<MoneyAgentResponse>>
  trelloBoards: () => Promise<ApiResult<TrelloBoardSummary[]>>
  trelloLists: (boardId: string) => Promise<ApiResult<TrelloListSummary[]>>
  trelloCard: (card: TrelloCardRequest) => Promise<ApiResult<TrelloCardResponse>>
  trelloAttachment: (cardId: string, file: AttachmentFile) => Promise<ApiResult<{ attached: true }>>
}

export interface ApiConfig {
  url: string
  token: string
}

const REQUEST_TIMEOUT_MS = 15000
const SLOW_REQUEST_TIMEOUT_MS = 90000

const KNOWN_CODES: readonly ApiErrorCode[] = [
  'AUTH_REQUIRED', 'OFFLINE', 'INVALID_REQUEST', 'NOT_FOUND', 'CONFLICT', 'SERVER_ERROR',
  'NOT_CONFIGURED', 'RATE_LIMITED', 'UPSTREAM_ERROR'
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isKnownCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (KNOWN_CODES as readonly string[]).includes(value)
}

function errorFrom(value: unknown, status: number): ApiError {
  if (isRecord(value) && isRecord(value.error) && typeof value.error.message === 'string') {
    const code = value.error.code
    if (code === 'CONFLICT') return value.error as unknown as ApiError
    return { code: isKnownCode(code) ? code : 'SERVER_ERROR', message: value.error.message }
  }
  if (status === 401 || status === 403) return { code: 'AUTH_REQUIRED', message: 'Sign in again' }
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

export function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

export function isMoneyApiConfigured(config: ApiConfig): boolean {
  return Boolean(config.url.trim() && config.token.trim())
}

interface SendOptions extends RequestInit {
  timeoutMs?: number
  authorized?: boolean
}

/** The timer covers reading the body too, so a stalled response cannot hang a save. */
async function send<T>(base: string, token: string | null, path: string, options: SendOptions = {}): Promise<ApiResult<T>> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, headers, ...init } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
  try {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(isForm ? {} : { 'content-type': 'application/json' })
        }
      })
    } catch {
      return { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return controller.signal.aborted
        ? { ok: false, error: { code: 'OFFLINE', message: 'The Ego server took too long to answer' } }
        : { ok: false, error: { code: 'SERVER_ERROR', message: 'The server answered with something unreadable' } }
    }
    if (!response.ok || !isRecord(payload) || payload.ok !== true) {
      return { ok: false, error: errorFrom(payload, response.status) }
    }
    return { ok: true, data: payload.data as T }
  } finally {
    clearTimeout(timeout)
  }
}

export function moneyApiFor(config: ApiConfig): EgoApi {
  const base = normalizeApiUrl(config.url)
  const token = config.token.trim()
  const call = <T>(path: string, options?: SendOptions): Promise<ApiResult<T>> => {
    if (!isMoneyApiConfigured(config)) {
      return Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in with Google on the start screen' } })
    }
    return send<T>(base, token, path, options)
  }

  return {
    reference: () => call<ReferenceData>('/v1/reference'),
    bootstrap: () => call<BootstrapData>('/v1/bootstrap', { timeoutMs: SLOW_REQUEST_TIMEOUT_MS }),
    transactions: (filters, cursor, limit) =>
      call<TransactionPage>(`/v1/transactions?${filterQuery(filters, cursor, limit)}`),
    receipt: (purchaseId) => call<ReceiptDetail>(`/v1/receipts/${encodeURIComponent(purchaseId)}`),
    balances: () => call<AccountBalances>('/v1/balances'),
    changes: (after, limit) => call<ChangePage>(`/v1/changes?after=${after}&limit=${limit}`),
    operations: (operations) => call<OperationResponse>('/v1/operations', {
      method: 'POST',
      body: JSON.stringify({ operations })
    }),
    session: () => call<SessionInfo>('/v1/session'),
    signOut: () => call<{ signedOut: true }>('/v1/session', { method: 'DELETE' }),
    moneyAgent: (request) => call<MoneyAgentResponse>('/v1/agent/money', {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    trelloBoards: () => call<TrelloBoardSummary[]>('/v1/trello/boards'),
    trelloLists: (boardId) => call<TrelloListSummary[]>(`/v1/trello/boards/${encodeURIComponent(boardId)}/lists`),
    trelloCard: (card) => call<TrelloCardResponse>('/v1/trello/cards', {
      method: 'POST',
      body: JSON.stringify(card)
    }),
    trelloAttachment: (cardId, file) => {
      const form = new FormData()
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob)
      return call<{ attached: true }>(`/v1/trello/cards/${encodeURIComponent(cardId)}/attachments`, {
        method: 'POST',
        body: form,
        timeoutMs: SLOW_REQUEST_TIMEOUT_MS
      })
    }
  }
}

export function startSignIn(apiUrl: string, deviceName: string): Promise<ApiResult<SignInStartResult>> {
  return send<SignInStartResult>(normalizeApiUrl(apiUrl), null, '/v1/auth/google/start', {
    method: 'POST',
    body: JSON.stringify({ deviceName })
  })
}

export function exchangeSignIn(apiUrl: string, code: string, exchangeSecret: string): Promise<ApiResult<SignInResult>> {
  return send<SignInResult>(normalizeApiUrl(apiUrl), null, '/v1/auth/exchange', {
    method: 'POST',
    body: JSON.stringify({ code, exchangeSecret })
  })
}
