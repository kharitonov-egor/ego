import type {
  ContentKeyList, ContentKeyCreated, AccountBalances, ApiError, ApiErrorCode, ApiResult, AppBuildStatus, AssistantChatList, AssistantConfirmRequest,
  AssistantHistory, AssistantStreamEvent, AssistantTurnRequest, BootstrapData, CalendarConnectStart, CalendarCreateRequest,
  CalendarDeleteRequest, CalendarEventRef, CalendarListChange, CalendarRange, CalendarRestoreRequest, CalendarRsvpRequest, CalendarSeries,
  CalendarSnapshot, CalendarUpdateRequest, ChangePage, DeviceList, DiaryMediaInfo, DocketDetail, DocketKeyCreated, DocketKeyList,
  DocketList, DocketUpdate,
  DiaryMultipartPart, DiaryMultipartStart, FeedCursor, FoodAnalyzeRequest, FoodAnalyzeResponse, FoodProductResponse,
  MediaScope,
  HealthConnectStart, HealthSnapshot, OperationResponse, ReceiptDetail, ReferenceData,
  SessionInfo, SignInResult, SignInStartInput, SignInStartResult, StudyAssignmentList, StudyMark, SyncOperation,
  TransactionFilters, TransactionPage, TrelloCardRequest, TrelloCardResponse
} from '@ego/api-contracts'
import { encodeCursor } from '@ego/api-contracts'
import type { AnalyzedTransactionDraft, ImageAnalysisCategory, TrelloBoardSummary, TrelloListSummary } from '@ego/core'

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

export interface StudyApi {
  studyAssignments: () => Promise<ApiResult<StudyAssignmentList>>
  markStudyAssignment: (id: string, done: boolean) => Promise<ApiResult<StudyMark>>
}

export interface HealthApi {
  healthData: (since: string | null) => Promise<ApiResult<HealthSnapshot>>
  /** Asks the Worker to pull from Google Health first. It skips the pull if one just ran. */
  healthSync: (since: string | null, timeZone: string | null) => Promise<ApiResult<HealthSnapshot>>
  healthConnect: () => Promise<ApiResult<HealthConnectStart>>
  healthDisconnect: () => Promise<ApiResult<{ disconnected: true }>>
}

/** Google Calendar through the Worker. Every write answers with what changed since `since`. */
export interface CalendarApi {
  calendarData: (since: string | null, cursor: string | null) => Promise<ApiResult<CalendarSnapshot>>
  /** Asks the Worker to pull from Google first. It skips the pull if one just ran. */
  calendarSync: (since: string | null, cursor: string | null) => Promise<ApiResult<CalendarSnapshot>>
  /** `another` skips the hint for the signed-in account, so Google offers its account picker. */
  calendarConnect: (another: boolean) => Promise<ApiResult<CalendarConnectStart>>
  calendarDisconnect: (accountId: string) => Promise<ApiResult<{ disconnected: true }>>
  calendarCreate: (request: CalendarCreateRequest) => Promise<ApiResult<CalendarSnapshot>>
  calendarUpdate: (request: CalendarUpdateRequest) => Promise<ApiResult<CalendarSnapshot>>
  calendarDelete: (request: CalendarDeleteRequest) => Promise<ApiResult<CalendarSnapshot>>
  /** Undoes a delete. */
  calendarRestore: (request: CalendarRestoreRequest) => Promise<ApiResult<CalendarSnapshot>>
  calendarRsvp: (request: CalendarRsvpRequest) => Promise<ApiResult<CalendarSnapshot>>
  calendarList: (change: CalendarListChange) => Promise<ApiResult<CalendarSnapshot>>
  calendarSeries: (ref: CalendarEventRef) => Promise<ApiResult<CalendarSeries>>
  /** Days outside the window the Worker keeps, read live from Google. */
  calendarRange: (from: string, to: string) => Promise<ApiResult<CalendarRange>>
}

/**
 * Diary, Tasks, and Food files. Players and image loaders fetch them by URL with the device token
 * in a header; uploads stream straight from disk to these URLs. The scope defaults to the diary.
 */
export interface DiaryMediaApi {
  mediaUrl: (mediaId: string, scope?: MediaScope) => string
  mediaPartUrl: (mediaId: string, uploadId: string, partNumber: number, scope?: MediaScope) => string
  authHeaders: () => Record<string, string>
  mediaMultipartStart: (mediaId: string, contentType: string, scope?: MediaScope) => Promise<ApiResult<DiaryMultipartStart>>
  mediaMultipartComplete: (mediaId: string, uploadId: string, parts: DiaryMultipartPart[], scope?: MediaScope) => Promise<ApiResult<DiaryMediaInfo>>
}

export type AssistantEventHandler = (event: AssistantStreamEvent) => void

export interface StreamResponse {
  ok: boolean
  status: number
  body: ReadableStream<Uint8Array> | null
  text: () => Promise<string>
}

/**
 * A fetch whose response body can be read as it arrives. React Native's own fetch buffers the
 * whole body, so the app passes Expo's fetch here; tests and Node use the global one.
 */
export type StreamFetch = (
  url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<StreamResponse>

/** The AI chat. A turn and a confirmation stream their events as the Worker produces them. */
export interface AssistantApi {
  assistantChats: () => Promise<ApiResult<AssistantChatList>>
  assistantDeleteChat: (chatId: string) => Promise<ApiResult<{ deleted: true }>>
  assistantMessages: (chatId: string) => Promise<ApiResult<AssistantHistory>>
  assistantTurn: (request: AssistantTurnRequest, onEvent: AssistantEventHandler) => Promise<ApiResult<{ done: true }>>
  assistantConfirm: (request: AssistantConfirmRequest, onEvent: AssistantEventHandler) => Promise<ApiResult<{ done: true }>>
}

/** The Worker reads food photos with the model and looks barcodes up in USDA and Open Food Facts. */
export interface FoodApi {
  foodAnalyze: (request: FoodAnalyzeRequest) => Promise<ApiResult<FoodAnalyzeResponse>>
  foodProduct: (barcode: string) => Promise<ApiResult<FoodProductResponse>>
}

/** Pages the docket CLI uploaded. The CLI's keys are made and revoked here. */
export interface DocketApi {
  dockets: () => Promise<ApiResult<DocketList>>
  docket: (id: string) => Promise<ApiResult<DocketDetail>>
  updateDocket: (id: string, update: DocketUpdate) => Promise<ApiResult<DocketDetail>>
  deleteDocket: (id: string) => Promise<ApiResult<{ deleted: true }>>
  docketKeys: () => Promise<ApiResult<DocketKeyList>>
  createDocketKey: (name: string | null) => Promise<ApiResult<DocketKeyCreated>>
  revokeDocketKey: (keyId: string) => Promise<ApiResult<{ revoked: true }>>
}

export interface ReceiptImageRequest {
  base64: string
  mimeType: string
  categories: ImageAnalysisCategory[]
}

export interface ContentApi {
  contentKeys: () => Promise<ApiResult<ContentKeyList>>
  createContentKey: () => Promise<ApiResult<ContentKeyCreated>>
  revokeContentKey: (id: string) => Promise<ApiResult<{ revoked: true }>>
}
export interface EgoApi extends ContentApi, MoneyApi, StudyApi, HealthApi, CalendarApi, DiaryMediaApi, AssistantApi, FoodApi, DocketApi {
  session: () => Promise<ApiResult<SessionInfo>>
  signOut: () => Promise<ApiResult<{ signedOut: true }>>
  devices: () => Promise<ApiResult<DeviceList>>
  revokeDevice: (deviceId: string) => Promise<ApiResult<{ revoked: true }>>
  /** Reads a receipt photo with the Worker's OpenRouter key. */
  receiptImage: (request: ReceiptImageRequest) => Promise<ApiResult<AnalyzedTransactionDraft>>
  trelloBoards: () => Promise<ApiResult<TrelloBoardSummary[]>>
  trelloLists: (boardId: string) => Promise<ApiResult<TrelloListSummary[]>>
  trelloCard: (card: TrelloCardRequest) => Promise<ApiResult<TrelloCardResponse>>
  trelloAttachment: (cardId: string, file: AttachmentFile) => Promise<ApiResult<{ attached: true }>>
  appBuilds: () => Promise<ApiResult<AppBuildStatus>>
}

export interface ApiConfig {
  url: string
  token: string
}

const REQUEST_TIMEOUT_MS = 15000
const SLOW_REQUEST_TIMEOUT_MS = 90000
/** A turn can take several model calls. The Worker gives up before this. */
const STREAM_TIMEOUT_MS = 120000

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

/** Reads a response body the Worker wrote, for callers that fetch outside `send`, like a native upload. */
export function resultFrom<T>(status: number, body: string): ApiResult<T> {
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return { ok: false, error: errorFrom(null, status) }
  }
  if (status < 200 || status >= 300 || !isRecord(payload) || payload.ok !== true) {
    return { ok: false, error: errorFrom(payload, status) }
  }
  return { ok: true, data: payload.data as T }
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

function isStreamEvent(value: unknown): value is AssistantStreamEvent {
  return isRecord(value) && typeof value.type === 'string'
}

/** Reads the Worker's NDJSON answer line by line as it arrives. */
async function stream(
  streamFetch: StreamFetch, base: string, token: string, path: string, body: unknown, onEvent: AssistantEventHandler
): Promise<ApiResult<{ done: true }>> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS)
  const handleLine = (line: string): void => {
    if (!line.trim()) return
    let value: unknown
    try { value = JSON.parse(line) } catch { return }
    if (isStreamEvent(value)) onEvent(value)
  }
  try {
    let response: StreamResponse
    try {
      response = await streamFetch(`${base}${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
    } catch {
      return { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }
    }
    if (!response.ok) return resultFrom<{ done: true }>(response.status, await response.text())
    const reader = response.body?.getReader()
    if (!reader) {
      for (const line of (await response.text()).split('\n')) handleLine(line)
      return { ok: true, data: { done: true } }
    }
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
    handleLine(buffer)
    return { ok: true, data: { done: true } }
  } catch {
    return controller.signal.aborted
      ? { ok: false, error: { code: 'OFFLINE', message: 'The Ego server took too long to answer' } }
      : { ok: false, error: { code: 'OFFLINE', message: 'The connection dropped before the answer finished' } }
  } finally {
    clearTimeout(timeout)
  }
}

export function moneyApiFor(config: ApiConfig, options: { streamFetch?: StreamFetch } = {}): EgoApi {
  const base = normalizeApiUrl(config.url)
  const token = config.token.trim()
  const streamFetch: StreamFetch = options.streamFetch ?? ((url, init) => fetch(url, init))
  const call = <T>(path: string, options?: SendOptions): Promise<ApiResult<T>> => {
    if (!isMoneyApiConfigured(config)) {
      return Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in with Google on the start screen' } })
    }
    return send<T>(base, token, path, options)
  }

  const mediaPath = (mediaId: string, scope: MediaScope = 'diary'): string => `/v1/${scope}/media/${encodeURIComponent(mediaId)}`

  return {
    mediaUrl: (mediaId, scope) => `${base}${mediaPath(mediaId, scope)}`,
    mediaPartUrl: (mediaId, uploadId, partNumber, scope) =>
      `${base}${mediaPath(mediaId, scope)}/multipart/${encodeURIComponent(uploadId)}/${partNumber}`,
    authHeaders: (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {}),
    mediaMultipartStart: (mediaId, contentType, scope) => call<DiaryMultipartStart>(`${mediaPath(mediaId, scope)}/multipart`, {
      method: 'POST',
      body: JSON.stringify({ contentType })
    }),
    mediaMultipartComplete: (mediaId, uploadId, parts, scope) =>
      call<DiaryMediaInfo>(`${mediaPath(mediaId, scope)}/multipart/${encodeURIComponent(uploadId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ parts }),
        timeoutMs: SLOW_REQUEST_TIMEOUT_MS
      }),
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
    devices: () => call<DeviceList>('/v1/devices'),
    revokeDevice: (deviceId) => call<{ revoked: true }>(`/v1/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' }),
    receiptImage: (request) => call<AnalyzedTransactionDraft>('/v1/money/receipt-image', {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    assistantChats: () => call<AssistantChatList>('/v1/assistant/chats'),
    assistantDeleteChat: (chatId) => call<{ deleted: true }>(`/v1/assistant/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
    assistantMessages: (chatId) => call<AssistantHistory>(`/v1/assistant/messages?chat=${encodeURIComponent(chatId)}`),
    assistantTurn: (request, onEvent) => isMoneyApiConfigured(config)
      ? stream(streamFetch, base, token, '/v1/assistant/turns', request, onEvent)
      : Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in with Google on the start screen' } }),
    assistantConfirm: (request, onEvent) => isMoneyApiConfigured(config)
      ? stream(streamFetch, base, token, '/v1/assistant/confirm', request, onEvent)
      : Promise.resolve({ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in with Google on the start screen' } }),
    foodAnalyze: (request) => call<FoodAnalyzeResponse>('/v1/food/analyze', {
      method: 'POST',
      body: JSON.stringify(request),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    foodProduct: (barcode) => call<FoodProductResponse>(`/v1/food/products/${encodeURIComponent(barcode)}`),
    studyAssignments: () => call<StudyAssignmentList>('/v1/study/assignments'),
    markStudyAssignment: (id, done) => call<StudyMark>(`/v1/study/assignments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ done })
    }),
    healthData: (since) => call<HealthSnapshot>(`/v1/health/data${since ? `?since=${encodeURIComponent(since)}` : ''}`, {
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    healthSync: (since, timeZone) => call<HealthSnapshot>('/v1/health/sync', {
      method: 'POST',
      body: JSON.stringify({ since, timeZone }),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    healthConnect: () => call<HealthConnectStart>('/v1/health/connect', { method: 'POST' }),
    healthDisconnect: () => call<{ disconnected: true }>('/v1/health/connection', { method: 'DELETE' }),
    calendarData: (since, cursor) => {
      const params = new URLSearchParams()
      if (since) params.set('since', since)
      if (cursor) params.set('cursor', cursor)
      const query = params.toString()
      return call<CalendarSnapshot>(`/v1/calendar/data${query ? `?${query}` : ''}`, { timeoutMs: SLOW_REQUEST_TIMEOUT_MS })
    },
    calendarSync: (since, cursor) => call<CalendarSnapshot>('/v1/calendar/sync', {
      method: 'POST',
      body: JSON.stringify({ since, cursor }),
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    calendarConnect: (another) => call<CalendarConnectStart>('/v1/calendar/connect', { method: 'POST', body: JSON.stringify({ another }) }),
    calendarDisconnect: (accountId) => call<{ disconnected: true }>('/v1/calendar/disconnect', {
      method: 'POST',
      body: JSON.stringify({ accountId })
    }),
    calendarCreate: (request) => call<CalendarSnapshot>('/v1/calendar/events', {
      method: 'POST', body: JSON.stringify(request), timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    calendarUpdate: (request) => call<CalendarSnapshot>('/v1/calendar/events', {
      method: 'PATCH', body: JSON.stringify(request), timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    calendarDelete: (request) => call<CalendarSnapshot>('/v1/calendar/events/delete', {
      method: 'POST', body: JSON.stringify(request), timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    calendarRestore: (request) => call<CalendarSnapshot>('/v1/calendar/events/restore', {
      method: 'POST', body: JSON.stringify(request), timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    calendarRsvp: (request) => call<CalendarSnapshot>('/v1/calendar/rsvp', {
      method: 'POST', body: JSON.stringify(request), timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    calendarList: (change) => call<CalendarSnapshot>('/v1/calendar/lists', { method: 'PATCH', body: JSON.stringify(change) }),
    calendarSeries: (ref) => call<CalendarSeries>(`/v1/calendar/series?${new URLSearchParams({
      account: ref.accountId, calendar: ref.calendarId, event: ref.eventId
    })}`),
    calendarRange: (from, to) => call<CalendarRange>(`/v1/calendar/range?${new URLSearchParams({ from, to })}`, {
      timeoutMs: SLOW_REQUEST_TIMEOUT_MS
    }),
    appBuilds: () => call<AppBuildStatus>('/v1/app/builds/latest'),
    dockets: () => call<DocketList>('/v1/dockets'),
    docket: (id) => call<DocketDetail>(`/v1/dockets/${encodeURIComponent(id)}`),
    updateDocket: (id, update) => call<DocketDetail>(`/v1/dockets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(update)
    }),
    deleteDocket: (id) => call<{ deleted: true }>(`/v1/dockets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    contentKeys: () => call<ContentKeyList>('/v1/content/keys'),
    createContentKey: () => call<ContentKeyCreated>('/v1/content/keys', { method: 'POST' }),
    revokeContentKey: (id) => call<{ revoked: true }>(`/v1/content/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    docketKeys: () => call<DocketKeyList>('/v1/docket-keys'),
    createDocketKey: (name) => call<DocketKeyCreated>('/v1/docket-keys', {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {})
    }),
    revokeDocketKey: (keyId) => call<{ revoked: true }>(`/v1/docket-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }),
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

export function startSignIn(
  apiUrl: string, deviceName: string, web: Pick<SignInStartInput, 'returnUrl' | 'remember'> = {}
): Promise<ApiResult<SignInStartResult>> {
  const input: SignInStartInput = { deviceName, ...web }
  return send<SignInStartResult>(normalizeApiUrl(apiUrl), null, '/v1/auth/google/start', {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

export function exchangeSignIn(apiUrl: string, code: string, exchangeSecret: string): Promise<ApiResult<SignInResult>> {
  return send<SignInResult>(normalizeApiUrl(apiUrl), null, '/v1/auth/exchange', {
    method: 'POST',
    body: JSON.stringify({ code, exchangeSecret })
  })
}
