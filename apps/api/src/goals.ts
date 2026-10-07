import {
  AGENT_EARLY_START_MINUTES, isAgentTrigger, nextRunAt, startsEarly, type AgentTrigger
} from '@ego/core'
import {
  AGENT_GOALS_MAX, AGENT_GOAL_INSTRUCTIONS_MAX, AGENT_GOAL_TITLE_MAX,
  type AgentFireResult, type AgentGoal, type AgentGoalInput, type AgentGoalStatus, type AgentGoalUpdate, type AgentRun,
  type AgentRunReason, type AgentRunStatus
} from '@ego/api-contracts'
import { agentTimeZone, readAgentSettings, updateAgentSettings } from './agent-settings'
import type { Env } from './auth'
import { isValidTimeZone } from './google-health'
import { query } from './reads'

/** The routine's API trigger allows 30 fires an hour per routine; Ego stays well under it. */
const MAX_FIRES_PER_HOUR = 20
const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000
/** A fired run nobody started is fired again after this. The hourly schedule may also pick it up. */
const REFIRE_AFTER_MS = HOUR_MS
const STALE_RUNNING_MS = 90 * MINUTE_MS
const ABANDONED_QUEUED_MS = 24 * HOUR_MS
export const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01'

export class GoalError extends Error {}

interface GoalRow {
  id: string
  dataset_id: string
  title: string
  instructions: string
  trigger: string
  status: AgentGoalStatus
  muted: number
  time_zone: string
  next_run_at: string | null
  last_run_at: string | null
  last_summary: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface RunRow {
  id: string
  dataset_id: string
  goal_id: string
  reason: AgentRunReason
  event: string | null
  status: AgentRunStatus
  deliver_at: string | null
  summary: string | null
  session_url: string | null
  created_at: string
  fired_at: string | null
  started_at: string | null
  finished_at: string | null
}

export interface GoalWithRow {
  goal: AgentGoal
  muted: boolean
}

function parseTrigger(raw: string): AgentTrigger {
  try {
    const value: unknown = JSON.parse(raw)
    return isAgentTrigger(value) ? value : { type: 'manual' }
  } catch {
    return { type: 'manual' }
  }
}

export function toGoal(row: GoalRow): AgentGoal {
  return {
    id: row.id, title: row.title, instructions: row.instructions, trigger: parseTrigger(row.trigger), status: row.status,
    muted: row.muted === 1, timeZone: row.time_zone, nextRunAt: row.next_run_at, lastRunAt: row.last_run_at,
    lastSummary: row.last_summary, createdAt: row.created_at, updatedAt: row.updated_at
  }
}

function toRun(row: RunRow & { goal_title: string | null }): AgentRun {
  return {
    id: row.id, goalId: row.goal_id, goalTitle: row.goal_title ?? 'Deleted goal', reason: row.reason, status: row.status,
    deliverAt: row.deliver_at, summary: row.summary, sessionUrl: row.session_url, createdAt: row.created_at,
    firedAt: row.fired_at, startedAt: row.started_at, finishedAt: row.finished_at
  }
}

function iso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

function cleanTitle(title: string): string {
  const cleaned = title.replace(/\s+/g, ' ').trim()
  if (!cleaned) throw new GoalError('A goal needs a title')
  if (cleaned.length > AGENT_GOAL_TITLE_MAX) throw new GoalError(`A goal title can be up to ${AGENT_GOAL_TITLE_MAX} characters`)
  return cleaned
}

function cleanInstructions(text: string): string {
  const cleaned = text.trim()
  if (cleaned.length < 3) throw new GoalError('Say what the agent should do')
  if (cleaned.length > AGENT_GOAL_INSTRUCTIONS_MAX) throw new GoalError(`Instructions can be up to ${AGENT_GOAL_INSTRUCTIONS_MAX} characters`)
  return cleaned
}

export async function goalRow(db: D1Database, datasetId: string, id: string): Promise<GoalRow | null> {
  const rows = await query<GoalRow>(db, 'SELECT * FROM agent_goals WHERE id = ? AND dataset_id = ? AND deleted_at IS NULL', [id, datasetId])
  return rows[0] ?? null
}

export async function getGoal(db: D1Database, datasetId: string, id: string): Promise<AgentGoal | null> {
  const row = await goalRow(db, datasetId, id)
  return row ? toGoal(row) : null
}

/** Active and paused goals first, then finished ones, each newest first. */
export async function listGoals(db: D1Database, datasetId: string): Promise<AgentGoal[]> {
  const rows = await query<GoalRow>(db, `SELECT * FROM agent_goals WHERE dataset_id = ? AND deleted_at IS NULL
    ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, created_at DESC`, [datasetId])
  return rows.map(toGoal)
}

export async function createGoal(db: D1Database, datasetId: string, input: AgentGoalInput, now: string): Promise<AgentGoal> {
  const title = cleanTitle(input.title)
  const instructions = cleanInstructions(input.instructions)
  const count = await query<{ count: number }>(db, `SELECT COUNT(*) AS count FROM agent_goals
    WHERE dataset_id = ? AND deleted_at IS NULL AND status != 'done'`, [datasetId])
  if ((count[0]?.count ?? 0) >= AGENT_GOALS_MAX) throw new GoalError(`Ego keeps up to ${AGENT_GOALS_MAX} goals. Delete or finish one first.`)
  const settings = await readAgentSettings(db, datasetId)
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : agentTimeZone(settings)
  const next = nextRunAt(input.trigger, Date.parse(now), timeZone)
  if (input.trigger.type === 'once' && next === null) throw new GoalError('That time has already passed')
  const row: GoalRow = {
    id: crypto.randomUUID(), dataset_id: datasetId, title, instructions, trigger: JSON.stringify(input.trigger), status: 'active',
    muted: input.muted ? 1 : 0, time_zone: timeZone, next_run_at: iso(next), last_run_at: null, last_summary: null,
    created_at: now, updated_at: now, deleted_at: null
  }
  await db.prepare(`INSERT INTO agent_goals (id, dataset_id, title, instructions, trigger, status, muted, time_zone, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`)
    .bind(row.id, datasetId, title, instructions, row.trigger, row.muted, timeZone, row.next_run_at, now, now).run()
  return toGoal(row)
}

export async function updateGoal(db: D1Database, datasetId: string, id: string, update: AgentGoalUpdate, now: string): Promise<AgentGoal | null> {
  const row = await goalRow(db, datasetId, id)
  if (!row) return null
  const trigger = update.trigger ?? parseTrigger(row.trigger)
  const status: AgentGoalStatus = update.status ?? (row.status === 'done' && update.trigger ? 'active' : row.status)
  const rescheduled = update.trigger !== undefined || (update.status === 'active' && row.status !== 'active')
  const lastRun = row.last_run_at ? Date.parse(row.last_run_at) : null
  const next = status === 'active'
    ? (rescheduled ? nextRunAt(trigger, Date.parse(now), row.time_zone, lastRun) : row.next_run_at ? Date.parse(row.next_run_at) : null)
    : null
  const changed: GoalRow = {
    ...row,
    title: update.title === undefined ? row.title : cleanTitle(update.title),
    instructions: update.instructions === undefined ? row.instructions : cleanInstructions(update.instructions),
    trigger: JSON.stringify(trigger),
    status,
    muted: update.muted === undefined ? row.muted : update.muted ? 1 : 0,
    next_run_at: status === 'paused' ? row.next_run_at : iso(next),
    updated_at: now
  }
  await db.prepare(`UPDATE agent_goals SET title = ?, instructions = ?, trigger = ?, status = ?, muted = ?, next_run_at = ?, updated_at = ?
    WHERE id = ?`).bind(changed.title, changed.instructions, changed.trigger, changed.status, changed.muted, changed.next_run_at, now, id).run()
  return toGoal(changed)
}

/** Deleting a goal also cancels its runs that have not started. */
export async function deleteGoal(db: D1Database, datasetId: string, id: string, now: string): Promise<boolean> {
  const row = await goalRow(db, datasetId, id)
  if (!row) return false
  await db.batch([
    db.prepare('UPDATE agent_goals SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id),
    db.prepare(`UPDATE agent_runs SET status = 'failed', summary = 'The goal was deleted', finished_at = ? WHERE goal_id = ? AND status = 'queued'`)
      .bind(now, id)
  ])
  return true
}

export async function queueRun(db: D1Database, goal: Pick<GoalRow, 'id' | 'dataset_id'>, reason: AgentRunReason, now: string, options: {
  deliverAt?: string | null
  event?: string | null
} = {}): Promise<string> {
  const id = crypto.randomUUID()
  await db.prepare(`INSERT INTO agent_runs (id, dataset_id, goal_id, reason, event, status, deliver_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`)
    .bind(id, goal.dataset_id, goal.id, reason, options.event ?? null, options.deliverAt ?? null, now).run()
  return id
}

export async function listRuns(db: D1Database, datasetId: string, goalId: string | null, limit = 30): Promise<AgentRun[]> {
  const rows = await query<RunRow & { goal_title: string | null }>(db, `SELECT r.*, g.title AS goal_title FROM agent_runs r
    LEFT JOIN agent_goals g ON g.id = r.goal_id WHERE r.dataset_id = ? ${goalId ? 'AND r.goal_id = ?' : ''}
    ORDER BY r.created_at DESC LIMIT ?`, goalId ? [datasetId, goalId, limit] : [datasetId, limit])
  return rows.map(toRun)
}

/** Queues a goal's run that the user asked for, whatever its schedule says. */
export async function runGoalNow(db: D1Database, datasetId: string, goalId: string, now: string): Promise<string | null> {
  const row = await goalRow(db, datasetId, goalId)
  if (!row) return null
  return queueRun(db, row, 'now', now)
}

/** A one-off task from the chat: a manual goal that finishes after its only run. */
export async function delegateTask(db: D1Database, datasetId: string, title: string, instructions: string, now: string): Promise<{ goal: AgentGoal; runId: string }> {
  const goal = await createGoal(db, datasetId, { title, instructions, trigger: { type: 'manual' } }, now)
  const runId = await queueRun(db, { id: goal.id, dataset_id: datasetId }, 'delegate', now)
  return { goal, runId }
}

export interface StartedRun {
  runId: string
  goalId: string
  title: string
  instructions: string
  reason: AgentRunReason
  /** Untrusted text from whatever set the run off, such as a webhook. */
  event: string | null
  deliverAt: string | null
  lastSummary: string | null
  muted: boolean
}

/** Claims queued runs for the routine. `runIds` null takes every queued one, for the hourly backup. */
export async function startRuns(db: D1Database, datasetId: string, runIds: readonly string[] | null, now: string): Promise<StartedRun[]> {
  if (runIds !== null && runIds.length === 0) return []
  const filter = runIds === null ? '' : `AND id IN (${runIds.map(() => '?').join(', ')})`
  const claimed = await query<RunRow>(db, `UPDATE agent_runs SET status = 'running', started_at = ?
    WHERE dataset_id = ? AND status = 'queued' ${filter} RETURNING *`, [now, datasetId, ...(runIds ?? [])])
  const started: StartedRun[] = []
  for (const run of claimed.sort((left, right) => left.created_at.localeCompare(right.created_at))) {
    const goal = await query<GoalRow>(db, 'SELECT * FROM agent_goals WHERE id = ?', [run.goal_id])
    const row = goal[0]
    if (!row || row.deleted_at) {
      await db.prepare(`UPDATE agent_runs SET status = 'failed', summary = 'The goal was deleted', finished_at = ? WHERE id = ?`).bind(now, run.id).run()
      continue
    }
    started.push({
      runId: run.id, goalId: row.id, title: row.title, instructions: row.instructions, reason: run.reason, event: run.event,
      deliverAt: run.deliver_at, lastSummary: row.last_summary, muted: row.muted === 1
    })
  }
  return started
}

export async function runRow(db: D1Database, datasetId: string, runId: string): Promise<(RunRow & { goal_title: string | null; muted: number | null }) | null> {
  const rows = await query<RunRow & { goal_title: string | null; muted: number | null }>(db, `SELECT r.*, g.title AS goal_title, g.muted AS muted
    FROM agent_runs r LEFT JOIN agent_goals g ON g.id = r.goal_id WHERE r.id = ? AND r.dataset_id = ?`, [runId, datasetId])
  return rows[0] ?? null
}

/** The run the agent is most likely working on: the only one running, if there is exactly one. */
export async function soleRunningRun(db: D1Database, datasetId: string): Promise<(RunRow & { goal_title: string | null; muted: number | null }) | null> {
  const rows = await query<RunRow & { goal_title: string | null; muted: number | null }>(db, `SELECT r.*, g.title AS goal_title, g.muted AS muted
    FROM agent_runs r LEFT JOIN agent_goals g ON g.id = r.goal_id WHERE r.dataset_id = ? AND r.status = 'running' LIMIT 2`, [datasetId])
  return rows.length === 1 ? rows[0] : null
}

/** Closes a run. A one-off or delegated goal is done after it. */
export async function finishRun(
  db: D1Database, datasetId: string, runId: string, outcome: 'succeeded' | 'failed', summary: string, now: string
): Promise<AgentRun | null> {
  const run = await runRow(db, datasetId, runId)
  if (!run) return null
  const text = summary.replace(/\s+/g, ' ').trim().slice(0, 500)
  await db.prepare('UPDATE agent_runs SET status = ?, summary = ?, finished_at = ? WHERE id = ?').bind(outcome, text, now, runId).run()
  const goal = await goalRow(db, datasetId, run.goal_id)
  if (goal) {
    const trigger = parseTrigger(goal.trigger)
    const finished = run.reason === 'delegate' || (trigger.type === 'once' && run.reason === 'schedule')
    await db.prepare('UPDATE agent_goals SET last_run_at = ?, last_summary = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(now, text, finished ? 'done' : goal.status, now, goal.id).run()
  }
  return toRun({ ...run, status: outcome, summary: text, finished_at: now })
}

/**
 * Queues every active goal that is due, or nearly due when it has a set time. A goal with a run
 * still open is skipped. A missed slot is not made up: the next one is counted from now.
 */
export async function queueDueGoals(db: D1Database, now: string): Promise<number> {
  const nowMs = Date.parse(now)
  const horizon = new Date(nowMs + AGENT_EARLY_START_MINUTES * MINUTE_MS).toISOString()
  const rows = await query<GoalRow>(db, `SELECT * FROM agent_goals WHERE deleted_at IS NULL AND status = 'active'
    AND next_run_at IS NOT NULL AND next_run_at <= ?`, [horizon])
  let queued = 0
  for (const row of rows) {
    const trigger = parseTrigger(row.trigger)
    const dueMs = Date.parse(row.next_run_at ?? now)
    const queueAt = startsEarly(trigger) ? dueMs - AGENT_EARLY_START_MINUTES * MINUTE_MS : dueMs
    if (queueAt > nowMs) continue
    const open = await query<{ id: string }>(db, `SELECT id FROM agent_runs WHERE goal_id = ? AND status IN ('queued', 'running') LIMIT 1`, [row.id])
    const next = nextRunAt(trigger, Math.max(dueMs, nowMs), row.time_zone, dueMs)
    if (open.length === 0) {
      await queueRun(db, row, 'schedule', now, { deliverAt: startsEarly(trigger) && dueMs > nowMs ? row.next_run_at : null })
      queued += 1
    }
    await db.prepare('UPDATE agent_goals SET next_run_at = ?, updated_at = ? WHERE id = ?').bind(iso(next), now, row.id).run()
  }
  return queued
}

/** Runs that began and never finished, and queued runs nobody picked up for a day, are failed. */
export async function failStaleRuns(db: D1Database, now: string): Promise<void> {
  const nowMs = Date.parse(now)
  await db.batch([
    db.prepare(`UPDATE agent_runs SET status = 'failed', summary = 'The run did not finish', finished_at = ?
      WHERE status = 'running' AND started_at < ?`).bind(now, new Date(nowMs - STALE_RUNNING_MS).toISOString()),
    db.prepare(`UPDATE agent_runs SET status = 'failed', summary = 'The routine never picked this up', finished_at = ?
      WHERE status = 'queued' AND created_at < ?`).bind(now, new Date(nowMs - ABANDONED_QUEUED_MS).toISOString())
  ])
}

export function routineConfigured(env: Env): boolean {
  return Boolean(env.AGENT_ROUTINE_URL?.trim() && env.AGENT_ROUTINE_TOKEN?.trim())
}

function sessionUrlFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('claude_code_session_url' in body)) return null
  const url = body.claude_code_session_url
  return typeof url === 'string' && url.startsWith('https://') ? url : null
}

/**
 * Wakes the Claude routine with every queued run that was never fired, or fired an hour ago and
 * never started. The fire text carries only run ids; the routine reads each goal from Ego.
 */
export async function fireRoutine(env: Env, datasetId: string, now: string): Promise<AgentFireResult> {
  const nowMs = Date.parse(now)
  const runs = await query<{ id: string }>(env.DB, `SELECT id FROM agent_runs WHERE dataset_id = ? AND status = 'queued'
    AND (fired_at IS NULL OR fired_at < ?) ORDER BY created_at`, [datasetId, new Date(nowMs - REFIRE_AFTER_MS).toISOString()])
  if (runs.length === 0) return { fired: false, runs: 0, sessionUrl: null, error: null }
  if (!routineConfigured(env)) {
    return { fired: false, runs: runs.length, sessionUrl: null, error: 'Set AGENT_ROUTINE_URL and AGENT_ROUTINE_TOKEN on the Worker' }
  }
  const settings = await readAgentSettings(env.DB, datasetId)
  const recent = settings.fires.filter((at) => Date.parse(at) > nowMs - HOUR_MS)
  if (recent.length >= MAX_FIRES_PER_HOUR) {
    return { fired: false, runs: runs.length, sessionUrl: null, error: 'The routine was woken too often this hour. The next check will try again.' }
  }
  const ids = runs.map((run) => run.id)
  let error: string | null = null
  let sessionUrl: string | null = null
  try {
    const response = await fetch(env.AGENT_ROUTINE_URL?.trim() ?? '', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.AGENT_ROUTINE_TOKEN?.trim() ?? ''}`,
        'anthropic-beta': ROUTINE_BETA,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ text: `Ego runs to start: ${ids.join(', ')}` })
    })
    if (response.ok) {
      sessionUrl = sessionUrlFrom(await response.json().catch(() => null))
    } else {
      error = response.status === 401 || response.status === 403
        ? 'The routine rejected its token. Make a new one on claude.ai and replace AGENT_ROUTINE_TOKEN.'
        : `The routine answered HTTP ${response.status}`
    }
  } catch {
    error = 'The routine could not be reached'
  }
  if (!error) {
    await env.DB.prepare(`UPDATE agent_runs SET fired_at = ?, session_url = COALESCE(?, session_url)
      WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(now, sessionUrl, ...ids).run()
  }
  await updateAgentSettings(env.DB, datasetId, now, (current) => ({
    ...current,
    fires: error ? recent : [...recent, now],
    lastFiredAt: error ? current.lastFiredAt : now,
    lastFireError: error
  }))
  return { fired: error === null, runs: ids.length, sessionUrl, error }
}
