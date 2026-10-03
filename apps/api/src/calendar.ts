import {
  CALENDAR_RETURN_URL, CALENDAR_WINDOW_FUTURE_DAYS, CALENDAR_WINDOW_PAST_DAYS,
  type ApiError, type ApiResult, type CalendarAccount, type CalendarAnswer, type CalendarConnectStart,
  type CalendarEvent, type CalendarEventDraft, type CalendarEventRef, type CalendarInfo, type CalendarRange,
  type CalendarReminder, type CalendarScope, type CalendarSeries, type CalendarSnapshot, type DeviceIdentity
} from '@ego/api-contracts'
import { splitRecurrence, untilToken } from '@ego/core'
import type { Env } from './auth'
import { decryptConnectorToken, encryptConnectorToken, fromBase64, randomUrlToken, sha256 } from './connector-crypto'
import { exchangeGoogleToken, googleCallbackUrl } from './connectors'
import {
  CALENDAR_SCOPE, GoogleCalendarError, eventSpan, forInsert, googleCalendarClient, googleEventBody, isRecord, seriesCopy,
  toCalendarEvent, toCalendarInfo,
  type CalendarEventBody, type CalendarInfoBody, type GoogleCalendarClient, type JsonRecord
} from './google-calendar'
import { daysBetween, isValidTimeZone, localClock, localDate, shiftDate, startOfLocalDay } from './google-health'
import { refreshAccessToken } from './health'
import { idTokenClaims } from './sign-in'

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_TTL_MS = 10 * 60_000
/** A run that has not finished after this long is treated as dead, so the next one may start. */
const STALE_RUN_MS = 2 * 60_000
/** Rows written by a request that overlapped the previous read would otherwise be missed. */
const READ_OVERLAP_MS = 5 * 60_000
export const DEVICE_SYNC_GAP_MS = 15_000
export const SCHEDULED_SYNC_GAP_MS = 5 * 60_000
/** A calendar is downloaded afresh once its window has fallen this far behind today's. */
const REBASE_AFTER_DAYS = 30
const EVENTS_PER_PAGE = 1000
const EVENTS_PER_STATEMENT = 150
const PARALLEL_CALENDARS = 6
const MAX_RANGE_DAYS = 62
/** Google hands out access tokens for an hour. */
const ACCESS_TOKEN_MS = 50 * 60_000

interface AccountRow {
  dataset_id: string
  id: string
  encrypted_refresh_token: string
  token_key_version: string
  granted_scopes: string
  time_zone: string | null
  last_sync_at: string | null
  sync_started_at: string | null
  sync_finished_at: string | null
  last_error: string | null
  revoked_at: string | null
}

interface StateRow {
  dataset_id: string
  pkce_verifier: string
  redirect_uri: string
  expires_at: string
  consumed_at: string | null
}

export interface ListRow {
  account_id: string
  id: string
  info: string
  sync_token: string | null
  window_from: string | null
  window_to: string | null
  updated_at: string
  deleted_at: string | null
}

interface EventRow {
  account_id: string
  calendar_id: string
  id: string
  event: string
  updated_at: string
  deleted_at: string | null
}

interface Window {
  from: string
  to: string
  timeMin: string
  timeMax: string
}

export type CalendarSyncOutcome = 'synced' | 'skipped' | 'failed' | 'not_connected'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(error: ApiError): Response {
  const status = error.code === 'CONFLICT' ? 409 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_REQUEST' ? 400
    : error.code === 'NOT_CONFIGURED' ? 503 : 502
  return json({ ok: false, error }, status)
}

function invalid<T>(message: string): ApiResult<T> {
  return { ok: false, error: { code: 'INVALID_REQUEST', message } }
}

function returnToApp(params: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `${CALENDAR_RETURN_URL}?${new URLSearchParams(params)}`, 'cache-control': 'no-store' }
  })
}

async function readBody(request: Request): Promise<JsonRecord> {
  try {
    const body: unknown = await request.json()
    return isRecord(body) ? body : {}
  } catch {
    return {}
  }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) } catch { return null }
}

function stamp(): string {
  return new Date().toISOString()
}

function zoneOf(row: Pick<AccountRow, 'time_zone'> | null): string {
  return row?.time_zone && isValidTimeZone(row.time_zone) ? row.time_zone : 'UTC'
}

function windowFor(nowMs: number, timeZone: string): Window {
  const today = localDate(nowMs, timeZone)
  const from = shiftDate(today, -CALENDAR_WINDOW_PAST_DAYS)
  const to = shiftDate(today, CALENDAR_WINDOW_FUTURE_DAYS)
  return {
    from,
    to,
    timeMin: new Date(startOfLocalDay(from, timeZone)).toISOString(),
    timeMax: new Date(startOfLocalDay(shiftDate(to, 1), timeZone)).toISOString()
  }
}

function readAccount(env: Env, datasetId: string, accountId: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM calendar_accounts WHERE dataset_id = ? AND id = ?').bind(datasetId, accountId).first<AccountRow>()
}

async function readLists(env: Env, datasetId: string, accountId: string): Promise<ListRow[]> {
  const rows = await env.DB.prepare(`SELECT account_id, id, info, sync_token, window_from, window_to, updated_at, deleted_at
    FROM calendar_lists WHERE dataset_id = ? AND account_id = ? AND deleted_at IS NULL`).bind(datasetId, accountId).all<ListRow>()
  return rows.results ?? []
}

export function infoOf(row: ListRow): CalendarInfo | null {
  const info = parseJson(row.info)
  if (!isRecord(info) || typeof info.id !== 'string') return null
  return { ...(info as unknown as CalendarInfoBody), deleted: row.deleted_at !== null, updatedAt: row.updated_at }
}

export function eventOf(row: Pick<EventRow, 'event' | 'updated_at' | 'deleted_at'>): CalendarEvent | null {
  const event = parseJson(row.event)
  if (!isRecord(event) || typeof event.key !== 'string') return null
  return { ...(event as unknown as CalendarEventBody), deleted: row.deleted_at !== null, updatedAt: row.updated_at }
}

// Connecting --------------------------------------------------------------------------------------

export async function startCalendarConnect(request: Request, env: Env, device: DeviceIdentity, now = new Date()): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CONNECTOR_TOKEN_KEY) {
    return failure({ code: 'NOT_CONFIGURED', message: 'Google is not set up on the server' })
  }
  const body = await readBody(request)
  const nowIso = now.toISOString()
  await env.DB.prepare('DELETE FROM calendar_oauth_states WHERE expires_at <= ?').bind(nowIso).run()
  const state = randomUrlToken()
  const verifier = randomUrlToken(48)
  const redirectUri = googleCallbackUrl(request, env)
  const expiresAt = new Date(now.getTime() + OAUTH_TTL_MS).toISOString()
  await env.DB.prepare(`INSERT INTO calendar_oauth_states
    (state_hash, dataset_id, device_id, pkce_verifier, redirect_uri, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), device.datasetId, device.deviceId, verifier, redirectUri, expiresAt, nowIso).run()
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ['openid', 'email', CALENDAR_SCOPE].join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    include_granted_scopes: 'false'
  })
  if (body.another !== true) {
    const owner = await env.DB.prepare('SELECT account_email FROM devices WHERE id = ?')
      .bind(device.deviceId).first<{ account_email: string | null }>()
    if (owner?.account_email) params.set('login_hint', owner.account_email)
  }
  const data: CalendarConnectStart = { authorizationUrl: `${GOOGLE_AUTHORIZE}?${params}`, expiresAt }
  return json({ ok: true, data })
}

/**
 * Calendar shares the Google redirect URI with sign-in, Health, and the Gmail connector. Returns
 * null when the state belongs to one of those.
 */
export async function completeCalendarConnect(request: Request, env: Env, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  if (!state) return null
  const stateHash = await sha256(state)
  const row = await env.DB.prepare(`SELECT dataset_id, pkce_verifier, redirect_uri, expires_at, consumed_at
    FROM calendar_oauth_states WHERE state_hash = ?`).bind(stateHash).first<StateRow>()
  if (!row) return null
  const nowIso = now.toISOString()
  const claimed = await env.DB.prepare(`UPDATE calendar_oauth_states SET consumed_at = ?
    WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`).bind(nowIso, stateHash, nowIso).run()
  if ((claimed.meta.changes ?? 0) !== 1) return returnToApp({ error: 'expired' })
  const code = url.searchParams.get('code')
  if (url.searchParams.has('error') || !code) return returnToApp({ error: 'cancelled' })
  const token = await exchangeGoogleToken(new URLSearchParams({
    code,
    redirect_uri: row.redirect_uri,
    grant_type: 'authorization_code',
    code_verifier: row.pkce_verifier
  }), env)
  if (!token?.refresh_token) return returnToApp({ error: 'failed' })
  const scopes = [...new Set((token.scope ?? '').split(/\s+/).filter(Boolean))].sort()
  if (!scopes.includes(CALENDAR_SCOPE)) return returnToApp({ error: 'no_access' })
  const claims = token.id_token ? idTokenClaims(token.id_token) : null
  const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : null
  if (!email) return returnToApp({ error: 'failed' })
  const protectedToken = await encryptConnectorToken(token.refresh_token, env)
  await env.DB.prepare(`INSERT INTO calendar_accounts
    (dataset_id, id, encrypted_refresh_token, token_key_version, granted_scopes, created_at, updated_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(dataset_id, id) DO UPDATE SET
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_key_version = excluded.token_key_version,
      granted_scopes = excluded.granted_scopes,
      sync_started_at = NULL,
      last_error = NULL,
      updated_at = excluded.updated_at,
      revoked_at = NULL`)
    .bind(row.dataset_id, email, protectedToken.encrypted, protectedToken.keyVersion, JSON.stringify(scopes), nowIso, nowIso).run()
  accessTokens.delete(`${row.dataset_id}/${email}`)
  return returnToApp({ connected: '1' })
}

/** Takes the account's calendars and events off every device and forgets the grant. */
export async function disconnectCalendar(env: Env, datasetId: string, accountId: string): Promise<void> {
  const row = await readAccount(env, datasetId, accountId)
  if (row && !row.revoked_at) {
    try {
      const token = await decryptConnectorToken(row.encrypted_refresh_token, env)
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token })
      })
    } catch {
      // The local removal still wins if Google is offline or already dropped the grant.
    }
  }
  const now = stamp()
  accessTokens.delete(`${datasetId}/${accountId}`)
  await env.DB.batch([
    env.DB.prepare(`UPDATE calendar_events SET deleted_at = ?, updated_at = ?
      WHERE dataset_id = ? AND account_id = ? AND deleted_at IS NULL`).bind(now, now, datasetId, accountId),
    env.DB.prepare(`UPDATE calendar_lists SET deleted_at = ?, updated_at = ?, sync_token = NULL, window_from = NULL, window_to = NULL
      WHERE dataset_id = ? AND account_id = ?`).bind(now, now, datasetId, accountId),
    env.DB.prepare('DELETE FROM calendar_accounts WHERE dataset_id = ? AND id = ?').bind(datasetId, accountId)
  ])
}

// Access ------------------------------------------------------------------------------------------

/** Kept for the isolate's life, so a run of drags does not refresh the token each time. */
const accessTokens = new Map<string, { token: string; expiresAt: number }>()

type Access = { ok: true; client: GoogleCalendarClient; account: AccountRow } | { ok: false; error: ApiError }

async function markRevoked(env: Env, row: AccountRow, message: string): Promise<void> {
  const now = stamp()
  await env.DB.prepare(`UPDATE calendar_accounts SET revoked_at = ?, last_error = ?, updated_at = ?
    WHERE dataset_id = ? AND id = ?`).bind(now, message, now, row.dataset_id, row.id).run()
}

async function accessFor(env: Env, row: AccountRow): Promise<Access> {
  const cacheKey = `${row.dataset_id}/${row.id}`
  const cached = accessTokens.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return { ok: true, client: googleCalendarClient(cached.token), account: row }
  let refreshToken: string
  try {
    refreshToken = await decryptConnectorToken(row.encrypted_refresh_token, env)
  } catch {
    await markRevoked(env, row, 'The server cannot read the saved Google Calendar access. Connect again.')
    return { ok: false, error: { code: 'UPSTREAM_ERROR', message: `Connect ${row.id} again in Calendar settings.` } }
  }
  const refreshed = await refreshAccessToken(env, refreshToken)
  if (!refreshed.ok) {
    if (refreshed.revoked) {
      await markRevoked(env, row, 'Google Calendar access ended. Connect again.')
      return { ok: false, error: { code: 'UPSTREAM_ERROR', message: `Google Calendar access for ${row.id} ended. Connect it again in Calendar settings.` } }
    }
    return { ok: false, error: { code: 'UPSTREAM_ERROR', message: 'Google did not renew Calendar access. Try again.' } }
  }
  if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
    const rotated = await encryptConnectorToken(refreshed.refreshToken, env)
    await env.DB.prepare(`UPDATE calendar_accounts SET encrypted_refresh_token = ?, token_key_version = ?
      WHERE dataset_id = ? AND id = ?`).bind(rotated.encrypted, rotated.keyVersion, row.dataset_id, row.id).run()
  }
  accessTokens.set(cacheKey, { token: refreshed.accessToken, expiresAt: Date.now() + ACCESS_TOKEN_MS })
  return { ok: true, client: googleCalendarClient(refreshed.accessToken), account: row }
}

async function accessForAccount(env: Env, datasetId: string, accountId: unknown): Promise<Access> {
  if (typeof accountId !== 'string') return { ok: false, error: { code: 'INVALID_REQUEST', message: 'accountId is missing' } }
  const row = await readAccount(env, datasetId, accountId)
  if (!row || row.revoked_at) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `${accountId} is not connected to Calendar. Connect it in Calendar settings.` } }
  }
  return accessFor(env, row)
}

// Syncing -----------------------------------------------------------------------------------------

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

async function inParallel<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await work(item)
    }
  })
  await Promise.all(lanes)
}

function eventStatements(
  db: D1Database, datasetId: string, accountId: string, calendarId: string, events: readonly CalendarEventBody[], now: string
): D1PreparedStatement[] {
  return chunks(events, EVENTS_PER_STATEMENT).map((part) => {
    const rows = part.map((event) => ({ id: event.id, ...eventSpan(event), googleUpdated: event.googleUpdated, event }))
    return db.prepare(`INSERT INTO calendar_events
      (dataset_id, account_id, calendar_id, id, starts_at, ends_at, google_updated, event, updated_at, deleted_at)
      SELECT ?, ?, ?, json_extract(value, '$.id'), json_extract(value, '$.startsAt'), json_extract(value, '$.endsAt'),
        json_extract(value, '$.googleUpdated'), json_extract(value, '$.event'), ?, NULL
      FROM json_each(?) WHERE true
      ON CONFLICT(dataset_id, account_id, calendar_id, id) DO UPDATE SET
        starts_at = excluded.starts_at, ends_at = excluded.ends_at, google_updated = excluded.google_updated,
        event = excluded.event, updated_at = excluded.updated_at, deleted_at = NULL
      WHERE excluded.google_updated >= calendar_events.google_updated
        AND (calendar_events.deleted_at IS NOT NULL OR calendar_events.event IS NOT excluded.event)`)
      .bind(datasetId, accountId, calendarId, now, JSON.stringify(rows))
  })
}

function removeStatement(db: D1Database, datasetId: string, accountId: string, calendarId: string, ids: readonly string[], now: string): D1PreparedStatement {
  return db.prepare(`UPDATE calendar_events SET deleted_at = ?, updated_at = ?
    WHERE dataset_id = ? AND account_id = ? AND calendar_id = ? AND deleted_at IS NULL
      AND id IN (SELECT value FROM json_each(?))`).bind(now, now, datasetId, accountId, calendarId, JSON.stringify(ids))
}

function insideWindow(event: CalendarEventBody, window: Pick<ListRow, 'window_from' | 'window_to'>): boolean {
  if (!window.window_from || !window.window_to) return true
  const span = eventSpan(event)
  return span.endsAt > `${shiftDate(window.window_from, -1)}T00:00:00.000Z` && span.startsAt < `${shiftDate(window.window_to, 2)}T00:00:00.000Z`
}

/**
 * Brings one calendar's events into D1: the changes since its sync token, or the whole window when
 * it has none, Google expired it, or the window fell behind. Returns Google's refusal, if any.
 */
async function syncCalendar(
  env: Env, datasetId: string, accountId: string, client: GoogleCalendarClient, list: ListRow, target: Window, name: string
): Promise<string | null> {
  const rebase = !list.sync_token || !list.window_to || list.window_to < shiftDate(target.to, -REBASE_AFTER_DAYS)
  try {
    if (!rebase && list.sync_token) {
      try {
        const page = await client.listEvents(list.id, { syncToken: list.sync_token })
        const kept: CalendarEventBody[] = []
        const removed: string[] = []
        for (const item of page.items) {
          const event = toCalendarEvent(accountId, list.id, item)
          if (event && insideWindow(event, list)) kept.push(event)
          else if (typeof item.id === 'string') removed.push(item.id)
        }
        const now = stamp()
        await env.DB.batch([
          ...eventStatements(env.DB, datasetId, accountId, list.id, kept, now),
          ...(removed.length > 0 ? [removeStatement(env.DB, datasetId, accountId, list.id, removed, now)] : []),
          env.DB.prepare('UPDATE calendar_lists SET sync_token = ? WHERE dataset_id = ? AND account_id = ? AND id = ?')
            .bind(page.nextSyncToken ?? list.sync_token, datasetId, accountId, list.id)
        ])
        return null
      } catch (error: unknown) {
        if (!(error instanceof GoogleCalendarError && error.status === 410)) throw error
      }
    }
    const page = await client.listEvents(list.id, { timeMin: target.timeMin, timeMax: target.timeMax })
    const events = page.items.flatMap((item) => {
      const event = toCalendarEvent(accountId, list.id, item)
      return event ? [event] : []
    })
    const now = stamp()
    await env.DB.batch([
      ...eventStatements(env.DB, datasetId, accountId, list.id, events, now),
      env.DB.prepare(`UPDATE calendar_events SET deleted_at = ?, updated_at = ?
        WHERE dataset_id = ? AND account_id = ? AND calendar_id = ? AND deleted_at IS NULL
          AND id NOT IN (SELECT value FROM json_each(?))`)
        .bind(now, now, datasetId, accountId, list.id, JSON.stringify(events.map((event) => event.id))),
      env.DB.prepare(`UPDATE calendar_lists SET sync_token = ?, window_from = ?, window_to = ?
        WHERE dataset_id = ? AND account_id = ? AND id = ?`)
        .bind(page.nextSyncToken, target.from, target.to, datasetId, accountId, list.id)
    ])
    return null
  } catch (error: unknown) {
    if (error instanceof GoogleCalendarError && error.status !== 401) {
      return `${name}${error.detail ? ` (${error.detail.slice(0, 120)})` : ''}`
    }
    throw error
  }
}

/** Writes the calendar list and returns the calendars still in it. */
async function saveCalendarList(env: Env, datasetId: string, accountId: string, entries: readonly JsonRecord[]): Promise<ListRow[]> {
  const infos = entries
    .filter((entry) => entry.hidden !== true && entry.deleted !== true)
    .flatMap((entry) => {
      const info = toCalendarInfo(accountId, entry)
      return info ? [info] : []
    })
  const ids = infos.map((info) => info.id)
  const now = stamp()
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO calendar_lists (dataset_id, account_id, id, info, updated_at, deleted_at)
      SELECT ?, ?, json_extract(value, '$.id'), json_extract(value, '$.info'), ?, NULL
      FROM json_each(?) WHERE true
      ON CONFLICT(dataset_id, account_id, id) DO UPDATE SET info = excluded.info, updated_at = excluded.updated_at, deleted_at = NULL
      WHERE calendar_lists.deleted_at IS NOT NULL OR calendar_lists.info IS NOT excluded.info`)
      .bind(datasetId, accountId, now, JSON.stringify(infos.map((info) => ({ id: info.id, info })))),
    env.DB.prepare(`UPDATE calendar_events SET deleted_at = ?, updated_at = ?
      WHERE dataset_id = ? AND account_id = ? AND deleted_at IS NULL AND calendar_id NOT IN (SELECT value FROM json_each(?))`)
      .bind(now, now, datasetId, accountId, JSON.stringify(ids)),
    env.DB.prepare(`UPDATE calendar_lists SET deleted_at = ?, updated_at = ?, sync_token = NULL, window_from = NULL, window_to = NULL
      WHERE dataset_id = ? AND account_id = ? AND deleted_at IS NULL AND id NOT IN (SELECT value FROM json_each(?))`)
      .bind(now, now, datasetId, accountId, JSON.stringify(ids))
  ])
  return readLists(env, datasetId, accountId)
}

function problemFor(error: unknown): string {
  if (!(error instanceof GoogleCalendarError)) return 'The Google Calendar sync stopped unexpectedly. The next sync tries again.'
  if (error.status === 401 || error.status === 403) return 'Google Calendar refused a request. Connect the account again.'
  if (error.status === 429) return 'Google Calendar asked Ego to slow down. The next sync tries again.'
  if (error.status === 0) return 'Google Calendar did not answer. The next sync tries again.'
  return `${error.message}${error.detail ? ` (${error.detail.slice(0, 160)})` : ''}. The next sync tries again.`
}

/** Cron and devices both call this; the `sync_started_at` swap lets one run per account at a time. */
export async function syncCalendarAccount(
  env: Env, datasetId: string, accountId: string, now: Date, options: { minimumGapMs: number }
): Promise<CalendarSyncOutcome> {
  const row = await readAccount(env, datasetId, accountId)
  if (!row || row.revoked_at) return 'not_connected'
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const startedMs = row.sync_started_at ? Date.parse(row.sync_started_at) : 0
  const finishedMs = row.sync_finished_at ? Date.parse(row.sync_finished_at) : 0
  const running = startedMs > finishedMs && nowMs - startedMs < STALE_RUN_MS
  if (running || (finishedMs > 0 && nowMs - finishedMs < options.minimumGapMs)) return 'skipped'
  const claimed = await env.DB.prepare(`UPDATE calendar_accounts SET sync_started_at = ?
    WHERE dataset_id = ? AND id = ? AND sync_started_at IS ?`).bind(nowIso, datasetId, accountId, row.sync_started_at).run()
  if ((claimed.meta.changes ?? 0) !== 1) return 'skipped'

  const finish = async (lastError: string | null, timeZone: string | null): Promise<void> => {
    await env.DB.prepare(`UPDATE calendar_accounts SET last_error = ?, sync_finished_at = ?, updated_at = ?,
      time_zone = COALESCE(?, time_zone), last_sync_at = CASE WHEN ? THEN ? ELSE last_sync_at END
      WHERE dataset_id = ? AND id = ?`)
      .bind(lastError, nowIso, stamp(), timeZone, lastError === null ? 1 : 0, nowIso, datasetId, accountId).run()
  }

  const access = await accessFor(env, row)
  if (!access.ok) {
    await finish(access.error.message, null)
    return 'failed'
  }
  try {
    const timeZone = await access.client.timeZone().catch(() => null)
    const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : zoneOf(row)
    const lists = await saveCalendarList(env, datasetId, accountId, await access.client.calendarList())
    const target = windowFor(nowMs, zone)
    const refusals: string[] = []
    await inParallel(lists, PARALLEL_CALENDARS, async (list) => {
      const name = infoOf(list)?.name ?? list.id
      const refusal = await syncCalendar(env, datasetId, accountId, access.client, list, target, name)
      if (refusal) refusals.push(refusal)
    })
    await finish(refusals.length > 0 ? `Google Calendar refused ${refusals.join(', ')}. Everything else synced.` : null, zone)
  } catch (error: unknown) {
    await finish(problemFor(error), null)
    return 'failed'
  }
  return 'synced'
}

async function accountIds(env: Env, datasetId: string): Promise<string[]> {
  const rows = await env.DB.prepare('SELECT id FROM calendar_accounts WHERE dataset_id = ? AND revoked_at IS NULL')
    .bind(datasetId).all<{ id: string }>()
  return (rows.results ?? []).map((row) => row.id)
}

export async function runScheduledCalendarSync(env: Env, now: Date): Promise<void> {
  const rows = await env.DB.prepare('SELECT dataset_id, id FROM calendar_accounts WHERE revoked_at IS NULL')
    .all<{ dataset_id: string; id: string }>()
  for (const row of rows.results ?? []) {
    await syncCalendarAccount(env, row.dataset_id, row.id, now, { minimumGapMs: SCHEDULED_SYNC_GAP_MS })
  }
}

/** Pulls one calendar's changes right after a write, so the next device read carries Google's answer. */
async function refreshCalendar(env: Env, access: Extract<Access, { ok: true }>, calendarId: string): Promise<void> {
  const lists = await readLists(env, access.account.dataset_id, access.account.id)
  const list = lists.find((item) => item.id === calendarId)
  if (!list) return
  await syncCalendar(env, access.account.dataset_id, access.account.id, access.client, list,
    windowFor(Date.now(), zoneOf(access.account)), infoOf(list)?.name ?? list.id)
}

// Reading -----------------------------------------------------------------------------------------

function encodeCursor(serverTime: string, row: Pick<EventRow, 'updated_at' | 'account_id' | 'calendar_id' | 'id'>): string {
  const bytes = new TextEncoder().encode(JSON.stringify([serverTime, row.updated_at, row.account_id, row.calendar_id, row.id]))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeCursor(value: string | null): [string, string, string, string, string] | null {
  if (!value || value.length > 2000) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64(value)))
    return Array.isArray(parsed) && parsed.length === 5 && parsed.every((part) => typeof part === 'string')
      ? parsed as [string, string, string, string, string]
      : null
  } catch {
    return null
  }
}

export async function readCalendarAccounts(env: Env, datasetId: string): Promise<CalendarAccount[]> {
  const [accounts, windows] = await Promise.all([
    env.DB.prepare('SELECT * FROM calendar_accounts WHERE dataset_id = ? ORDER BY created_at, id').bind(datasetId).all<AccountRow>(),
    env.DB.prepare(`SELECT account_id, MAX(window_from) AS window_from, MIN(window_to) AS window_to FROM calendar_lists
      WHERE dataset_id = ? AND deleted_at IS NULL AND window_from IS NOT NULL GROUP BY account_id`)
      .bind(datasetId).all<{ account_id: string; window_from: string | null; window_to: string | null }>()
  ])
  return (accounts.results ?? []).map((row) => {
    const window = (windows.results ?? []).find((item) => item.account_id === row.id)
    return {
      id: row.id,
      connected: row.revoked_at === null,
      timeZone: row.time_zone,
      lastSyncAt: row.last_sync_at,
      lastError: row.last_error,
      windowFrom: window?.window_from ?? null,
      windowTo: window?.window_to ?? null
    }
  })
}

export async function readCalendarSnapshot(
  env: Env, datasetId: string, since: string | null, cursorText: string | null, now: Date
): Promise<CalendarSnapshot> {
  const cursor = decodeCursor(cursorText)
  const serverTime = cursor?.[0] ?? now.toISOString()
  const sinceMs = since ? Date.parse(since) : Number.NaN
  const floor = Number.isFinite(sinceMs) ? new Date(sinceMs - READ_OVERLAP_MS).toISOString() : ''
  const after = cursor
    ? `AND (updated_at, account_id, calendar_id, id) > (?, ?, ?, ?)`
    : ''
  const [accounts, lists, events] = await Promise.all([
    readCalendarAccounts(env, datasetId),
    cursor ? Promise.resolve(null) : env.DB.prepare(`SELECT account_id, id, info, sync_token, window_from, window_to, updated_at, deleted_at
      FROM calendar_lists WHERE dataset_id = ? AND updated_at >= ? AND (deleted_at IS NULL OR ? = 1)`)
      .bind(datasetId, floor, floor ? 1 : 0).all<ListRow>(),
    env.DB.prepare(`SELECT account_id, calendar_id, id, event, updated_at, deleted_at FROM calendar_events
      WHERE dataset_id = ? AND updated_at >= ? AND (deleted_at IS NULL OR ? = 1) ${after}
      ORDER BY updated_at, account_id, calendar_id, id LIMIT ?`)
      .bind(datasetId, floor, floor ? 1 : 0, ...(cursor ? cursor.slice(1) : []), EVENTS_PER_PAGE + 1).all<EventRow>()
  ])
  const rows = events.results ?? []
  const page = rows.slice(0, EVENTS_PER_PAGE)
  const last = page[page.length - 1]
  return {
    accounts,
    calendars: (lists?.results ?? []).flatMap((row) => {
      const info = infoOf(row)
      return info ? [info] : []
    }),
    events: page.flatMap((row) => {
      const event = eventOf(row)
      return event ? [event] : []
    }),
    cursor: rows.length > EVENTS_PER_PAGE && last ? encodeCursor(serverTime, last) : null,
    serverTime
  }
}

/** Events of the selected calendars overlapping [from, to), from D1. */
export async function readStoredEvents(env: Env, datasetId: string, fromIso: string, toIso: string): Promise<CalendarEvent[]> {
  const rows = await env.DB.prepare(`SELECT e.account_id, e.calendar_id, e.id, e.event, e.updated_at, e.deleted_at
    FROM calendar_events e JOIN calendar_lists l
      ON l.dataset_id = e.dataset_id AND l.account_id = e.account_id AND l.id = e.calendar_id
    WHERE e.dataset_id = ? AND e.deleted_at IS NULL AND l.deleted_at IS NULL
      AND json_extract(l.info, '$.selected') = 1 AND e.starts_at < ? AND e.ends_at > ?
    ORDER BY e.starts_at`).bind(datasetId, toIso, fromIso).all<EventRow>()
  return (rows.results ?? []).flatMap((row) => {
    const event = eventOf(row)
    return event ? [event] : []
  })
}

export async function readCalendarInfos(env: Env, datasetId: string): Promise<CalendarInfo[]> {
  const rows = await env.DB.prepare(`SELECT account_id, id, info, sync_token, window_from, window_to, updated_at, deleted_at
    FROM calendar_lists WHERE dataset_id = ? AND deleted_at IS NULL`).bind(datasetId).all<ListRow>()
  return (rows.results ?? []).flatMap((row) => {
    const info = infoOf(row)
    return info ? [info] : []
  })
}

/**
 * Weeks outside the stored window, read live from Google and kept nowhere. Dates are the device's
 * own days; the range is widened by a day each side so no zone loses an event.
 */
export async function readLiveRange(env: Env, datasetId: string, from: string, to: string): Promise<ApiResult<CalendarRange>> {
  if (daysBetween(from, to) > MAX_RANGE_DAYS || from > to) return invalid(`Ask for at most ${MAX_RANGE_DAYS} days at a time`)
  const timeMin = `${shiftDate(from, -1)}T00:00:00.000Z`
  const timeMax = `${shiftDate(to, 2)}T00:00:00.000Z`
  const infos = (await readCalendarInfos(env, datasetId)).filter((info) => info.selected)
  const events: CalendarEvent[] = []
  for (const accountId of await accountIds(env, datasetId)) {
    const access = await accessForAccount(env, datasetId, accountId)
    if (!access.ok) continue
    await inParallel(infos.filter((info) => info.accountId === accountId), PARALLEL_CALENDARS, async (info) => {
      try {
        const page = await access.client.listEvents(info.id, { timeMin, timeMax })
        const now = stamp()
        for (const item of page.items) {
          const event = toCalendarEvent(accountId, info.id, item)
          if (event) events.push({ ...event, deleted: false, updatedAt: now })
        }
      } catch {
        // A calendar Google refuses is left out; the rest still load.
      }
    })
  }
  return { ok: true, data: { events } }
}

// Writing -----------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !DATE.test(value) && Number.isFinite(Date.parse(value))
}

function isMoment(value: unknown): value is string {
  return typeof value === 'string' && (DATE.test(value) || isInstant(value))
}

function optionalText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= max)
}

function isReminders(value: unknown): value is { useDefault: boolean; overrides: CalendarReminder[] } {
  if (!isRecord(value) || typeof value.useDefault !== 'boolean' || !Array.isArray(value.overrides)) return false
  return value.overrides.length <= 5 && value.overrides.every((item) => isRecord(item) &&
    (item.method === 'popup' || item.method === 'email') &&
    typeof item.minutes === 'number' && Number.isInteger(item.minutes) && item.minutes >= 0 && item.minutes <= 40320)
}

/** Checks every field present, so the change can go to Google as it is. Returns why not, or null. */
export function draftProblem(changes: JsonRecord): string | null {
  const checks: Array<[keyof CalendarEventDraft, (value: unknown) => boolean]> = [
    ['title', (value) => typeof value === 'string' && value.length <= 1024],
    ['description', (value) => optionalText(value, 8192)],
    ['location', (value) => optionalText(value, 1024)],
    ['allDay', (value) => typeof value === 'boolean'],
    ['start', isMoment],
    ['end', isMoment],
    ['timeZone', (value) => value === null || isValidTimeZone(value)],
    ['recurrence', (value) => Array.isArray(value) && value.length <= 10 &&
      value.every((line) => typeof line === 'string' && line.length <= 500 && /^(RRULE|EXRULE|RDATE|EXDATE)[:;]/.test(line))],
    ['colorId', (value) => value === null || (typeof value === 'string' && /^(?:[1-9]|1[01])$/.test(value))],
    ['attendees', (value) => Array.isArray(value) && value.length <= 200 &&
      value.every((item) => isRecord(item) && typeof item.email === 'string' && EMAIL.test(item.email) && typeof item.optional === 'boolean')],
    ['meet', (value) => value === null || typeof value === 'boolean'],
    ['reminders', isReminders],
    ['transparency', (value) => value === 'opaque' || value === 'transparent'],
    ['visibility', (value) => value === 'default' || value === 'public' || value === 'private' || value === 'confidential'],
    ['guestsCanModify', (value) => typeof value === 'boolean'],
    ['guestsCanInviteOthers', (value) => typeof value === 'boolean'],
    ['guestsCanSeeOtherGuests', (value) => typeof value === 'boolean']
  ]
  for (const [field, check] of checks) {
    if (changes[field] !== undefined && !check(changes[field])) return `Check the event's ${field}`
  }
  const { start, end, allDay } = changes
  if (typeof start === 'string' && typeof end === 'string') {
    if (DATE.test(start) !== DATE.test(end)) return 'Start and end must both be days or both be times'
    if (allDay === true && !DATE.test(start)) return 'An all-day event takes days'
    if (allDay === false && DATE.test(start)) return 'A timed event takes times'
    if ((DATE.test(start) ? end <= start : Date.parse(end) <= Date.parse(start))) return 'The event must end after it starts'
  }
  return null
}

function pickDraft(changes: JsonRecord): Partial<CalendarEventDraft> {
  const picked: JsonRecord = {}
  for (const field of [
    'title', 'description', 'location', 'allDay', 'start', 'end', 'timeZone', 'recurrence', 'colorId', 'attendees', 'meet',
    'reminders', 'transparency', 'visibility', 'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests'
  ]) {
    if (changes[field] !== undefined) picked[field] = changes[field]
  }
  return picked as Partial<CalendarEventDraft>
}

function writeError(error: unknown): ApiError {
  if (!(error instanceof GoogleCalendarError)) return { code: 'SERVER_ERROR', message: 'Ego could not finish that change. Try again.' }
  const detail = error.detail ? ` Google said: ${error.detail}` : ''
  switch (error.status) {
    case 412: return { code: 'CONFLICT', message: 'This event changed in Google since Ego last synced. Ego loaded the new version; make the change again.' }
    case 404:
    case 410: return { code: 'NOT_FOUND', message: 'This event is no longer in Google Calendar.' }
    case 400: return { code: 'INVALID_REQUEST', message: `Google Calendar refused the change.${detail}` }
    case 403: return { code: 'UPSTREAM_ERROR', message: `Google Calendar does not allow that change.${detail}` }
    case 0: return { code: 'UPSTREAM_ERROR', message: 'Google Calendar did not answer. Try again.' }
    default: return { code: 'UPSTREAM_ERROR', message: `Google Calendar answered ${error.status}.${detail}` }
  }
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

interface Moment {
  allDay: boolean
  /** YYYY-MM-DD for a day, or an ISO instant. */
  value: string
  timeZone: string | null
}

function momentOf(value: unknown): Moment | null {
  if (!isRecord(value)) return null
  if (typeof value.date === 'string' && DATE.test(value.date)) {
    return { allDay: true, value: value.date, timeZone: typeof value.timeZone === 'string' ? value.timeZone : null }
  }
  if (isInstant(value.dateTime)) {
    return { allDay: false, value: new Date(value.dateTime).toISOString(), timeZone: typeof value.timeZone === 'string' ? value.timeZone : null }
  }
  return null
}

function dayOf(moment: Moment, timeZone: string): string {
  return moment.allDay ? moment.value : localDate(Date.parse(moment.value), timeZone)
}

function momentBody(value: string, allDay: boolean, timeZone: string): JsonRecord {
  return allDay ? { date: value, dateTime: null } : { dateTime: value, timeZone, date: null }
}

/**
 * Moving one occurrence for the whole series moves the series' first event by the same number of
 * days, at the new clock time and length.
 */
function seriesTimes(master: JsonRecord, before: Moment, next: { allDay: boolean; start: string; end: string }, zone: string): JsonRecord | null {
  const first = momentOf(master.start)
  if (!first) return null
  const timeZone = first.timeZone && isValidTimeZone(first.timeZone) ? first.timeZone : zone
  const startDay = shiftDate(dayOf(first, timeZone), daysBetween(dayOf(before, timeZone), next.allDay ? next.start : localDate(Date.parse(next.start), timeZone)))
  if (next.allDay) {
    return {
      start: momentBody(startDay, true, timeZone),
      end: momentBody(shiftDate(startDay, daysBetween(next.start, next.end)), true, timeZone)
    }
  }
  const startMs = startOfLocalDay(startDay, timeZone) + localClock(Date.parse(next.start), timeZone).minute * 60_000
  return {
    start: momentBody(new Date(startMs).toISOString(), false, timeZone),
    end: momentBody(new Date(startMs + Date.parse(next.end) - Date.parse(next.start)).toISOString(), false, timeZone)
  }
}

/** The occurrence's times after the change, falling back to where it is now. */
function nextTimes(instance: JsonRecord, changes: Partial<CalendarEventDraft>): { allDay: boolean; start: string; end: string } | null {
  const start = momentOf(instance.start)
  const end = momentOf(instance.end)
  if (!start || !end) return null
  return {
    allDay: changes.allDay ?? (changes.start ? DATE.test(changes.start) : start.allDay),
    start: changes.start ?? start.value,
    end: changes.end ?? end.value
  }
}

function withoutTimes(changes: Partial<CalendarEventDraft>): Partial<CalendarEventDraft> {
  const { start: _start, end: _end, allDay: _allDay, timeZone: _timeZone, ...rest } = changes
  return rest
}

function timedBody(times: { allDay: boolean; start: string; end: string }, zone: string): JsonRecord {
  return { start: momentBody(times.start, times.allDay, zone), end: momentBody(times.end, times.allDay, zone) }
}

/** Where a split begins: the last moment of the old series, as Google's UNTIL token. */
function untilBefore(original: Moment): string {
  return original.allDay
    ? untilToken({ date: shiftDate(original.value, -1) })
    : untilToken({ instant: new Date(Date.parse(original.value) - 1000).toISOString() })
}

function originalInstant(original: Moment, zone: string): string {
  return original.allDay ? new Date(startOfLocalDay(original.value, zone)).toISOString() : original.value
}

async function splitSeries(
  client: GoogleCalendarClient, calendarId: string, master: JsonRecord, original: Moment, zone: string
): Promise<{ ended: string[]; rest: string[] }> {
  const recurrence = stringsOf(master.recurrence)
  const counted = recurrence.some((line) => /COUNT=/.test(line))
  const before = counted ? await client.instancesBefore(calendarId, String(master.id), originalInstant(original, zone)) : 0
  return splitRecurrence(recurrence, untilBefore(original), before)
}

function isFirstOccurrence(master: JsonRecord, original: Moment | null): boolean {
  const first = momentOf(master.start)
  return !original || !first || first.value === original.value
}

export interface CalendarWriteResult {
  /** The events as Google answered, for the AI's trail. */
  events: CalendarEventBody[]
  calendars: string[]
}

type WriteOutcome = ApiResult<CalendarWriteResult>

async function settle(env: Env, access: Extract<Access, { ok: true }>, calendars: string[], work: () => Promise<JsonRecord[]>): Promise<WriteOutcome> {
  try {
    const answered = await work()
    await Promise.all([...new Set(calendars)].map((calendarId) => refreshCalendar(env, access, calendarId)))
    const events = answered.flatMap((item) => {
      const calendarId = calendars[calendars.length - 1]
      const event = toCalendarEvent(access.account.id, calendarId, item)
      return event ? [event] : []
    })
    return { ok: true, data: { events, calendars } }
  } catch (error: unknown) {
    const problem = writeError(error)
    if (problem.code === 'CONFLICT' || problem.code === 'NOT_FOUND') {
      await Promise.all([...new Set(calendars)].map((calendarId) => refreshCalendar(env, access, calendarId).catch(() => undefined)))
    }
    return { ok: false, error: problem }
  }
}

export async function createCalendarEvent(
  env: Env, datasetId: string, input: { accountId: unknown; calendarId: unknown; draft: unknown }
): Promise<WriteOutcome> {
  if (typeof input.calendarId !== 'string' || !isRecord(input.draft)) return invalid('Choose a calendar and fill in the event')
  const problem = draftProblem(input.draft)
  if (problem) return invalid(problem)
  const draft = pickDraft(input.draft)
  if (typeof draft.start !== 'string' || typeof draft.end !== 'string') return invalid('The event needs a start and an end')
  const access = await accessForAccount(env, datasetId, input.accountId)
  if (!access.ok) return access
  const calendarId = input.calendarId
  const zone = draft.timeZone ?? zoneOf(access.account)
  const body = googleEventBody({ ...draft, timeZone: draft.allDay ? null : zone }, () => crypto.randomUUID())
  return settle(env, access, [calendarId], async () => [
    await access.client.insertEvent(calendarId, forInsert(body), { conference: true })
  ])
}

export async function updateCalendarEvent(
  env: Env, datasetId: string, input: CalendarEventRef & { etag: unknown; scope: unknown; changes: unknown; targetCalendarId: unknown }
): Promise<WriteOutcome> {
  if (typeof input.calendarId !== 'string' || typeof input.eventId !== 'string' || !isRecord(input.changes)) {
    return invalid('Choose the event to change')
  }
  const problem = draftProblem(input.changes)
  if (problem) return invalid(problem)
  const scope: CalendarScope = input.scope === 'following' || input.scope === 'all' ? input.scope : 'one'
  const changes = pickDraft(input.changes)
  const target = typeof input.targetCalendarId === 'string' && input.targetCalendarId !== input.calendarId ? input.targetCalendarId : null
  const access = await accessForAccount(env, datasetId, input.accountId)
  if (!access.ok) return access
  const { client } = access
  const calendarId = input.calendarId
  const eventId = input.eventId
  const zone = zoneOf(access.account)
  const etag = typeof input.etag === 'string' ? input.etag : null
  const calendars = target ? [calendarId, target] : [calendarId]

  return settle(env, access, calendars, async () => {
    const instance = await client.getEvent(calendarId, eventId)
    if (etag && instance.etag !== etag) throw new GoogleCalendarError('Changed in Google', 412)
    const seriesId = typeof instance.recurringEventId === 'string' ? instance.recurringEventId : null
    const times = nextTimes(instance, changes)
    const timesChanged = changes.start !== undefined || changes.end !== undefined || changes.allDay !== undefined

    if (!seriesId || scope === 'one') {
      if (target && seriesId) throw new GoogleCalendarError('Move the whole series to change its calendar', 400, 'Only a whole repeating event can move to another calendar.')
      const body = googleEventBody(withoutTimes(changes), () => crypto.randomUUID())
      if (timesChanged && times) {
        const own = momentOf(instance.start)?.timeZone
        Object.assign(body, timedBody(times, own && isValidTimeZone(own) ? own : zone))
      }
      let answer = Object.keys(body).length > 0
        ? await client.patchEvent(calendarId, eventId, body, { etag: typeof instance.etag === 'string' ? instance.etag : null, conference: true })
        : instance
      if (target) answer = await client.moveEvent(calendarId, eventId, target)
      return [answer]
    }

    const master = await client.getEvent(calendarId, seriesId)
    const original = momentOf(instance.originalStartTime)
    const before = momentOf(instance.start)
    if (scope === 'all' || isFirstOccurrence(master, original)) {
      const body = googleEventBody(withoutTimes(changes), () => crypto.randomUUID())
      if (timesChanged && times && before) Object.assign(body, seriesTimes(master, before, times, zone))
      let answer = Object.keys(body).length > 0
        ? await client.patchEvent(calendarId, seriesId, body, { etag: typeof master.etag === 'string' ? master.etag : null, conference: true })
        : master
      if (target) answer = await client.moveEvent(calendarId, seriesId, target)
      return [answer]
    }

    if (target) throw new GoogleCalendarError('Move the whole series to change its calendar', 400, 'Only a whole repeating event can move to another calendar.')
    if (!original || !times) throw new GoogleCalendarError('Unreadable occurrence', 400, 'Google sent an occurrence Ego cannot split.')
    const split = await splitSeries(client, calendarId, master, original, zone)
    const first = momentOf(master.start)
    const seriesZone = first?.timeZone && isValidTimeZone(first.timeZone) ? first.timeZone : zone
    const rest = {
      ...seriesCopy(master),
      ...googleEventBody(withoutTimes(changes), () => crypto.randomUUID()),
      ...timedBody(times, seriesZone),
      recurrence: changes.recurrence ?? split.rest
    }
    const created = await client.insertEvent(calendarId, forInsert(rest), { conference: true })
    await client.patchEvent(calendarId, seriesId, { recurrence: split.ended }, { etag: typeof master.etag === 'string' ? master.etag : null })
    return [created]
  })
}

export async function deleteCalendarEvent(
  env: Env, datasetId: string, input: CalendarEventRef & { scope: unknown }
): Promise<WriteOutcome> {
  if (typeof input.calendarId !== 'string' || typeof input.eventId !== 'string') return invalid('Choose the event to delete')
  const scope: CalendarScope = input.scope === 'following' || input.scope === 'all' ? input.scope : 'one'
  const access = await accessForAccount(env, datasetId, input.accountId)
  if (!access.ok) return access
  const { client } = access
  const calendarId = input.calendarId
  const eventId = input.eventId
  return settle(env, access, [calendarId], async () => {
    if (scope === 'one') {
      await client.deleteEvent(calendarId, eventId)
      return []
    }
    const instance = await client.getEvent(calendarId, eventId)
    const seriesId = typeof instance.recurringEventId === 'string' ? instance.recurringEventId : null
    if (!seriesId) {
      await client.deleteEvent(calendarId, eventId)
      return []
    }
    const master = await client.getEvent(calendarId, seriesId)
    const original = momentOf(instance.originalStartTime)
    if (scope === 'all' || isFirstOccurrence(master, original) || !original) {
      await client.deleteEvent(calendarId, seriesId)
      return []
    }
    const split = await splitSeries(client, calendarId, master, original, zoneOf(access.account))
    await client.patchEvent(calendarId, seriesId, { recurrence: split.ended }, { etag: typeof master.etag === 'string' ? master.etag : null })
    return []
  })
}

/** Brings back a deleted event or series, for Undo. Google keeps a deleted event as cancelled for a while. */
export async function restoreCalendarEvent(env: Env, datasetId: string, input: CalendarEventRef): Promise<WriteOutcome> {
  if (typeof input.calendarId !== 'string' || typeof input.eventId !== 'string') return invalid('Choose the event to bring back')
  const access = await accessForAccount(env, datasetId, input.accountId)
  if (!access.ok) return access
  const { client } = access
  const calendarId = input.calendarId
  const eventId = input.eventId
  return settle(env, access, [calendarId], async () => [
    await client.patchEvent(calendarId, eventId, { status: 'confirmed' }, { etag: null })
  ])
}

export async function answerCalendarEvent(
  env: Env, datasetId: string, input: CalendarEventRef & { answer: unknown; comment: unknown; scope: unknown }
): Promise<WriteOutcome> {
  if (typeof input.calendarId !== 'string' || typeof input.eventId !== 'string') return invalid('Choose the event to answer')
  const answer = input.answer
  if (answer !== 'accepted' && answer !== 'tentative' && answer !== 'declined') return invalid('Answer yes, maybe, or no')
  if (!optionalText(input.comment, 1000)) return invalid('The note is too long')
  const access = await accessForAccount(env, datasetId, input.accountId)
  if (!access.ok) return access
  const { client } = access
  const calendarId = input.calendarId
  const eventId = input.eventId
  const comment = input.comment
  return settle(env, access, [calendarId], async () => {
    const instance = await client.getEvent(calendarId, eventId)
    const targetId = input.scope === 'all' && typeof instance.recurringEventId === 'string' ? instance.recurringEventId : eventId
    const current = targetId === eventId ? instance : await client.getEvent(calendarId, targetId)
    const people = Array.isArray(current.attendees) ? current.attendees.filter(isRecord) : []
    const own = people.findIndex((person) => person.self === true)
    if (own < 0) throw new GoogleCalendarError('Not a guest', 400, 'This account is not a guest of the event.')
    const mine: JsonRecord = { ...people[own], responseStatus: answer as CalendarAnswer }
    if (comment !== null) mine.comment = comment
    const attendees = current.attendeesOmitted === true ? [mine] : people.map((person, index) => index === own ? mine : person)
    return [await client.patchEvent(calendarId, targetId, { attendees }, { etag: null })]
  })
}

export async function changeCalendarListEntry(
  env: Env, datasetId: string, input: { accountId: unknown; calendarId: unknown; selected: unknown; colorId: unknown }
): Promise<ApiResult<{ changed: true }>> {
  if (typeof input.calendarId !== 'string') return invalid('Choose a calendar')
  const body: JsonRecord = {}
  if (typeof input.selected === 'boolean') body.selected = input.selected
  if (typeof input.colorId === 'string') {
    if (!/^(?:[1-9]|1\d|2[0-4])$/.test(input.colorId)) return invalid('Pick one of Google\'s calendar colors')
    body.colorId = input.colorId
  }
  if (Object.keys(body).length === 0) return invalid('Nothing to change')
  const access = await accessForAccount(env, datasetId, input.accountId)
  if (!access.ok) return access
  try {
    const entry = await access.client.patchCalendarListEntry(input.calendarId, body)
    const info = toCalendarInfo(access.account.id, entry)
    if (info) {
      await env.DB.prepare(`UPDATE calendar_lists SET info = ?, updated_at = ?
        WHERE dataset_id = ? AND account_id = ? AND id = ?`)
        .bind(JSON.stringify(info), stamp(), datasetId, access.account.id, info.id).run()
    }
    return { ok: true, data: { changed: true } }
  } catch (error: unknown) {
    return { ok: false, error: writeError(error) }
  }
}

export async function readSeries(env: Env, datasetId: string, ref: CalendarEventRef): Promise<ApiResult<CalendarSeries>> {
  const access = await accessForAccount(env, datasetId, ref.accountId)
  if (!access.ok) return access
  try {
    const master = await access.client.getEvent(ref.calendarId, ref.eventId)
    const start = momentOf(master.start)
    const end = momentOf(master.end)
    if (!start || !end) return { ok: false, error: { code: 'NOT_FOUND', message: 'Google sent a series Ego cannot read.' } }
    return { ok: true, data: { recurrence: stringsOf(master.recurrence), start: start.value, end: end.value, allDay: start.allDay, timeZone: start.timeZone } }
  } catch (error: unknown) {
    return { ok: false, error: writeError(error) }
  }
}

// Routes ------------------------------------------------------------------------------------------

function sinceOf(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null
}

async function snapshotAfter(env: Env, device: DeviceIdentity, result: ApiResult<unknown>, since: string | null): Promise<Response> {
  if (!result.ok) return failure(result.error)
  return json({ ok: true, data: await readCalendarSnapshot(env, device.datasetId, since, null, new Date()) })
}

export function calendarRoute(request: Request, env: Env, device: DeviceIdentity, path: string): Promise<Response> | null {
  if (!path.startsWith('/v1/calendar/')) return null
  const url = new URL(request.url)
  const method = request.method
  const datasetId = device.datasetId

  if (method === 'GET' && path === '/v1/calendar/data') {
    return readCalendarSnapshot(env, datasetId, sinceOf(url.searchParams.get('since')), url.searchParams.get('cursor'), new Date())
      .then((data) => json({ ok: true, data }))
  }
  if (method === 'POST' && path === '/v1/calendar/sync') {
    return (async () => {
      const body = await readBody(request)
      const cursor = typeof body.cursor === 'string' ? body.cursor : null
      if (!cursor) {
        const now = new Date()
        await Promise.all((await accountIds(env, datasetId)).map((accountId) =>
          syncCalendarAccount(env, datasetId, accountId, now, { minimumGapMs: DEVICE_SYNC_GAP_MS })))
      }
      return json({ ok: true, data: await readCalendarSnapshot(env, datasetId, sinceOf(body.since), cursor, new Date()) })
    })()
  }
  if (method === 'POST' && path === '/v1/calendar/connect') return startCalendarConnect(request, env, device)
  if (method === 'POST' && path === '/v1/calendar/disconnect') {
    return (async () => {
      const body = await readBody(request)
      if (typeof body.accountId !== 'string') return failure({ code: 'INVALID_REQUEST', message: 'Choose an account' })
      await disconnectCalendar(env, datasetId, body.accountId)
      return json({ ok: true, data: { disconnected: true } })
    })()
  }
  if (method === 'GET' && path === '/v1/calendar/range') {
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    if (!DATE.test(from) || !DATE.test(to)) return Promise.resolve(failure({ code: 'INVALID_REQUEST', message: 'from and to must be YYYY-MM-DD dates' }))
    return readLiveRange(env, datasetId, from, to).then((result) => result.ok ? json({ ok: true, data: result.data }) : failure(result.error))
  }
  if (method === 'GET' && path === '/v1/calendar/series') {
    const ref = {
      accountId: url.searchParams.get('account') ?? '',
      calendarId: url.searchParams.get('calendar') ?? '',
      eventId: url.searchParams.get('event') ?? ''
    }
    return readSeries(env, datasetId, ref).then((result) => result.ok ? json({ ok: true, data: result.data }) : failure(result.error))
  }

  const writes: Record<string, (body: JsonRecord) => Promise<ApiResult<unknown>>> = {
    'POST /v1/calendar/events': (body) => createCalendarEvent(env, datasetId, { accountId: body.accountId, calendarId: body.calendarId, draft: body.draft }),
    'PATCH /v1/calendar/events': (body) => updateCalendarEvent(env, datasetId, {
      accountId: String(body.accountId ?? ''), calendarId: String(body.calendarId ?? ''), eventId: String(body.eventId ?? ''),
      etag: body.etag, scope: body.scope, changes: body.changes, targetCalendarId: body.targetCalendarId
    }),
    'POST /v1/calendar/events/delete': (body) => deleteCalendarEvent(env, datasetId, {
      accountId: String(body.accountId ?? ''), calendarId: String(body.calendarId ?? ''), eventId: String(body.eventId ?? ''), scope: body.scope
    }),
    'POST /v1/calendar/events/restore': (body) => restoreCalendarEvent(env, datasetId, {
      accountId: String(body.accountId ?? ''), calendarId: String(body.calendarId ?? ''), eventId: String(body.eventId ?? '')
    }),
    'POST /v1/calendar/rsvp': (body) => answerCalendarEvent(env, datasetId, {
      accountId: String(body.accountId ?? ''), calendarId: String(body.calendarId ?? ''), eventId: String(body.eventId ?? ''),
      answer: body.answer, comment: body.comment ?? null, scope: body.scope
    }),
    'PATCH /v1/calendar/lists': (body) => changeCalendarListEntry(env, datasetId, {
      accountId: body.accountId, calendarId: body.calendarId, selected: body.selected, colorId: body.colorId
    })
  }
  const write = writes[`${method} ${path}`]
  if (!write) return null
  return (async () => {
    const body = await readBody(request)
    return snapshotAfter(env, device, await write(body), sinceOf(body.since))
  })()
}
