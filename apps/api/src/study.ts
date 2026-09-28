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

async function fetchFeed(url: string): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'text/calendar' }, signal: AbortSignal.timeout(CANVAS_TIMEOUT_MS) })
  } catch {
    return { ok: false, response: failure(502, 'UPSTREAM_ERROR', 'Canvas did not answer') }
  }
  if (!response.ok) {
    return { ok: false, response: failure(502, 'UPSTREAM_ERROR', `Canvas answered with HTTP ${response.status}`) }
  }
  const text = await response.text()
  if (!isCalendarText(text)) {
    return { ok: false, response: failure(502, 'UPSTREAM_ERROR', 'Canvas sent something other than a calendar. The feed link may have been reset.') }
  }
  return { ok: true, text }
}

/** The feed link is a secret: anyone holding it can read the calendar, so it stays on the Worker. */
export async function readStudyAssignments(env: Env, device: DeviceIdentity, now: string): Promise<Response> {
  const url = env.CANVAS_CALENDAR_URL?.trim()
  if (!url) return failure(503, 'NOT_CONFIGURED', 'The Canvas calendar is not set up on the server')
  const feed = await fetchFeed(url)
  if (!feed.ok) return feed.response
  const marks = await env.DB.prepare('SELECT assignment_id, completed_at FROM study_completions WHERE dataset_id = ?')
    .bind(device.datasetId)
    .all<{ assignment_id: string; completed_at: string }>()
  const doneAt = new Map((marks.results ?? []).map((row) => [row.assignment_id, row.completed_at]))
  const assignments: StudyAssignment[] = parseCanvasCalendar(feed.text)
    .map((item) => ({ ...item, doneAt: doneAt.get(item.id) ?? null }))
  const data: StudyAssignmentList = { assignments, fetchedAt: now }
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
