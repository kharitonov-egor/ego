import { HTTP_STATUS, type ApiErrorCode } from '@ego/api-contracts'
import {
  TASK_CARD_LABEL_LIMIT, TASK_DESCRIPTION_LIMIT, TASK_TITLE_LIMIT, defaultTaskReminder, isDateString, isTaskCardInput,
  isTaskTime, taskActivityFor, type TaskCardInput
} from '@ego/core'
import { bearer, hashToken, type Env } from './auth'
import { applyOperation } from './commands'
import { isValidTimeZone, localClock } from './google-health'
import { query } from './reads'

const POSITION_STEP = 1024
const MAX_BODY_BYTES = 40000
const DEFAULT_TIME_ZONE = 'America/New_York'
const EXTERNAL_ID = /^[A-Za-z0-9_-]{1,48}$/
const LOCAL_DUE = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/
const ZONED_DUE = /(?:Z|[+-]\d{2}:?\d{2})$/i

export interface InboxCardRequest {
  title: string
  description: string
  dueDate: string | null
  dueTime: string | null
  labels: string[]
  externalId: string | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function fail(code: ApiErrorCode, message: string): Response {
  return json({ ok: false, error: { code, message } }, HTTP_STATUS[code])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function parseDue(raw: string, timeZone: string): { dueDate: string; dueTime: string | null } | null {
  const value = raw.trim()
  if (ZONED_DUE.test(value)) {
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return null
    const { date, minute } = localClock(ms, timeZone)
    return { dueDate: date, dueTime: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` }
  }
  const match = LOCAL_DUE.exec(value)
  if (!match || !isDateString(match[1])) return null
  const dueTime = match[2] ?? null
  if (dueTime !== null && !isTaskTime(dueTime)) return null
  return { dueDate: match[1], dueTime }
}

/**
 * Reads the body n8n sends. `name` and `desc` are Trello's own field names, so a node built for
 * Trello's API needs only a new URL and header. A due date with a zone is read on `timeZone`'s
 * clock; one without is taken as the local date and time it already is.
 */
export function parseInboxRequest(body: unknown): InboxCardRequest | string {
  if (!isRecord(body)) return 'Send a JSON object with a title'
  const title = (text(body.title) ?? text(body.name) ?? '').trim()
  if (!title) return 'Send a title'
  if (title.length > TASK_TITLE_LIMIT) return `Keep the title under ${TASK_TITLE_LIMIT} characters`
  const description = text(body.description) ?? text(body.desc) ?? ''
  if (description.length > TASK_DESCRIPTION_LIMIT) return `Keep the description under ${TASK_DESCRIPTION_LIMIT} characters`
  const timeZone = typeof body.timeZone === 'string' && isValidTimeZone(body.timeZone) ? body.timeZone : DEFAULT_TIME_ZONE
  const rawDue = text(body.due)
  let due: { dueDate: string; dueTime: string | null } | null = null
  if (rawDue !== null && rawDue.trim() !== '') {
    due = parseDue(rawDue, timeZone)
    if (!due) return 'Send due as 2026-10-12, 2026-10-12T17:00, or a full ISO time'
  }
  const rawLabels = typeof body.labels === 'string' ? body.labels.split(',') : Array.isArray(body.labels) ? body.labels : []
  const labels = [...new Set(rawLabels.map(text).filter((name): name is string => name !== null).map((name) => name.trim()).filter(Boolean))]
  const externalId = text(body.id)?.trim() ?? null
  if (externalId !== null && externalId !== '' && !EXTERNAL_ID.test(externalId)) {
    return 'An id may use letters, digits, - and _ and be up to 48 characters'
  }
  return { title, description, dueDate: due?.dueDate ?? null, dueTime: due?.dueTime ?? null, labels, externalId: externalId || null }
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  const expected = env.TASKS_INBOX_TOKEN?.trim()
  const token = bearer(request)
  if (!expected || !token) return false
  const [left, right] = await Promise.all([hashToken(token), hashToken(expected)])
  return left === right
}

interface InboxRow {
  list_id: string
  list_name: string
  board_id: string
  board_name: string
}

/** The first live Inbox list under a live board, in board order. */
export async function findInbox(db: D1Database): Promise<InboxRow | null> {
  const rows = await query<InboxRow>(db, `SELECT l.id AS list_id, l.name AS list_name, b.id AS board_id, b.name AS board_name
    FROM task_lists l JOIN task_boards b ON b.id = l.board_id AND b.deleted_at IS NULL AND b.archived_at IS NULL
    WHERE l.kind = 'inbox' AND l.deleted_at IS NULL AND l.archived_at IS NULL
    ORDER BY b.position, b.created_at, l.position LIMIT 1`, [])
  return rows[0] ?? null
}

function cardId(externalId: string | null): string {
  return externalId ? `inbox-${externalId}` : `inbox-${crypto.randomUUID()}`
}

/** POST /v1/tasks/inbox: one card at the bottom of the Inbox, for n8n and anything else holding the inbox token. */
export async function inboxRoute(request: Request, env: Env, now: string): Promise<Response> {
  if (!env.TASKS_INBOX_TOKEN?.trim()) return fail('NOT_CONFIGURED', 'The inbox token is not set on the server')
  if (!await authorized(request, env)) return fail('AUTH_REQUIRED', 'Send Authorization: Bearer with the inbox token')
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return fail('INVALID_REQUEST', 'That card is too large')
  let body: unknown
  try { body = JSON.parse(raw) } catch { return fail('INVALID_REQUEST', 'The body is not valid JSON') }
  const parsed = parseInboxRequest(body)
  if (typeof parsed === 'string') return fail('INVALID_REQUEST', parsed)

  const id = cardId(parsed.externalId)
  const inbox = await findInbox(env.DB)
  if (!inbox) return fail('NOT_FOUND', 'No board has an Inbox list')
  if (parsed.externalId) {
    const seen = await query<{ id: string }>(env.DB, 'SELECT id FROM task_cards WHERE id = ?', [id])
    if (seen.length > 0) {
      return json({ ok: true, data: { id, duplicate: true, board: inbox.board_name, list: inbox.list_name, unknownLabels: [] } })
    }
  }
  const [ends, labelRows] = await Promise.all([
    query<{ position: number | null }>(env.DB,
      'SELECT MAX(position) AS position FROM task_cards WHERE list_id = ? AND deleted_at IS NULL AND archived_at IS NULL', [inbox.list_id]),
    query<{ id: string; name: string }>(env.DB,
      'SELECT id, name FROM task_labels WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, created_at', [inbox.board_id])
  ])
  const wanted = new Set(parsed.labels.map((name) => name.toLowerCase()))
  const labelIds = labelRows.filter((label) => label.name && wanted.has(label.name.toLowerCase())).map((label) => label.id)
    .slice(0, TASK_CARD_LABEL_LIMIT)
  const matched = new Set(labelRows.filter((label) => labelIds.includes(label.id)).map((label) => label.name.toLowerCase()))
  const last = ends[0]?.position
  const draft: TaskCardInput = {
    boardId: inbox.board_id,
    listId: inbox.list_id,
    title: parsed.title,
    description: parsed.description,
    position: typeof last === 'number' ? last + POSITION_STEP : POSITION_STEP,
    labelIds,
    priority: 'none',
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    reminderMinutes: parsed.dueDate ? defaultTaskReminder(parsed.dueTime) : null,
    doneAt: null,
    archivedAt: null,
    checklists: [],
    attachments: [],
    activity: []
  }
  const names = {
    list: (id: string) => id === inbox.list_id ? inbox.list_name : null,
    label: (id: string) => labelRows.find((label) => label.id === id)?.name || null,
    board: (id: string) => id === inbox.board_id ? inbox.board_name : null
  }
  const input: TaskCardInput = { ...draft, activity: taskActivityFor(null, draft, names, now) }
  if (!isTaskCardInput(input)) return fail('INVALID_REQUEST', 'That card is not valid')
  const result = await applyOperation(env.DB, {
    operationId: id, entityId: id, expectedRevision: null, createdAt: now,
    command: { entity: 'taskCard', type: 'create', payload: input }
  }, now)
  if (!result.ok) return json(result, HTTP_STATUS[result.error.code])
  return json({
    ok: true,
    data: {
      id,
      duplicate: result.data.status === 'duplicate',
      board: inbox.board_name,
      list: inbox.list_name,
      unknownLabels: parsed.labels.filter((name) => !matched.has(name.toLowerCase()))
    }
  }, result.data.status === 'duplicate' ? 200 : 201)
}
