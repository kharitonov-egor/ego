import { HTTP_STATUS, type ApiResult, type TrelloWorkSyncResult } from '@ego/api-contracts'
import {
  TASK_DESCRIPTION_LIMIT, TASK_POSITION_STEP, TASK_TITLE_LIMIT, defaultTaskReminder, isTaskCardInput, taskCardInput,
  withTaskActivity, type FetchLike, type TaskCardInput, type TaskLabelColor, type TaskNames
} from '@ego/core'
import type { Env } from './auth'
import { applyOperation } from './commands'
import { isValidTimeZone, localClock } from './google-health'
import { query } from './reads'
import { toTaskCardRecord, type TaskCardRow } from './rows'

/**
 * The Work list mirrors two lists on the VCS board of the work Trello account, "Selected for
 * Development" and "In Progress: execute". Marking a card done in Ego moves it to "Done!".
 */
export const TRELLO_WORK_LISTS = {
  selected: '6ab28dfae12f8582e955f0d3',
  progress: '6ab28dfd4bcbb9d8acf69efe',
  done: '6ab28e1272312c0d5d3ab107'
} as const

type Status = keyof typeof TRELLO_WORK_LISTS
type ActiveStatus = Exclude<Status, 'done'>

const STATUSES: readonly string[] = ['selected', 'progress', 'done']

/** The labels that say which Trello list a card is in. Found by name on the Work list's board, made if missing. */
const STATUS_LABELS: Record<ActiveStatus, { name: string; color: TaskLabelColor }> = {
  progress: { name: 'In progress', color: 'pink' },
  selected: { name: 'Selected', color: 'yellow' }
}

const TRELLO = 'https://api.trello.com/1'
const DEFAULT_TIME_ZONE = 'America/New_York'
/** Trello has no date-only due, and Ego counts a date-only card as due until its day ends. */
const DATE_ONLY_TIME = '23:59'
const LOCK_MS = 60_000
const MAX_ROUNDS = 3
const NOTHING: TrelloWorkSyncResult = { changed: false, problem: null }

interface TrelloCard {
  id: string
  name: string
  desc: string
  due: string | null
  idList: string
  pos: number
}

interface TrelloSide {
  name: string
  desc: string
  due: string | null
  list: string
}

interface EgoSide {
  title: string
  description: string
  dueDate: string | null
  dueTime: string | null
  status: Status
}

/**
 * What both sides last agreed on, each in its own terms, so a due date that Trello stores with a
 * time it was never given does not read as an edit. `gone` marks a card that left the two lists.
 */
export interface Base {
  trello: TrelloSide
  ego: EgoSide
  gone: boolean
}

export interface Merge {
  pull: { title?: string; description?: string; due?: Pick<EgoSide, 'dueDate' | 'dueTime'>; status?: ActiveStatus }
  push: Partial<TrelloSide>
}

interface StatusLabels {
  selected: string
  progress: string
}

interface WorkList {
  id: string
  name: string
  board_id: string
  board_name: string
}

type CardRow = TaskCardRow & { deleted_at: string | null }

interface MappingRow {
  trello_id: string
  card_id: string
  base: string
}

interface Trello {
  get: (path: string, params: Record<string, string>) => Promise<ApiResult<unknown>>
  send: (method: 'POST' | 'PUT', path: string, body: Record<string, unknown>) => Promise<ApiResult<unknown>>
}

interface Context {
  db: D1Database
  trello: Trello
  now: string
  timeZone: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTrelloCard(value: unknown): value is TrelloCard {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    typeof value.desc === 'string' && (value.due === null || typeof value.due === 'string') &&
    typeof value.idList === 'string' && typeof value.pos === 'number'
}

function isSide(value: unknown, fields: Record<string, 'string' | 'nullable'>): boolean {
  return isRecord(value) && Object.entries(fields).every(([key, kind]) =>
    typeof value[key] === 'string' || (kind === 'nullable' && value[key] === null))
}

function parseBase(text: string): Base | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  if (!isRecord(value) || typeof value.gone !== 'boolean') return null
  if (!isSide(value.trello, { name: 'string', desc: 'string', due: 'nullable', list: 'string' })) return null
  if (!isSide(value.ego, { title: 'string', description: 'string', dueDate: 'nullable', dueTime: 'nullable', status: 'string' })) return null
  return STATUSES.includes((value.ego as EgoSide).status) ? value as unknown as Base : null
}

function upstream<T>(message: string): ApiResult<T> {
  return { ok: false, error: { code: 'UPSTREAM_ERROR', message } }
}

function trelloClient(key: string, token: string, fetcher: FetchLike): Trello {
  const call = async (method: string, path: string, params: Record<string, string>, body: Record<string, unknown> | null): Promise<ApiResult<unknown>> => {
    const url = `${TRELLO}${path}?${new URLSearchParams({ ...params, key, token })}`
    let response: Response
    try {
      response = await fetcher(url, body
        ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { method })
    } catch {
      return upstream('Trello did not answer')
    }
    const text = await response.text()
    if (!response.ok) return upstream(`Trello answered ${response.status}: ${text.slice(0, 160)}`)
    try {
      return { ok: true, data: JSON.parse(text) as unknown }
    } catch {
      return upstream('Trello sent something that is not JSON')
    }
  }
  return {
    get: (path, params) => call('GET', path, params, null),
    send: (method, path, body) => call(method, path, {}, body)
  }
}

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function egoDue(due: string | null, timeZone: string): Pick<EgoSide, 'dueDate' | 'dueTime'> {
  const ms = due === null ? Number.NaN : Date.parse(due)
  if (!Number.isFinite(ms)) return { dueDate: null, dueTime: null }
  const { date, minute } = localClock(ms, timeZone)
  return { dueDate: date, dueTime: `${two(Math.floor(minute / 60))}:${two(minute % 60)}` }
}

/** The instant a wall-clock time falls on in `timeZone`. The second pass corrects a guess that crossed a clock change. */
export function trelloDue(dueDate: string | null, dueTime: string | null, timeZone: string): string | null {
  if (dueDate === null) return null
  const wall = Date.parse(`${dueDate}T${dueTime ?? DATE_ONLY_TIME}:00Z`)
  let instant = wall
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = localClock(instant, timeZone)
    instant -= Date.parse(`${seen.date}T00:00:00Z`) + seen.minute * 60_000 - wall
  }
  return new Date(instant).toISOString()
}

function titleFrom(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, TASK_TITLE_LIMIT).trim() || 'Untitled card'
}

function activeStatus(list: string): ActiveStatus | null {
  if (list === TRELLO_WORK_LISTS.progress) return 'progress'
  if (list === TRELLO_WORK_LISTS.selected) return 'selected'
  return null
}

function egoStatus(card: TaskCardInput, labels: StatusLabels): Status | null {
  if (card.doneAt !== null) return 'done'
  if (card.labelIds.includes(labels.progress)) return 'progress'
  if (card.labelIds.includes(labels.selected)) return 'selected'
  return null
}

function egoSide(card: TaskCardInput, status: Status): EgoSide {
  return { title: card.title, description: card.description, dueDate: card.dueDate, dueTime: card.dueTime, status }
}

function trelloSide(card: TrelloCard): TrelloSide {
  return { name: card.name, desc: card.desc, due: card.due, list: card.idList }
}

/**
 * Field by field: whichever side changed since `base` wins, and Trello wins when both did. A card
 * coming back into the lists takes everything from Trello.
 */
export function mergeCard(trello: TrelloSide, ego: EgoSide, base: Base, timeZone: string): Merge {
  const fresh = base.gone
  const pull: Merge['pull'] = {}
  const push: Merge['push'] = {}
  if (fresh || trello.name !== base.trello.name) pull.title = titleFrom(trello.name)
  else if (ego.title !== base.ego.title) push.name = ego.title
  if (fresh || trello.desc !== base.trello.desc) pull.description = trello.desc.slice(0, TASK_DESCRIPTION_LIMIT)
  else if (ego.description !== base.ego.description) push.desc = ego.description
  if (fresh || trello.due !== base.trello.due) pull.due = egoDue(trello.due, timeZone)
  else if (ego.dueDate !== base.ego.dueDate || ego.dueTime !== base.ego.dueTime) push.due = trelloDue(ego.dueDate, ego.dueTime, timeZone)
  const status = activeStatus(trello.list)
  if (status && (fresh || trello.list !== base.trello.list)) pull.status = status
  else if (ego.status !== base.ego.status) push.list = TRELLO_WORK_LISTS[ego.status]
  return { pull, push }
}

function withStatusLabel(labelIds: readonly string[], labels: StatusLabels, status: ActiveStatus): string[] {
  return [...labelIds.filter((id) => id !== labels.selected && id !== labels.progress), labels[status]]
}

function same(left: TaskCardInput, right: TaskCardInput): boolean {
  return JSON.stringify(taskCardInput(left)) === JSON.stringify(taskCardInput(right))
}

async function findWorkList(db: D1Database): Promise<WorkList | null> {
  const rows = await query<WorkList>(db, `SELECT l.id, l.name, b.id AS board_id, b.name AS board_name
    FROM task_lists l JOIN task_boards b ON b.id = l.board_id AND b.deleted_at IS NULL AND b.archived_at IS NULL
    WHERE l.kind = 'work' AND l.deleted_at IS NULL AND l.archived_at IS NULL
    ORDER BY b.position, b.created_at, l.position LIMIT 1`)
  return rows[0] ?? null
}

async function statusLabels(ctx: Context, work: WorkList): Promise<ApiResult<{ labels: StatusLabels; names: Map<string, string>; made: boolean }>> {
  const rows = await query<{ id: string; name: string; position: number }>(ctx.db,
    'SELECT id, name, position FROM task_labels WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, created_at', [work.board_id])
  const names = new Map(rows.map((row) => [row.id, row.name]))
  let last = rows.reduce((top, row) => Math.max(top, row.position), 0)
  let made = false
  const found: Partial<StatusLabels> = {}
  for (const status of ['selected', 'progress'] as const) {
    const wanted = STATUS_LABELS[status]
    const existing = rows.find((row) => row.name.trim().toLowerCase() === wanted.name.toLowerCase())
    if (existing) {
      found[status] = existing.id
      continue
    }
    const id = crypto.randomUUID()
    last += TASK_POSITION_STEP
    const result = await applyOperation(ctx.db, {
      operationId: crypto.randomUUID(), entityId: id, expectedRevision: null, createdAt: ctx.now,
      command: { entity: 'taskLabel', type: 'create', payload: { boardId: work.board_id, name: wanted.name, color: wanted.color, position: last } }
    }, ctx.now)
    if (!result.ok) return result
    found[status] = id
    names.set(id, wanted.name)
    made = true
  }
  return { ok: true, data: { labels: { selected: found.selected ?? '', progress: found.progress ?? '' }, names, made } }
}

async function writeCard(ctx: Context, row: CardRow | null, id: string, next: TaskCardInput, names: TaskNames): Promise<boolean> {
  const before = row ? taskCardInput(toTaskCardRecord(row)) : null
  const input = withTaskActivity(before, next, names, ctx.now)
  if (!isTaskCardInput(input)) return false
  const result = await applyOperation(ctx.db, {
    operationId: crypto.randomUUID(), entityId: id, expectedRevision: row ? row.revision : null, createdAt: ctx.now,
    command: before ? { entity: 'taskCard', type: 'update', payload: input } : { entity: 'taskCard', type: 'create', payload: input }
  }, ctx.now)
  return result.ok
}

async function saveMapping(ctx: Context, trelloId: string, cardId: string, base: Base, previous: string | null): Promise<void> {
  const text = JSON.stringify(base)
  if (text === previous) return
  await ctx.db.prepare(`INSERT INTO trello_work_cards (trello_id, card_id, base, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(trello_id) DO UPDATE SET card_id = excluded.card_id, base = excluded.base, updated_at = excluded.updated_at`)
    .bind(trelloId, cardId, text, ctx.now).run()
}

async function runOnce(ctx: Context, work: WorkList): Promise<ApiResult<TrelloWorkSyncResult>> {
  const setup = await statusLabels(ctx, work)
  if (!setup.ok) return setup
  const { labels } = setup.data
  const names: TaskNames = {
    list: (id) => id === work.id ? work.name : null,
    label: (id) => setup.data.names.get(id) || null,
    board: (id) => id === work.board_id ? work.board_name : null
  }
  let changed = setup.data.made
  let problem: string | null = null

  const fetched: TrelloCard[] = []
  for (const list of [TRELLO_WORK_LISTS.progress, TRELLO_WORK_LISTS.selected]) {
    const result = await ctx.trello.get(`/lists/${list}/cards`, { fields: 'name,desc,due,idList,pos' })
    if (!result.ok) return result
    const items: unknown[] = Array.isArray(result.data) ? result.data : []
    fetched.push(...items.filter(isTrelloCard).filter((card) => card.idList === list))
  }
  // Each In Progress card goes on top of the column and each Selected one below the rest, so walking
  // In Progress from its last card up keeps Trello's order.
  const progress = fetched.filter((card) => card.idList === TRELLO_WORK_LISTS.progress).sort((a, b) => b.pos - a.pos)
  const selected = fetched.filter((card) => card.idList === TRELLO_WORK_LISTS.selected).sort((a, b) => a.pos - b.pos)

  const [mappings, mapped, loose, ends] = await Promise.all([
    query<MappingRow>(ctx.db, 'SELECT trello_id, card_id, base FROM trello_work_cards'),
    query<CardRow>(ctx.db, 'SELECT * FROM task_cards WHERE id IN (SELECT card_id FROM trello_work_cards)'),
    query<CardRow>(ctx.db, `SELECT * FROM task_cards WHERE list_id = ? AND deleted_at IS NULL AND archived_at IS NULL
      AND done_at IS NULL AND id NOT IN (SELECT card_id FROM trello_work_cards) ORDER BY position`, [work.id]),
    query<{ top: number | null; bottom: number | null }>(ctx.db, `SELECT MIN(position) AS top, MAX(position) AS bottom
      FROM task_cards WHERE list_id = ? AND deleted_at IS NULL AND archived_at IS NULL`, [work.id])
  ])
  const byTrello = new Map(mappings.map((mapping) => [mapping.trello_id, mapping]))
  const rows = new Map(mapped.map((row) => [row.id, row]))
  let top = ends[0]?.top ?? 0
  let bottom = ends[0]?.bottom ?? 0
  const place = (status: ActiveStatus): number => status === 'progress' ? (top -= TASK_POSITION_STEP) : (bottom += TASK_POSITION_STEP)

  const createFrom = async (card: TrelloCard, id: string, previous: string | null): Promise<void> => {
    const status = activeStatus(card.idList) ?? 'selected'
    const due = egoDue(card.due, ctx.timeZone)
    const input: TaskCardInput = {
      boardId: work.board_id, listId: work.id, title: titleFrom(card.name), description: card.desc.slice(0, TASK_DESCRIPTION_LIMIT),
      position: place(status), labelIds: [labels[status]], priority: 'none', dueDate: due.dueDate, dueTime: due.dueTime,
      reminderMinutes: due.dueDate ? defaultTaskReminder(due.dueTime) : null, doneAt: null, archivedAt: null,
      checklists: [], attachments: [], activity: []
    }
    let saved = input
    if (await writeCard(ctx, null, id, input, names)) {
      changed = true
    } else {
      // The card may exist from a run that stopped before it saved the mapping.
      const existing = (await query<CardRow>(ctx.db, 'SELECT * FROM task_cards WHERE id = ? AND deleted_at IS NULL', [id]))[0]
      if (!existing) return
      saved = taskCardInput(toTaskCardRecord(existing))
    }
    await saveMapping(ctx, card.id, id, { trello: trelloSide(card), ego: egoSide(saved, egoStatus(saved, labels) ?? status), gone: false }, previous)
  }

  const present = new Set<string>()
  for (const card of [...progress, ...selected]) {
    present.add(card.id)
    const mapping = byTrello.get(card.id)
    if (!mapping) {
      await createFrom(card, `trello-${card.id}`, null)
      continue
    }
    // An unreadable base is treated like a card coming back: Trello's copy wins every field.
    const base = parseBase(mapping.base) ??
      { trello: trelloSide(card), ego: { title: '', description: '', dueDate: null, dueTime: null, status: 'selected' }, gone: true }
    const row = rows.get(mapping.card_id)
    if (!row || row.deleted_at !== null) {
      // A card deleted in Ego stays deleted until it leaves the Trello lists and comes back.
      if (base.gone) await createFrom(card, crypto.randomUUID(), mapping.base)
      continue
    }
    if (row.board_id !== work.board_id) continue
    const before = taskCardInput(toTaskCardRecord(row))
    const merge = mergeCard(trelloSide(card), egoSide(before, egoStatus(before, labels) ?? base.ego.status), base, ctx.timeZone)
    const next: TaskCardInput = { ...before }
    if (merge.pull.title !== undefined) next.title = merge.pull.title
    if (merge.pull.description !== undefined) next.description = merge.pull.description
    if (merge.pull.due) {
      next.dueDate = merge.pull.due.dueDate
      next.dueTime = merge.pull.due.dueTime
      next.reminderMinutes = next.dueDate === null ? null : before.dueDate === null ? defaultTaskReminder(next.dueTime) : before.reminderMinutes
    }
    if (merge.pull.status) {
      next.labelIds = withStatusLabel(before.labelIds, labels, merge.pull.status)
      next.doneAt = null
      const moved = next.labelIds.join() !== before.labelIds.join()
      if (moved && next.listId === work.id) next.position = place(merge.pull.status)
    }
    if (base.gone) next.archivedAt = null
    if (!same(before, next)) {
      if (!await writeCard(ctx, row, row.id, next, names)) continue
      changed = true
    }
    let trelloNow = trelloSide(card)
    if (Object.keys(merge.push).length > 0) {
      const { name, desc, due, list } = merge.push
      const result = await ctx.trello.send('PUT', `/cards/${card.id}`, {
        ...(name !== undefined && { name }), ...(desc !== undefined && { desc }), ...(due !== undefined && { due }),
        ...(list !== undefined && { idList: list, pos: 'top' })
      })
      if (!result.ok) {
        problem ??= result.error.message
        continue
      }
      trelloNow = isTrelloCard(result.data) ? trelloSide(result.data) : { ...trelloNow, ...merge.push }
    }
    const status = egoStatus(next, labels) ?? merge.pull.status ?? base.ego.status
    await saveMapping(ctx, card.id, row.id, { trello: trelloNow, ego: egoSide(next, status), gone: false }, mapping.base)
  }

  for (const mapping of mappings) {
    if (present.has(mapping.trello_id)) continue
    const base = parseBase(mapping.base)
    if (!base || base.gone) continue
    const row = rows.get(mapping.card_id)
    if (row && row.deleted_at === null && row.archived_at === null && row.board_id === work.board_id) {
      const before = taskCardInput(toTaskCardRecord(row))
      if (!await writeCard(ctx, row, row.id, { ...before, archivedAt: ctx.now }, names)) continue
      changed = true
    }
    await saveMapping(ctx, mapping.trello_id, mapping.card_id, { ...base, gone: true }, mapping.base)
  }

  for (const row of loose) {
    const card = taskCardInput(toTaskCardRecord(row))
    const status: ActiveStatus = egoStatus(card, labels) === 'progress' ? 'progress' : 'selected'
    const result = await ctx.trello.send('POST', '/cards', {
      idList: TRELLO_WORK_LISTS[status], name: card.title, desc: card.description,
      due: trelloDue(card.dueDate, card.dueTime, ctx.timeZone), pos: 'top'
    })
    if (!result.ok || !isTrelloCard(result.data)) {
      problem ??= result.ok ? 'Trello did not return the new card' : result.error.message
      continue
    }
    await saveMapping(ctx, result.data.id, row.id, { trello: trelloSide(result.data), ego: egoSide(card, status), gone: false }, null)
  }

  return { ok: true, data: { changed, problem } }
}

async function rememberTimeZone(db: D1Database, timeZone: string | null): Promise<string> {
  if (timeZone !== null && isValidTimeZone(timeZone)) {
    await db.prepare(`INSERT INTO trello_work_sync (id, time_zone) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET time_zone = excluded.time_zone`).bind(timeZone).run()
    return timeZone
  }
  const rows = await query<{ time_zone: string | null }>(db, 'SELECT time_zone FROM trello_work_sync WHERE id = 1')
  const saved = rows[0]?.time_zone ?? null
  return saved !== null && isValidTimeZone(saved) ? saved : DEFAULT_TIME_ZONE
}

/** False when another sync holds the lock. That one is asked to run again, so this call's edit is not lost. */
async function lock(db: D1Database, now: string): Promise<boolean> {
  await db.prepare('INSERT OR IGNORE INTO trello_work_sync (id) VALUES (1)').run()
  const until = new Date(Date.parse(now) + LOCK_MS).toISOString()
  const claimed = await db.prepare(`UPDATE trello_work_sync SET locked_until = ?, rerun = 0
    WHERE id = 1 AND (locked_until IS NULL OR locked_until < ?)`).bind(until, now).run()
  if (claimed.meta.changes > 0) return true
  await db.prepare('UPDATE trello_work_sync SET rerun = 1 WHERE id = 1').run()
  return false
}

/** Releases the lock unless a run was asked for meanwhile, in one statement so a request cannot slip between. */
async function unlockIfIdle(db: D1Database): Promise<boolean> {
  const released = await db.prepare('UPDATE trello_work_sync SET locked_until = NULL WHERE id = 1 AND rerun = 0').run()
  if (released.meta.changes > 0) return true
  await db.prepare('UPDATE trello_work_sync SET rerun = 0 WHERE id = 1').run()
  return false
}

export interface TrelloWorkOptions {
  timeZone?: string | null
  fetch?: FetchLike
  now?: () => string
}

/** Pulls the two Trello lists into the Work list and pushes Ego's edits back. Does nothing without a Work list. */
export async function syncTrelloWork(env: Env, options: TrelloWorkOptions = {}): Promise<ApiResult<TrelloWorkSyncResult>> {
  const key = env.TRELLO_WORK_API_KEY?.trim()
  const token = env.TRELLO_WORK_TOKEN?.trim()
  if (!key || !token) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'The work Trello key and token are not set on the server' } }
  const work = await findWorkList(env.DB)
  if (!work) return { ok: true, data: NOTHING }
  const clock = options.now ?? (() => new Date().toISOString())
  const timeZone = await rememberTimeZone(env.DB, options.timeZone ?? null)
  if (!await lock(env.DB, clock())) return { ok: true, data: NOTHING }
  const trello = trelloClient(key, token, options.fetch ?? fetch)
  let held = true
  try {
    let outcome: ApiResult<TrelloWorkSyncResult> = { ok: true, data: NOTHING }
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const result = await runOnce({ db: env.DB, trello, now: clock(), timeZone }, work)
      outcome = !result.ok ? result : !outcome.ok ? outcome : {
        ok: true, data: { changed: outcome.data.changed || result.data.changed, problem: outcome.data.problem ?? result.data.problem }
      }
      if (await unlockIfIdle(env.DB)) {
        held = false
        break
      }
    }
    await env.DB.prepare('UPDATE trello_work_sync SET synced_at = ?, problem = ? WHERE id = 1')
      .bind(clock(), outcome.ok ? outcome.data.problem : outcome.error.message).run()
    return outcome
  } finally {
    if (held) await env.DB.prepare('UPDATE trello_work_sync SET locked_until = NULL, rerun = 0 WHERE id = 1').run()
  }
}

/** After a device's writes: syncs only if they touched a mirrored card or the Work list. */
export async function syncTrelloWorkAfterWrites(env: Env, since: string): Promise<void> {
  if (!env.TRELLO_WORK_API_KEY || !env.TRELLO_WORK_TOKEN) return
  const touched = await query<{ id: string }>(env.DB, `SELECT c.id FROM task_cards c
      JOIN task_lists l ON l.id = c.list_id AND l.kind = 'work' AND l.deleted_at IS NULL
      WHERE c.deleted_at IS NULL AND c.updated_at >= ?
    UNION ALL
    SELECT c.id FROM trello_work_cards m JOIN task_cards c ON c.id = m.card_id WHERE c.updated_at >= ?
    LIMIT 1`, [since, since])
  if (touched.length > 0) await syncTrelloWork(env)
}

/** POST /v1/tasks/work/sync, sent when a board with the Work list opens. */
export async function trelloWorkRoute(request: Request, env: Env): Promise<Response> {
  let body: unknown = null
  try { body = await request.json() } catch { body = null }
  const timeZone = isRecord(body) && typeof body.timeZone === 'string' ? body.timeZone : null
  const result = await syncTrelloWork(env, { timeZone })
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : HTTP_STATUS[result.error.code],
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}
