import {
  API_VERSION, HTTP_STATUS, MAX_CHANGE_PAGE_SIZE, decodeCursor, invalid, isOperationRequest,
  parseTransactionFilters,
  type ApiError, type ApiResult, type FeedCursor
} from '@ego/api-contracts'
import { isDateString } from '@ego/core'
import { authorize, touchDevice, type Env } from './auth'
import { applyOperations } from './commands'
import {
  pageSizeFrom, readBalances, readBootstrap, readChanges, readLegacySnapshot, readReceiptDetail,
  readReference, readLegacyRevisions, readSummary, readTransactionDetail, readTransactionPage
} from './reads'
import { createLiveSession } from './live'
import {
  completeGoogleConnector,
  completeWisprConnector,
  connectorStatus,
  disconnectConnector,
  startGoogleConnector,
  startWisprConnector
} from './connectors'
import { auditLocalLiveTool, executeLiveTool } from './live-tools'
import { completeSignIn, exchangeSignIn, readSession, signOut, startSignIn } from './sign-in'
import { trelloAddAttachment, trelloBoards, trelloCreateCard, trelloLists } from './services'
import { assistantRoute } from './assistant'
import { markStudyAssignment, readStudyAssignments } from './study'
import { completeHealthConnect, disconnectHealth, readHealth, startHealthConnect, syncHealthRequest } from './health'
import { mediaRoute } from './diary'
import { foodRoute } from './food'
import { readAppBuilds, receiveBuildWebhook } from './app-builds'

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

/** `work` keeps a streamed answer's writes running if the phone hangs up partway. Tests leave it out. */
export async function handle(request: Request, env: Env, work?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')
  if (path === '/v1/health') return ok({ version: API_VERSION })
  if (request.method === 'POST' && path === '/v1/auth/google/start') return startSignIn(request, env)
  if (request.method === 'POST' && path === '/v1/auth/exchange') return exchangeSignIn(request, env)
  if (request.method === 'GET' && path === '/v1/connectors/google/callback') {
    return await completeSignIn(request, env) ?? await completeHealthConnect(request, env) ??
      completeGoogleConnector(request, env)
  }
  if (request.method === 'GET' && path === '/v1/connectors/wispr/callback') {
    return completeWisprConnector(request, env)
  }
  if (request.method === 'POST' && path === '/v1/app/builds/webhook') return respond(await receiveBuildWebhook(request, env))

  const device = await authorize(request, env.DB)
  if (!device.ok) return failure(device.error)
  const now = new Date().toISOString()
  void touchDevice(env.DB, device.data.deviceId, now).catch(() => undefined)

  if (path === '/v1/session') {
    if (request.method === 'GET') return ok(await readSession(env, device.data))
    if (request.method === 'DELETE') {
      await signOut(env, device.data, now)
      return ok({ signedOut: true })
    }
  }
  const assistant = assistantRoute(request, env, device.data, path, now, work)
  if (assistant) return assistant
  if (request.method === 'GET' && path === '/v1/trello/boards') return trelloBoards(env)
  if (request.method === 'GET' && path.startsWith('/v1/trello/boards/') && path.endsWith('/lists')) {
    return trelloLists(env, decodeURIComponent(path.slice('/v1/trello/boards/'.length, -'/lists'.length)))
  }
  if (request.method === 'POST' && path === '/v1/trello/cards') return trelloCreateCard(request, env)
  if (request.method === 'POST' && path.startsWith('/v1/trello/cards/') && path.endsWith('/attachments')) {
    return trelloAddAttachment(request, env, decodeURIComponent(path.slice('/v1/trello/cards/'.length, -'/attachments'.length)))
  }
  if (request.method === 'GET' && path === '/v1/study/assignments') return readStudyAssignments(env, device.data, now)
  if (request.method === 'GET' && path === '/v1/app/builds/latest') return ok(await readAppBuilds(env, now))
  if (request.method === 'PUT' && path.startsWith('/v1/study/assignments/')) {
    return markStudyAssignment(request, env, device.data, decodeURIComponent(path.slice('/v1/study/assignments/'.length)), now)
  }
  if (request.method === 'GET' && path === '/v1/health/data') return readHealth(request, env, device.data, new Date(now))
  if (request.method === 'POST' && path === '/v1/health/sync') return syncHealthRequest(request, env, device.data, new Date(now))
  if (request.method === 'POST' && path === '/v1/health/connect') return startHealthConnect(request, env, device.data)
  if (request.method === 'DELETE' && path === '/v1/health/connection') {
    await disconnectHealth(env, device.data.datasetId)
    return ok({ disconnected: true })
  }
  const media = mediaRoute(request, env, path, now)
  if (media) return media
  const food = foodRoute(request, env, path)
  if (food) return food
  if (request.method === 'POST' && path === '/v1/live/sessions') {
    return createLiveSession(request, env, device.data)
  }
  if (request.method === 'POST' && path === '/v1/live/tools/execute') {
    return executeLiveTool(request, env, device.data, now)
  }
  if (request.method === 'POST' && path === '/v1/live/tools/audit-local') {
    return auditLocalLiveTool(request, env, device.data, now)
  }
  if (request.method === 'POST' && path === '/v1/connectors/google/start') {
    return startGoogleConnector(request, env, device.data)
  }
  if (request.method === 'GET' && path === '/v1/connectors/google/status') {
    return ok(await connectorStatus(env, device.data.datasetId, 'google'))
  }
  if (request.method === 'DELETE' && path === '/v1/connectors/google') {
    await disconnectConnector(env, device.data.datasetId, 'google')
    return ok({ disconnected: true })
  }
  if (request.method === 'POST' && path === '/v1/connectors/wispr/start') {
    return startWisprConnector(request, env, device.data)
  }
  if (request.method === 'GET' && path === '/v1/connectors/wispr/status') {
    return ok(await connectorStatus(env, device.data.datasetId, 'wispr'))
  }
  if (request.method === 'DELETE' && path === '/v1/connectors/wispr') {
    await disconnectConnector(env, device.data.datasetId, 'wispr')
    return ok({ disconnected: true })
  }

  if (request.method === 'GET') {
    if (path === '/v1/reference') return ok(await readReference(env.DB))
    if (path === '/v1/bootstrap') return ok(await readBootstrap(env.DB))
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
