import {
  API_VERSION, HTTP_STATUS, MAX_CHANGE_PAGE_SIZE, decodeCursor, invalid, isOperationRequest,
  parseTransactionFilters,
  type ApiError, type ApiResult, type FeedCursor
} from '@ego/api-contracts'
import { isDateString } from '@ego/core'
import { authorize, touchDevice, type Env } from './auth'
import { applyOperations } from './commands'
import {
  pageSizeFrom, readBalances, readChanges, readLegacySnapshot, readReceiptDetail, readReference,
  readLegacyRevisions, readSummary, readTransactionDetail, readTransactionPage
} from './reads'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(error: ApiError): Response {
  return json({ ok: false, error }, HTTP_STATUS[error.code])
}

function respond<T>(result: ApiResult<T>): Response {
  return result.ok ? json({ ok: true, data: result.data }) : failure(result.error)
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

async function feedRequest(db: D1Database, url: URL): Promise<Response> {
  const filters = parseTransactionFilters(url.searchParams)
  if (!filters.ok) return failure(filters.error)
  const raw = url.searchParams.get('cursor')
  let cursor: FeedCursor | null = null
  if (raw) {
    const decoded = decodeCursor(raw, filters.data)
    if (!decoded.ok) return failure(decoded.error)
    cursor = decoded.data
  }
  return ok(await readTransactionPage(db, filters.data, cursor, pageSizeFrom(url.searchParams.get('limit'))))
}

function summaryRequest(db: D1Database, url: URL): Promise<Response> | Response {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if ((from && !isDateString(from)) || (to && !isDateString(to))) {
    return respond(invalid('from and to must be YYYY-MM-DD dates'))
  }
  if (from && to && from > to) return respond(invalid('from must not be after to'))
  return readSummary(db, from, to).then(ok)
}

function changesRequest(db: D1Database, url: URL): Promise<Response> | Response {
  const after = Number(url.searchParams.get('after') ?? '0')
  if (!Number.isSafeInteger(after) || after < 0) return respond(invalid('after must be a server sequence'))
  const limit = Number(url.searchParams.get('limit') ?? String(MAX_CHANGE_PAGE_SIZE))
  if (!Number.isSafeInteger(limit) || limit < 1) return respond(invalid('limit must be a positive whole number'))
  return readChanges(db, after, limit).then(ok)
}

async function operationsRequest(db: D1Database, request: Request, now: string): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return respond(invalid('The request body is not valid JSON'))
  }
  if (!isOperationRequest(body)) return respond(invalid('Check the operations in this request'))
  const response = await applyOperations(db, body.operations, now)
  return ok(response)
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')
  if (path === '/v1/health') return ok({ version: API_VERSION })

  const device = await authorize(request, env.DB)
  if (!device.ok) return failure(device.error)
  const now = new Date().toISOString()
  void touchDevice(env.DB, device.data.deviceId, now).catch(() => undefined)

  if (request.method === 'GET') {
    if (path === '/v1/reference') return ok(await readReference(env.DB))
    if (path === '/v1/transactions') return feedRequest(env.DB, url)
    if (path.startsWith('/v1/transactions/')) {
      return respond(await readTransactionDetail(env.DB, decodeURIComponent(path.slice('/v1/transactions/'.length))))
    }
    if (path.startsWith('/v1/receipts/')) {
      return respond(await readReceiptDetail(env.DB, decodeURIComponent(path.slice('/v1/receipts/'.length))))
    }
    if (path === '/v1/balances') return ok(await readBalances(env.DB))
    if (path === '/v1/summary') return summaryRequest(env.DB, url)
    if (path === '/v1/changes') return changesRequest(env.DB, url)
    if (path === '/v1/legacy/snapshot') return ok(await readLegacySnapshot(env.DB))
    if (path === '/v1/legacy/revisions') return ok(await readLegacyRevisions(env.DB))
  }
  if (request.method === 'POST' && path === '/v1/operations') {
    return operationsRequest(env.DB, request, now)
  }
  return failure({ code: 'NOT_FOUND', message: 'That endpoint does not exist' })
}
