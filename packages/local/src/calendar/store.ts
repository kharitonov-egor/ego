import type { ApiResult, CalendarAccount, CalendarEvent, CalendarInfo, CalendarSnapshot } from '@ego/api-contracts'
import type { CalendarApi } from '../api-client'
import { withPreparedRuns, type LocalDatabase } from '../database/types'

/** Nothing is left behind by a run of pages that keeps answering with another cursor. */
const MAX_PAGES = 40

export interface CalendarMeta {
  accounts: CalendarAccount[]
  calendars: CalendarInfo[]
  /** The Worker's clock at the last complete read, sent back so it answers with only the difference. */
  serverTime: string | null
  fetchedAt: string | null
}

interface StateRow {
  accounts: string | null
  server_time: string | null
  fetched_at: string | null
}

function parseJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAccount(value: unknown): value is CalendarAccount {
  return isRecord(value) && typeof value.id === 'string' && typeof value.connected === 'boolean'
}

function isInfo(value: unknown): value is CalendarInfo {
  return isRecord(value) && typeof value.key === 'string' && typeof value.color === 'string' && typeof value.selected === 'boolean'
}

function isEvent(value: unknown): value is CalendarEvent {
  return isRecord(value) && typeof value.key === 'string' && typeof value.start === 'string' && typeof value.end === 'string'
}

/** Where an event sits on the timeline. An all-day event spans its days in UTC, as on the Worker. */
export function eventSpan(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>): { startsAt: string; endsAt: string } {
  if (!event.allDay) return { startsAt: event.start, endsAt: event.end }
  return { startsAt: `${event.start}T00:00:00.000Z`, endsAt: `${event.end}T00:00:00.000Z` }
}

export async function cachedCalendarMeta(db: LocalDatabase): Promise<CalendarMeta> {
  const [lists, state] = await Promise.all([
    db.all<{ info: string }>('SELECT info FROM calendar_lists'),
    db.all<StateRow>('SELECT accounts, server_time, fetched_at FROM calendar_state WHERE id = 1')
  ])
  const accounts = parseJson(state[0]?.accounts ?? null)
  return {
    accounts: Array.isArray(accounts) ? accounts.filter(isAccount) : [],
    calendars: lists.map((row) => parseJson(row.info)).filter(isInfo),
    serverTime: state[0]?.server_time ?? null,
    fetchedAt: state[0]?.fetched_at ?? null
  }
}

/**
 * Every stored event overlapping [from, to). The bounds are padded by a day so an all-day event,
 * which is placed in UTC, is never lost to the device's own zone; callers place events by day.
 */
export async function cachedEvents(db: LocalDatabase, fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const padded = (iso: string, days: number): string => new Date(Date.parse(iso) + days * 86_400_000).toISOString()
  const rows = await db.all<{ event: string }>(
    'SELECT event FROM calendar_events WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at',
    [padded(toIso, 1), padded(fromIso, -1)]
  )
  return rows.map((row) => parseJson(row.event)).filter(isEvent)
}

/**
 * Merges what the Worker sent. `replace` empties the copy first, for a read with no `since`. The
 * Worker's clock is kept only once a read ends without a cursor, so a half-read run starts over.
 */
export async function saveCalendarSnapshot(
  db: LocalDatabase, snapshot: CalendarSnapshot, options: { replace: boolean; fetchedAt: string }
): Promise<void> {
  await db.transaction((tx) => withPreparedRuns(tx, async (cached) => {
    if (options.replace) {
      await cached.run('DELETE FROM calendar_events')
      await cached.run('DELETE FROM calendar_lists')
    }
    for (const info of snapshot.calendars) {
      if (info.deleted) await cached.run('DELETE FROM calendar_lists WHERE key = ?', [info.key])
      else await cached.run('INSERT OR REPLACE INTO calendar_lists (key, info, updated_at) VALUES (?, ?, ?)', [info.key, JSON.stringify(info), info.updatedAt])
    }
    for (const event of snapshot.events) {
      if (event.deleted) {
        await cached.run('DELETE FROM calendar_events WHERE key = ?', [event.key])
        continue
      }
      const span = eventSpan(event)
      await cached.run(`INSERT OR REPLACE INTO calendar_events (key, calendar_key, starts_at, ends_at, event, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`, [
        event.key, `${event.accountId}/${event.calendarId}`, span.startsAt, span.endsAt, JSON.stringify(event), event.updatedAt
      ])
    }
    const connected = new Set(snapshot.accounts.map((account) => account.id))
    const stale = await cached.all<{ key: string }>('SELECT key FROM calendar_lists')
    for (const row of stale) {
      const accountId = row.key.slice(0, row.key.indexOf('/'))
      if (!connected.has(accountId)) await cached.run('DELETE FROM calendar_lists WHERE key = ?', [row.key])
    }
    await cached.run(`INSERT INTO calendar_state (id, accounts, server_time, fetched_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET accounts = excluded.accounts,
        server_time = COALESCE(excluded.server_time, calendar_state.server_time), fetched_at = excluded.fetched_at`,
    [JSON.stringify(snapshot.accounts), snapshot.cursor === null ? snapshot.serverTime : null, options.fetchedAt])
  }))
}

export async function forgetCalendar(db: LocalDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM calendar_events')
    await tx.run('DELETE FROM calendar_lists')
    await tx.run('DELETE FROM calendar_state')
  })
}

/**
 * Asks the Worker for everything that changed since the last complete read, pulling from Google
 * first when `sync` is set, and follows its cursor until the read is whole. The copy on the device
 * is untouched when the first request fails.
 */
export async function refreshCalendar(
  db: LocalDatabase, api: Pick<CalendarApi, 'calendarData' | 'calendarSync'>, options: { sync: boolean; now: string }
): Promise<ApiResult<CalendarAccount[]>> {
  const state = await db.all<{ server_time: string | null }>('SELECT server_time FROM calendar_state WHERE id = 1')
  const since = state[0]?.server_time ?? null
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result: ApiResult<CalendarSnapshot> = page === 0 && options.sync
      ? await api.calendarSync(since, null)
      : await api.calendarData(since, cursor)
    if (!result.ok) return result
    await saveCalendarSnapshot(db, result.data, { replace: since === null && page === 0, fetchedAt: options.now })
    cursor = result.data.cursor
    if (!cursor) return { ok: true, data: result.data.accounts }
  }
  return { ok: false, error: { code: 'SERVER_ERROR', message: 'Calendar kept sending more pages. Try again.' } }
}

/** A write's answer: the change itself and whatever else moved since the last read. */
export async function applyCalendarAnswer(db: LocalDatabase, snapshot: CalendarSnapshot, now: string): Promise<void> {
  const state = await db.all<{ server_time: string | null }>('SELECT server_time FROM calendar_state WHERE id = 1')
  await saveCalendarSnapshot(db, { ...snapshot, cursor: state[0]?.server_time ? snapshot.cursor : 'partial' }, { replace: false, fetchedAt: now })
}

/**
 * The next thing on the calendar, for the start screen: an event under way or starting later,
 * from the ticked calendars, that the account has not declined.
 */
export async function nextCalendarEvent(db: LocalDatabase, nowIso: string): Promise<{ event: CalendarEvent; calendar: CalendarInfo } | null> {
  const meta = await cachedCalendarMeta(db)
  const shown = new Map(meta.calendars.filter((calendar) => calendar.selected).map((calendar) => [calendar.key, calendar]))
  if (shown.size === 0) return null
  const rows = await db.all<{ event: string }>(
    'SELECT event FROM calendar_events WHERE ends_at > ? ORDER BY starts_at LIMIT 200', [nowIso]
  )
  for (const row of rows) {
    const event = parseJson(row.event)
    if (!isEvent(event) || event.allDay || event.response === 'declined') continue
    const calendar = shown.get(`${event.accountId}/${event.calendarId}`)
    if (calendar) return { event, calendar }
  }
  return null
}

/** The start screen's copy may be days old if Calendar was not opened. D1 is kept fresh by the Worker's cron. */
export const NEXT_EVENT_STALE_MS = 10 * 60_000

/**
 * The next event, reading the Worker first when the copy is stale. A failed read leaves the copy
 * as it is, so the start screen still shows what it has.
 */
export async function freshNextCalendarEvent(
  db: LocalDatabase, api: Pick<CalendarApi, 'calendarData' | 'calendarSync'>, now: Date
): Promise<{ event: CalendarEvent; calendar: CalendarInfo } | null> {
  const meta = await cachedCalendarMeta(db)
  const fetched = meta.fetchedAt ? Date.parse(meta.fetchedAt) : 0
  if (meta.accounts.length > 0 && now.getTime() - fetched > NEXT_EVENT_STALE_MS) {
    await refreshCalendar(db, api, { sync: false, now: now.toISOString() }).catch(() => undefined)
  }
  return nextCalendarEvent(db, now.toISOString())
}
