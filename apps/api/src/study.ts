import {
  MAX_STUDY_ID_LENGTH,
  type DeviceIdentity,
  type StudyAssignment,
  type StudyAssignmentList,
  type StudyMark
} from '@ego/api-contracts'
import { isCalendarText, parseCanvasCalendar } from '@ego/core'
import type { Env } from './auth'

const CANVAS_TIMEOUT_MS = 10000
const FEED_CACHE_MS = 5 * 60 * 1000
/** Canvas answers 403 to a request with no User-Agent, and a Worker's fetch sends none. */
const USER_AGENT = 'Ego/1.0 (+https://github.com/kharitonov-egor/ego)'

type FeedAssignment = Omit<StudyAssignment, 'doneAt'>

interface FeedCache {
  url: string
  expiresAt: number
  fetchedAt: string
  assignments: FeedAssignment[]
  etag: string | null
  lastModified: string | null
}

const feedCaches = new WeakMap<Env, FeedCache>()
const feedRequests = new WeakMap<Env, Promise<{
  ok: true
  assignments: FeedAssignment[]
  fetchedAt: string
} | { ok: false; response: Response }>>()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status)
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssignmentId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_STUDY_ID_LENGTH && !/[\u0000-\u001f]/.test(value)
}

async function fetchFeed(
  url: string, previous: FeedCache | undefined, nowMs: number
): Promise<{ ok: true; cache: FeedCache } | { ok: false; response: Response }> {
  let response: Response
  try {
    const headers = new Headers({ accept: 'text/calendar', 'user-agent': USER_AGENT })
    if (previous?.etag) headers.set('if-none-match', previous.etag)
    if (previous?.lastModified) headers.set('if-modified-since', previous.lastModified)
    response = await fetch(url, { headers, signal: AbortSignal.timeout(CANVAS_TIMEOUT_MS) })
  } catch {
    return { ok: false, response: failure(502, 'UPSTREAM_ERROR', 'Canvas did not answer') }
  }
  if (response.status === 304 && previous) {
    return {
      ok: true,
      cache: { ...previous, expiresAt: nowMs + FEED_CACHE_MS, fetchedAt: new Date(nowMs).toISOString() }
    }
  }
  if (!response.ok) {
    return { ok: false, response: failure(502, 'UPSTREAM_ERROR', `Canvas answered with HTTP ${response.status}`) }
  }
  const text = await response.text()
  if (!isCalendarText(text)) {
    return { ok: false, response: failure(502, 'UPSTREAM_ERROR', 'Canvas sent something other than a calendar. The feed link may have been reset.') }
  }
  return {
    ok: true,
    cache: {
      url,
      expiresAt: nowMs + FEED_CACHE_MS,
      fetchedAt: new Date(nowMs).toISOString(),
      assignments: parseCanvasCalendar(text),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    }
  }
}

async function assignmentsFromFeed(
  env: Env, url: string, nowMs: number
): Promise<{ ok: true; assignments: FeedAssignment[]; fetchedAt: string } | { ok: false; response: Response }> {
  const stored = feedCaches.get(env)
  const cached = stored?.url === url ? stored : undefined
  if (cached && cached.expiresAt > nowMs) {
    return { ok: true, assignments: cached.assignments, fetchedAt: cached.fetchedAt }
  }
  const active = feedRequests.get(env)
  if (active) return active
  const request = fetchFeed(url, cached, nowMs).then((result) => {
    if (!result.ok) return result
    feedCaches.set(env, result.cache)
    return { ok: true as const, assignments: result.cache.assignments, fetchedAt: result.cache.fetchedAt }
  }).finally(() => feedRequests.delete(env))
  feedRequests.set(env, request)
  return request
}

/** The feed link is a secret: anyone holding it can read the calendar, so it stays on the Worker. */
export async function readStudyAssignments(env: Env, device: DeviceIdentity, now: string): Promise<Response> {
  const url = env.CANVAS_CALENDAR_URL?.trim()
  if (!url) return failure(503, 'NOT_CONFIGURED', 'The Canvas calendar is not set up on the server')
  const nowMs = Date.parse(now)
  const marksRequest = env.DB.prepare('SELECT assignment_id, completed_at FROM study_completions WHERE dataset_id = ?')
    .bind(device.datasetId)
    .all<{ assignment_id: string; completed_at: string }>()
  const [feed, marks] = await Promise.all([assignmentsFromFeed(env, url, Number.isFinite(nowMs) ? nowMs : Date.now()), marksRequest])
  if (!feed.ok) return feed.response
  const doneAt = new Map((marks.results ?? []).map((row) => [row.assignment_id, row.completed_at]))
  const assignments: StudyAssignment[] = feed.assignments
    .map((item) => ({ ...item, doneAt: doneAt.get(item.id) ?? null }))
  const data: StudyAssignmentList = { assignments, fetchedAt: feed.fetchedAt }
  return ok(data)
}

/** A repeated done mark keeps the first time, so a retried delivery does not move it. */
export async function markStudyAssignment(request: Request, env: Env, device: DeviceIdentity, id: string, now: string): Promise<Response> {
  if (!isAssignmentId(id)) return failure(400, 'INVALID_REQUEST', 'That assignment ID is not valid')
  let body: unknown
  try { body = await request.json() } catch { return failure(400, 'INVALID_REQUEST', 'The request body is not valid JSON') }
  if (!isRecord(body) || typeof body.done !== 'boolean') return failure(400, 'INVALID_REQUEST', 'Send done as true or false')
  if (!body.done) {
    await env.DB.prepare('DELETE FROM study_completions WHERE dataset_id = ? AND assignment_id = ?')
      .bind(device.datasetId, id).run()
    const cleared: StudyMark = { id, doneAt: null }
    return ok(cleared)
  }
  await env.DB.prepare(`INSERT INTO study_completions (dataset_id, assignment_id, completed_at) VALUES (?, ?, ?)
    ON CONFLICT(dataset_id, assignment_id) DO NOTHING`).bind(device.datasetId, id, now).run()
  const row = await env.DB.prepare('SELECT completed_at FROM study_completions WHERE dataset_id = ? AND assignment_id = ?')
    .bind(device.datasetId, id).first<{ completed_at: string }>()
  const marked: StudyMark = { id, doneAt: row?.completed_at ?? now }
  return ok(marked)
}
