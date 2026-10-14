import {
  HTTP_STATUS, TASK_AGENT_STATUSES, type ApiErrorCode, type TaskAgentRun, type TaskAgentStatus
} from '@ego/api-contracts'
import { bearer, hashToken, type Env } from './auth'
import { query } from './reads'
import { toTaskCardRecord, type TaskCardRow } from './rows'
import { webOrigins } from './web'

/** Jarvis is a two-core laptop on a spinning disk, so only this many runs build at once. */
export const AGENT_SLOTS = 2
/** A run that has not reported for this long is called failed, which frees its slot. */
export const AGENT_STALE_MS = 3 * 60 * 60 * 1000
const SEND_ATTEMPTS = 5
const SEND_TIMEOUT_MS = 15_000
const NOTE_LIMIT = 500
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/
const REPORTED: readonly TaskAgentStatus[] = ['working', 'asking', 'pr', 'failed']

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface RunRow {
  card_id: string
  status: TaskAgentStatus
  branch: string
  queued_at: string
  sent_at: string | null
  reported_at: string | null
  attempts: number
  pr_url: string | null
  note: string | null
  updated_at: string
}

interface CardPlace {
  list_name: string
  board_name: string
}

/** Open cards in live agent lists on live boards. */
const AGENT_CARDS = `SELECT c.id FROM task_cards c
  JOIN task_lists l ON l.id = c.list_id AND l.kind = 'agent' AND l.deleted_at IS NULL AND l.archived_at IS NULL
  JOIN task_boards b ON b.id = c.board_id AND b.deleted_at IS NULL AND b.archived_at IS NULL
  WHERE c.deleted_at IS NULL AND c.archived_at IS NULL`

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

function isTaskAgentStatus(value: unknown): value is TaskAgentStatus {
  return (TASK_AGENT_STATUSES as readonly unknown[]).includes(value)
}

export function toTaskAgentRun(row: RunRow): TaskAgentRun {
  return { cardId: row.card_id, status: row.status, branch: row.branch, prUrl: row.pr_url, note: row.note, updatedAt: row.updated_at }
}

/** A branch name T3 can make a worktree from. The time keeps a second run of the same card apart. */
export function agentBranch(title: string, queuedAt: string): string {
  const slug = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '')
  return `jarvis/${slug || 'card'}-${Date.parse(queuedAt).toString(36)}`
}

function cardLink(env: Env, id: string): string | null {
  const base = (env.DOCKET_BASE_URL?.trim() || [...webOrigins(env)][0] || '').replace(/\/+$/, '')
  return base ? `${base}/tasks/card/${encodeURIComponent(id)}` : null
}

async function sign(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function cardRow(db: D1Database, id: string): Promise<(TaskCardRow & CardPlace) | null> {
  const rows = await query<TaskCardRow & CardPlace>(db, `SELECT c.*, l.name AS list_name, b.name AS board_name
    FROM task_cards c JOIN task_lists l ON l.id = c.list_id JOIN task_boards b ON b.id = c.board_id
    WHERE c.id = ? AND c.deleted_at IS NULL`, [id])
  return rows[0] ?? null
}

async function runRow(db: D1Database, cardId: string): Promise<RunRow | null> {
  return (await query<RunRow>(db, 'SELECT * FROM task_agent_runs WHERE card_id = ?', [cardId]))[0] ?? null
}

/** Drops runs whose card left, queues cards that arrived, and fails runs that went quiet. */
async function reconcile(db: D1Database, now: string): Promise<void> {
  await db.prepare(`DELETE FROM task_agent_runs WHERE card_id NOT IN (${AGENT_CARDS})
    OR (status = 'queued' AND card_id IN (SELECT id FROM task_cards WHERE done_at IS NOT NULL))`).run()
  const arrived = await query<{ id: string; title: string }>(db, `SELECT c.id, c.title FROM task_cards c
    WHERE c.id IN (${AGENT_CARDS}) AND c.done_at IS NULL AND c.id NOT IN (SELECT card_id FROM task_agent_runs)
    ORDER BY c.position, c.id`)
  for (const card of arrived) {
    await db.prepare(`INSERT OR IGNORE INTO task_agent_runs (card_id, status, branch, queued_at, updated_at)
      VALUES (?, 'queued', ?, ?, ?)`).bind(card.id, agentBranch(card.title, now), now, now).run()
  }
  const quietSince = new Date(Date.parse(now) - AGENT_STALE_MS).toISOString()
  await db.prepare(`UPDATE task_agent_runs SET status = 'failed', note = ?, updated_at = ?
    WHERE status IN ('sent', 'working') AND COALESCE(reported_at, sent_at, queued_at) < ?`)
    .bind('Jarvis did not report for 3 hours', now, quietSince).run()
}

/** Takes the oldest queued run when a slot is free. One statement, so two Workers cannot both take the last slot. */
async function claim(db: D1Database, now: string): Promise<RunRow | null> {
  const rows = await query<RunRow>(db, `UPDATE task_agent_runs SET status = 'sent', sent_at = ?, attempts = attempts + 1, updated_at = ?
    WHERE card_id = (SELECT card_id FROM task_agent_runs WHERE status = 'queued' ORDER BY queued_at, card_id LIMIT 1)
      AND status = 'queued'
      AND (SELECT COUNT(*) FROM task_agent_runs WHERE status IN ('sent', 'working')) < ?
    RETURNING *`, [now, now, AGENT_SLOTS])
  return rows[0] ?? null
}

async function send(env: Env, run: RunRow, url: string, secret: string, fetcher: FetchLike): Promise<string | null> {
  const card = await cardRow(env.DB, run.card_id)
  if (!card) return 'The card is gone'
  const body = JSON.stringify({
    cardId: card.id, title: card.title, description: card.description, branch: run.branch,
    board: card.board_name, list: card.list_name, link: cardLink(env, card.id), queuedAt: run.queued_at
  })
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ego-signature': `sha256=${await sign(secret, body)}` },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    })
    return response.ok ? null : `T3 answered ${response.status}`
  } catch {
    return 'T3 could not be reached'
  }
}

export interface TaskAgentOptions {
  fetch?: FetchLike
  now?: () => string
}

/**
 * Brings the runs in line with the agent lists, then hands queued cards to T3 while slots are free.
 * A send that fails goes back in the queue for the next write or cron, up to five tries.
 */
export async function runTaskAgent(env: Env, options: TaskAgentOptions = {}): Promise<void> {
  const clock = options.now ?? (() => new Date().toISOString())
  await reconcile(env.DB, clock())
  const url = env.T3_AGENT_WEBHOOK_URL?.trim()
  const secret = env.T3_AGENT_WEBHOOK_SECRET?.trim()
  if (!url || !secret) return
  for (;;) {
    const now = clock()
    const run = await claim(env.DB, now)
    if (!run) return
    const problem = await send(env, run, url, secret, options.fetch ?? fetch)
    if (problem === null) {
      await env.DB.prepare('UPDATE task_agent_runs SET note = NULL WHERE card_id = ? AND status = ?').bind(run.card_id, 'sent').run()
      continue
    }
    await env.DB.prepare(`UPDATE task_agent_runs SET status = ?, sent_at = NULL, note = ?, updated_at = ?
      WHERE card_id = ? AND status = 'sent'`)
      .bind(run.attempts >= SEND_ATTEMPTS ? 'failed' : 'queued', problem, now, run.card_id).run()
    return
  }
}

export async function readTaskAgentRuns(db: D1Database): Promise<TaskAgentRun[]> {
  return (await query<RunRow>(db, 'SELECT * FROM task_agent_runs ORDER BY queued_at, card_id')).map(toTaskAgentRun)
}

async function isAgent(request: Request, env: Env): Promise<boolean> {
  const sent = bearer(request)
  const expected = env.TASKS_AGENT_TOKEN?.trim()
  if (!sent || !expected) return false
  const [left, right] = await Promise.all([hashToken(sent), hashToken(expected)])
  return left === right
}

async function readCard(env: Env, cardId: string): Promise<Response> {
  const run = await runRow(env.DB, cardId)
  const card = run ? await cardRow(env.DB, cardId) : null
  if (!run || !card) return fail('NOT_FOUND', 'That card is not in a Jarvis list')
  const record = toTaskCardRecord(card)
  const labels = record.labelIds.length === 0 ? [] : await query<{ name: string; color: string }>(env.DB,
    `SELECT name, color FROM task_labels WHERE id IN (${record.labelIds.map(() => '?').join(', ')}) AND deleted_at IS NULL`, record.labelIds)
  return json({
    ok: true,
    data: {
      card: record, labels, board: card.board_name, list: card.list_name, link: cardLink(env, cardId),
      run: toTaskAgentRun(run)
    }
  })
}

async function readCardMedia(env: Env, cardId: string, mediaId: string): Promise<Response> {
  const card = await runRow(env.DB, cardId) ? await cardRow(env.DB, cardId) : null
  const attached = card && toTaskCardRecord(card).attachments.some((file) => file.mediaId === mediaId || file.previewId === mediaId)
  if (!attached) return fail('NOT_FOUND', 'That file is not on this card')
  const object = await env.DIARY_MEDIA?.get(`tasks/${mediaId}`)
  if (!object) return fail('NOT_FOUND', 'That file does not exist')
  return new Response(object.body, {
    headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream', 'cache-control': 'no-store' }
  })
}

async function report(request: Request, env: Env, cardId: string, now: string, work?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const body: unknown = await request.json().catch(() => null)
  const status = isRecord(body) ? body.status : null
  if (!isRecord(body) || !isTaskAgentStatus(status) || !REPORTED.includes(status)) {
    return fail('INVALID_REQUEST', `status must be one of ${REPORTED.join(', ')}`)
  }
  const prUrl = body.prUrl ?? null
  if (prUrl !== null && (typeof prUrl !== 'string' || !PR_URL.test(prUrl))) {
    return fail('INVALID_REQUEST', 'prUrl must be a GitHub pull request link')
  }
  if (status === 'pr' && prUrl === null && !(await runRow(env.DB, cardId))?.pr_url) {
    return fail('INVALID_REQUEST', 'A pr report needs prUrl')
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, NOTE_LIMIT) : null
  const updated = await env.DB.prepare(`UPDATE task_agent_runs SET status = ?, pr_url = COALESCE(?, pr_url), note = ?,
    reported_at = ?, updated_at = ? WHERE card_id = ?`).bind(status, prUrl, note, now, now, cardId).run()
  if ((updated.meta.changes ?? 0) === 0) return fail('NOT_FOUND', 'That card is not in a Jarvis list')
  if (status !== 'working') work?.waitUntil(runTaskAgent(env).catch(() => undefined))
  const run = await runRow(env.DB, cardId)
  return json({ ok: true, data: run ? toTaskAgentRun(run) : null })
}

/**
 * Jarvis's own routes, under /v1/tasks/agent/cards/<card>, behind the TASKS_AGENT_TOKEN bearer.
 * They reach only cards that have a run, so the token cannot read the rest of Tasks.
 */
export function taskAgentRoute(
  request: Request, env: Env, path: string, now: string, work?: Pick<ExecutionContext, 'waitUntil'>
): Promise<Response> | null {
  const prefix = '/v1/tasks/agent/cards/'
  if (!path.startsWith(prefix)) return null
  return (async () => {
    if (!env.TASKS_AGENT_TOKEN?.trim()) return fail('NOT_CONFIGURED', 'Jarvis is not set up on the server')
    if (!await isAgent(request, env)) return fail('AUTH_REQUIRED', 'Send the Jarvis token')
    let parts: string[]
    try {
      parts = path.slice(prefix.length).split('/').map(decodeURIComponent)
    } catch {
      return fail('NOT_FOUND', 'That endpoint does not exist')
    }
    const [cardId, section, mediaId] = parts
    if (!cardId) return fail('NOT_FOUND', 'That endpoint does not exist')
    if (request.method === 'GET' && parts.length === 1) return readCard(env, cardId)
    if (request.method === 'GET' && parts.length === 3 && section === 'media' && mediaId) return readCardMedia(env, cardId, mediaId)
    if (request.method === 'POST' && parts.length === 2 && section === 'report') return report(request, env, cardId, now, work)
    return fail('NOT_FOUND', 'That endpoint does not exist')
  })()
}
