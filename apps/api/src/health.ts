import {
  HEALTH_HEART_CURVE_DAYS,
  HEALTH_HISTORY_DAYS,
  HEALTH_RETURN_URL,
  type DeviceIdentity,
  type HealthConnectStart,
  type HealthConnection,
  type HealthDay,
  type HealthDevice,
  type HealthGrants,
  type HealthHeartDay,
  type HealthSleep,
  type HealthSleepStage,
  type HealthSnapshot
} from '@ego/api-contracts'
import type { Env } from './auth'
import { decryptConnectorToken, encryptConnectorToken, randomUrlToken, sha256 } from './connector-crypto'
import { exchangeGoogleToken, googleCallbackUrl } from './connectors'
import {
  GoogleHealthError, HEALTH_SCOPES, ROLLUP_COLUMNS, SUMMARY_COLUMNS,
  bucketHeartRate, datesIn, googleHealthClient, isValidTimeZone, localDate, shiftDate, startOfLocalDay,
  type DailyRollupName, type DailySummaryName, type DayColumn, type DayValues, type GoogleHealthClient,
  type SleepRow
} from './google-health'
import { idTokenClaims } from './sign-in'

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const OAUTH_TTL_MS = 10 * 60_000
/** Google files a late band sync under the day it was recorded, so recent days are read again each run. */
const RECENT_DAYS = 10
/** Six calorie requests of fourteen days each, which keeps one run well under the Worker's subrequest cap. */
const BACKFILL_DAYS = 84
/** A run that has not finished after this long is treated as dead, so the next one may start. */
const STALE_RUN_MS = 2 * 60_000
/** Rows written by a sync that overlapped the previous read would otherwise be missed. */
const READ_OVERLAP_MS = 15 * 60_000
export const PHONE_SYNC_GAP_MS = 60_000
export const SCHEDULED_SYNC_GAP_MS = 5 * 60_000

const DAY_COLUMNS: readonly DayColumn[] = [
  'steps', 'distance_m', 'calories_kcal', 'fat_burn_minutes', 'cardio_minutes', 'peak_minutes',
  'resting_hr', 'hrv_ms', 'hr_min', 'hr_avg', 'hr_max', 'weight_kg'
]

interface ConnectionRow {
  dataset_id: string
  encrypted_refresh_token: string
  granted_scopes: string
  account_label: string | null
  time_zone: string | null
  device: string | null
  history_from: string | null
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

interface DayRow {
  date: string
  steps: number | null
  distance_m: number | null
  calories_kcal: number | null
  fat_burn_minutes: number | null
  cardio_minutes: number | null
  peak_minutes: number | null
  resting_hr: number | null
  hrv_ms: number | null
  hr_min: number | null
  hr_avg: number | null
  hr_max: number | null
  weight_kg: number | null
  updated_at: string
}

interface SleepDbRow {
  id: string
  date: string
  start_time: string
  end_time: string
  start_local: string
  end_local: string
  minutes_asleep: number
  minutes_awake: number
  minutes_in_bed: number
  deep_minutes: number | null
  light_minutes: number | null
  rem_minutes: number | null
  nap: number
  stages: string
  updated_at: string
  deleted_at: string | null
}

interface HeartRow {
  date: string
  points: string
  updated_at: string
}

export type HealthSyncOutcome = 'synced' | 'skipped' | 'failed' | 'not_connected'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function returnToApp(params: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `${HEALTH_RETURN_URL}?${new URLSearchParams(params)}`, 'cache-control': 'no-store' }
  })
}

function scopesFrom(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(/\s+/).filter(Boolean))].sort()
}

export function grantsFrom(scopes: readonly string[]): HealthGrants {
  return {
    activity: scopes.includes(HEALTH_SCOPES.activity),
    body: scopes.includes(HEALTH_SCOPES.body),
    sleep: scopes.includes(HEALTH_SCOPES.sleep),
    settings: scopes.includes(HEALTH_SCOPES.settings)
  }
}

function parseScopes(stored: string): string[] {
  try {
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseDevice(stored: string | null): HealthDevice | null {
  if (!stored) return null
  try {
    const value: unknown = JSON.parse(stored)
    if (!isRecord(value) || typeof value.name !== 'string') return null
    return {
      name: value.name,
      batteryLevel: typeof value.batteryLevel === 'number' ? value.batteryLevel : null,
      lastSyncAt: typeof value.lastSyncAt === 'string' ? value.lastSyncAt : null
    }
  } catch {
    return null
  }
}

function readConnection(env: Env, datasetId: string): Promise<ConnectionRow | null> {
  return env.DB.prepare('SELECT * FROM health_connections WHERE dataset_id = ?').bind(datasetId).first<ConnectionRow>()
}

export async function healthConnected(env: Env, datasetId: string): Promise<boolean> {
  const row = await readConnection(env, datasetId)
  return Boolean(row && !row.revoked_at)
}

export async function startHealthConnect(request: Request, env: Env, device: DeviceIdentity, now = new Date()): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CONNECTOR_TOKEN_KEY) {
    return failure(503, 'NOT_CONFIGURED', 'Google is not set up on the server')
  }
  const nowIso = now.toISOString()
  await env.DB.prepare('DELETE FROM health_oauth_states WHERE expires_at <= ?').bind(nowIso).run()
  const state = randomUrlToken()
  const verifier = randomUrlToken(48)
  const redirectUri = googleCallbackUrl(request, env)
  const expiresAt = new Date(now.getTime() + OAUTH_TTL_MS).toISOString()
  await env.DB.prepare(`INSERT INTO health_oauth_states
    (state_hash, dataset_id, device_id, pkce_verifier, redirect_uri, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(await sha256(state), device.datasetId, device.deviceId, verifier, redirectUri, expiresAt, nowIso).run()
  const owner = await env.DB.prepare('SELECT account_email FROM devices WHERE id = ?')
    .bind(device.deviceId).first<{ account_email: string | null }>()
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ['openid', 'email', ...Object.values(HEALTH_SCOPES)].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    include_granted_scopes: 'false'
  })
  if (owner?.account_email) params.set('login_hint', owner.account_email)
  const data: HealthConnectStart = { authorizationUrl: `${GOOGLE_AUTHORIZE}?${params}`, expiresAt }
  return json({ ok: true, data })
}

/**
 * Google Health shares the Google redirect URI with sign-in and the Gmail connector. Returns null
 * when the state belongs to one of those.
 */
export async function completeHealthConnect(request: Request, env: Env, now = new Date()): Promise<Response | null> {
  const url = new URL(request.url)
  const state = url.searchParams.get('state')
  if (!state) return null
  const stateHash = await sha256(state)
  const row = await env.DB.prepare(`SELECT dataset_id, pkce_verifier, redirect_uri, expires_at, consumed_at
    FROM health_oauth_states WHERE state_hash = ?`).bind(stateHash).first<StateRow>()
  if (!row) return null
  const nowIso = now.toISOString()
  const claimed = await env.DB.prepare(`UPDATE health_oauth_states SET consumed_at = ?
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
  const scopes = scopesFrom(token.scope)
  const grants = grantsFrom(scopes)
  if (!grants.activity && !grants.body && !grants.sleep) return returnToApp({ error: 'no_access' })
  const claims = token.id_token ? idTokenClaims(token.id_token) : null
  const email = typeof claims?.email === 'string' ? claims.email.toLowerCase() : null
  const previous = await readConnection(env, row.dataset_id)
  const protectedToken = await encryptConnectorToken(token.refresh_token, env)
  const statements: D1PreparedStatement[] = []
  const switchedAccount = Boolean(previous?.account_label && email && previous.account_label !== email)
  if (switchedAccount) {
    for (const table of ['health_days', 'health_sleeps', 'health_heart']) {
      statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE dataset_id = ?`).bind(row.dataset_id))
    }
  }
  statements.push(env.DB.prepare(`INSERT INTO health_connections
    (dataset_id, encrypted_refresh_token, token_key_version, granted_scopes, account_label,
      created_at, updated_at, revoked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(dataset_id) DO UPDATE SET
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      token_key_version = excluded.token_key_version,
      granted_scopes = excluded.granted_scopes,
      account_label = COALESCE(excluded.account_label, health_connections.account_label),
      history_from = CASE WHEN ? THEN NULL ELSE health_connections.history_from END,
      sync_started_at = NULL,
      last_error = NULL,
      updated_at = excluded.updated_at,
      revoked_at = NULL`)
    .bind(row.dataset_id, protectedToken.encrypted, protectedToken.keyVersion, JSON.stringify(scopes),
      email, nowIso, nowIso, switchedAccount ? 1 : 0))
  await env.DB.batch(statements)
  return returnToApp({ connected: '1' })
}

export async function disconnectHealth(env: Env, datasetId: string): Promise<void> {
  const row = await readConnection(env, datasetId)
  if (row && !row.revoked_at) {
    try {
      const token = await decryptConnectorToken(row.encrypted_refresh_token, env)
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token })
      })
    } catch {
      // The local removal still wins if Google is offline or already dropped the grant.
    }
  }
  await env.DB.prepare('DELETE FROM health_connections WHERE dataset_id = ?').bind(datasetId).run()
}

type RefreshResult = { ok: true; accessToken: string; refreshToken: string | null } | { ok: false; revoked: boolean }

async function refreshAccessToken(env: Env, refreshToken: string): Promise<RefreshResult> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return { ok: false, revoked: false }
  let response: Response
  try {
    response = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET
      })
    })
  } catch {
    return { ok: false, revoked: false }
  }
  let body: unknown
  try { body = await response.json() } catch { body = null }
  if (!response.ok || !isRecord(body) || typeof body.access_token !== 'string') {
    return { ok: false, revoked: isRecord(body) && body.error === 'invalid_grant' }
  }
  return {
    ok: true,
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null
  }
}

function problemFor(error: unknown): string {
  if (!(error instanceof GoogleHealthError)) return 'The Google Health sync stopped unexpectedly. The next sync tries again.'
  if (error.status === 401 || error.status === 403) {
    return 'Google Health refused a request. Connect again and allow every permission.'
  }
  if (error.status === 429) return 'Google Health asked Ego to slow down. The next sync tries again.'
  if (error.status === 0) return 'Google Health did not answer. The next sync tries again.'
  return `${error.message}. The next sync tries again.`
}

interface DayRange {
  from: string
  to: string
  columns: DayColumn[]
  values: Map<string, DayValues>
}

async function readDays(
  client: GoogleHealthClient, grants: HealthGrants, from: string, to: string, withHeartRate: boolean
): Promise<DayRange> {
  const rollups: DailyRollupName[] = [
    ...(grants.activity ? ['steps', 'distance', 'calories', 'zoneMinutes'] as const : []),
    ...(grants.body ? ['weight'] as const : []),
    ...(grants.body && withHeartRate ? ['heartRate'] as const : [])
  ]
  const summaries: DailySummaryName[] = grants.body ? ['restingHeartRate', 'hrv'] : []
  const results = await Promise.all([
    ...rollups.map((name) => client.dailyRollup(name, from, to)),
    ...summaries.map((name) => client.dailySummary(name, from, to))
  ])
  const values = new Map<string, DayValues>()
  for (const result of results) {
    for (const [date, value] of result) values.set(date, { ...values.get(date), ...value })
  }
  const columns = [
    ...rollups.flatMap((name) => ROLLUP_COLUMNS[name]),
    ...summaries.flatMap((name) => SUMMARY_COLUMNS[name])
  ]
  return { from, to, columns, values }
}

/**
 * One statement per range, so a year of days costs the same number of D1 queries as one day. Column
 * names come from DAY_COLUMNS, never from input. Only changed rows get a new `updated_at`, which is
 * what lets the phone download just the difference.
 */
function dayStatements(db: D1Database, datasetId: string, range: DayRange, now: string): D1PreparedStatement[] {
  const columns = range.columns.filter((column) => DAY_COLUMNS.includes(column))
  if (columns.length === 0) return []
  const filled: Array<Record<string, unknown>> = []
  const empty: string[] = []
  for (const date of datesIn(range.from, range.to)) {
    const value = range.values.get(date)
    const row: Record<string, unknown> = { date }
    let any = false
    for (const column of columns) {
      const cell = value?.[column] ?? null
      row[column] = cell
      if (cell !== null) any = true
    }
    if (any) filled.push(row)
    else empty.push(date)
  }
  const list = columns.join(', ')
  const upsert = db.prepare(`INSERT INTO health_days (dataset_id, date, ${list}, updated_at)
    SELECT ?, json_extract(value, '$.date'), ${columns.map((column) => `json_extract(value, '$.${column}')`).join(', ')}, ?
    FROM json_each(?) WHERE true
    ON CONFLICT(dataset_id, date) DO UPDATE SET
      ${columns.map((column) => `${column} = excluded.${column}`).join(', ')}, updated_at = excluded.updated_at
    WHERE ${columns.map((column) => `health_days.${column} IS NOT excluded.${column}`).join(' OR ')}`)
    .bind(datasetId, now, JSON.stringify(filled))
  const clear = db.prepare(`UPDATE health_days SET ${columns.map((column) => `${column} = NULL`).join(', ')}, updated_at = ?
    WHERE dataset_id = ? AND date IN (SELECT value FROM json_each(?))
      AND (${columns.map((column) => `${column} IS NOT NULL`).join(' OR ')})`)
    .bind(now, datasetId, JSON.stringify(empty))
  return [upsert, clear]
}

const SLEEP_COLUMNS = [
  'date', 'start_time', 'end_time', 'start_local', 'end_local', 'minutes_asleep', 'minutes_awake',
  'minutes_in_bed', 'deep_minutes', 'light_minutes', 'rem_minutes', 'nap', 'stages'
] as const

function sleepStatements(
  db: D1Database, datasetId: string, from: string, to: string, sleeps: SleepRow[], now: string
): D1PreparedStatement[] {
  const rows = sleeps.map((sleep) => ({
    id: sleep.id,
    date: sleep.date,
    start_time: sleep.startTime,
    end_time: sleep.endTime,
    start_local: sleep.startLocal,
    end_local: sleep.endLocal,
    minutes_asleep: sleep.minutesAsleep,
    minutes_awake: sleep.minutesAwake,
    minutes_in_bed: sleep.minutesInBed,
    deep_minutes: sleep.deepMinutes,
    light_minutes: sleep.lightMinutes,
    rem_minutes: sleep.remMinutes,
    nap: sleep.nap ? 1 : 0,
    stages: JSON.stringify(sleep.stages.map((stage) => [stage.kind, stage.start, stage.minutes]))
  }))
  const upsert = db.prepare(`INSERT INTO health_sleeps (dataset_id, id, ${SLEEP_COLUMNS.join(', ')}, updated_at, deleted_at)
    SELECT ?, json_extract(value, '$.id'), ${SLEEP_COLUMNS.map((column) => `json_extract(value, '$.${column}')`).join(', ')}, ?, NULL
    FROM json_each(?) WHERE true
    ON CONFLICT(dataset_id, id) DO UPDATE SET
      ${SLEEP_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')},
      updated_at = excluded.updated_at, deleted_at = NULL
    WHERE health_sleeps.deleted_at IS NOT NULL OR
      ${SLEEP_COLUMNS.map((column) => `health_sleeps.${column} IS NOT excluded.${column}`).join(' OR ')}`)
    .bind(datasetId, now, JSON.stringify(rows))
  const removed = db.prepare(`UPDATE health_sleeps SET deleted_at = ?, updated_at = ?
    WHERE dataset_id = ? AND date >= ? AND date < ? AND deleted_at IS NULL
      AND id NOT IN (SELECT value FROM json_each(?))`)
    .bind(now, now, datasetId, from, to, JSON.stringify(rows.map((row) => row.id)))
  return [upsert, removed]
}

function heartStatement(
  db: D1Database, datasetId: string, curves: Map<string, Array<[number, number]>>, dates: string[], now: string
): D1PreparedStatement {
  const rows = dates
    .filter((date) => curves.has(date))
    .map((date) => ({ date, points: JSON.stringify(curves.get(date)) }))
  return db.prepare(`INSERT INTO health_heart (dataset_id, date, points, updated_at)
    SELECT ?, json_extract(value, '$.date'), json_extract(value, '$.points'), ?
    FROM json_each(?) WHERE true
    ON CONFLICT(dataset_id, date) DO UPDATE SET points = excluded.points, updated_at = excluded.updated_at
    WHERE health_heart.points IS NOT excluded.points`)
    .bind(datasetId, now, JSON.stringify(rows))
}

function historyTarget(today: string): string {
  return shiftDate(today, -(HEALTH_HISTORY_DAYS - 1))
}

/**
 * Pulls the last ten days, and one more slice of history until a year is in D1. Cron and the
 * phone both call this; the `sync_started_at` swap lets only one run at a time.
 */
export async function syncHealth(
  env: Env,
  datasetId: string,
  now: Date,
  options: { minimumGapMs: number; timeZone?: string | null }
): Promise<HealthSyncOutcome> {
  const row = await readConnection(env, datasetId)
  if (!row || row.revoked_at) return 'not_connected'
  const nowMs = now.getTime()
  const nowIso = now.toISOString()
  const fallbackZone = isValidTimeZone(options.timeZone) ? options.timeZone : row.time_zone ?? 'UTC'
  const startedMs = row.sync_started_at ? Date.parse(row.sync_started_at) : 0
  const finishedMs = row.sync_finished_at ? Date.parse(row.sync_finished_at) : 0
  const running = startedMs > finishedMs && nowMs - startedMs < STALE_RUN_MS
  const complete = row.history_from !== null && row.history_from <= historyTarget(localDate(nowMs, fallbackZone))
  if (running || (complete && finishedMs > 0 && nowMs - finishedMs < options.minimumGapMs)) return 'skipped'
  const claimed = await env.DB.prepare(`UPDATE health_connections SET sync_started_at = ?
    WHERE dataset_id = ? AND sync_started_at IS ?`).bind(nowIso, datasetId, row.sync_started_at).run()
  if ((claimed.meta.changes ?? 0) !== 1) return 'skipped'

  const fail = async (message: string, revoked = false): Promise<HealthSyncOutcome> => {
    await env.DB.prepare(`UPDATE health_connections SET last_error = ?, sync_finished_at = ?, updated_at = ?,
      revoked_at = CASE WHEN ? THEN ? ELSE revoked_at END WHERE dataset_id = ?`)
      .bind(message, nowIso, nowIso, revoked ? 1 : 0, nowIso, datasetId).run()
    return 'failed'
  }

  let refreshToken: string
  try {
    refreshToken = await decryptConnectorToken(row.encrypted_refresh_token, env)
  } catch {
    return fail('The server cannot read the saved Google Health access. Connect again.', true)
  }
  const refreshed = await refreshAccessToken(env, refreshToken)
  if (!refreshed.ok) {
    return refreshed.revoked
      ? fail('Google Health access ended. Connect again.', true)
      : fail('Google did not renew Google Health access. The next sync tries again.')
  }

  const grants = grantsFrom(parseScopes(row.granted_scopes))
  const client = googleHealthClient(refreshed.accessToken)
  try {
    let timeZone = fallbackZone
    let device = parseDevice(row.device)
    if (grants.settings) {
      const [settings, paired] = await Promise.all([
        client.settings().catch(() => null),
        client.device().catch(() => null)
      ])
      if (settings?.timeZone) timeZone = settings.timeZone
      if (paired) device = paired
    }
    const today = localDate(nowMs, timeZone)
    const to = shiftDate(today, 1)
    const recentFrom = shiftDate(today, -(RECENT_DAYS - 1))
    const target = historyTarget(today)
    const historyFrom = row.history_from && row.history_from < recentFrom ? row.history_from : recentFrom
    const backfill = historyFrom > target
      ? { from: shiftDate(historyFrom, -BACKFILL_DAYS) < target ? target : shiftDate(historyFrom, -BACKFILL_DAYS), to: historyFrom }
      : null
    const yesterday = shiftDate(today, -1)

    const [recent, older, recentSleeps, olderSleeps, curve] = await Promise.all([
      readDays(client, grants, recentFrom, to, true),
      backfill ? readDays(client, grants, backfill.from, backfill.to, false) : null,
      grants.sleep ? client.sleeps(recentFrom, to) : null,
      grants.sleep && backfill ? client.sleeps(backfill.from, backfill.to) : null,
      grants.body ? client.heartCurve(startOfLocalDay(yesterday, timeZone), nowMs) : null
    ])

    const statements: D1PreparedStatement[] = [
      ...dayStatements(env.DB, datasetId, recent, nowIso),
      ...(older ? dayStatements(env.DB, datasetId, older, nowIso) : []),
      ...(recentSleeps ? sleepStatements(env.DB, datasetId, recentFrom, to, recentSleeps, nowIso) : []),
      ...(olderSleeps && backfill ? sleepStatements(env.DB, datasetId, backfill.from, backfill.to, olderSleeps, nowIso) : []),
      ...(curve ? [heartStatement(env.DB, datasetId, bucketHeartRate(curve, timeZone), [yesterday, today], nowIso)] : [])
    ]
    const reached = backfill ? backfill.from : historyFrom
    statements.push(env.DB.prepare(`UPDATE health_connections SET
      history_from = CASE WHEN history_from IS NULL OR history_from > ? THEN ? ELSE history_from END,
      time_zone = ?, device = ?, last_sync_at = ?, sync_finished_at = ?, last_error = NULL, updated_at = ?
      WHERE dataset_id = ?`)
      .bind(reached, reached, timeZone, device ? JSON.stringify(device) : null, nowIso, nowIso, nowIso, datasetId))
    await env.DB.batch(statements)
  } catch (error: unknown) {
    return fail(problemFor(error))
  }
  if (refreshed.refreshToken && refreshed.refreshToken !== refreshToken) {
    const rotated = await encryptConnectorToken(refreshed.refreshToken, env)
    await env.DB.prepare(`UPDATE health_connections SET encrypted_refresh_token = ?, token_key_version = ?
      WHERE dataset_id = ?`).bind(rotated.encrypted, rotated.keyVersion, datasetId).run()
  }
  return 'synced'
}

function toDay(row: DayRow): HealthDay {
  return {
    date: row.date,
    steps: row.steps,
    distanceMeters: row.distance_m,
    caloriesKcal: row.calories_kcal,
    fatBurnMinutes: row.fat_burn_minutes,
    cardioMinutes: row.cardio_minutes,
    peakMinutes: row.peak_minutes,
    restingHeartRate: row.resting_hr,
    hrvMs: row.hrv_ms,
    heartRateMin: row.hr_min,
    heartRateAvg: row.hr_avg,
    heartRateMax: row.hr_max,
    weightKg: row.weight_kg,
    updatedAt: row.updated_at
  }
}

function parseStages(stored: string): HealthSleepStage[] {
  try {
    const value: unknown = JSON.parse(stored)
    if (!Array.isArray(value)) return []
    return value.flatMap((item): HealthSleepStage[] => {
      if (!Array.isArray(item) || item.length !== 3) return []
      const [kind, start, minutes] = item as unknown[]
      if (typeof start !== 'number' || typeof minutes !== 'number') return []
      if (kind !== 'awake' && kind !== 'light' && kind !== 'deep' && kind !== 'rem' && kind !== 'asleep' && kind !== 'restless') return []
      return [{ kind, start, minutes }]
    })
  } catch {
    return []
  }
}

function toSleep(row: SleepDbRow): HealthSleep {
  return {
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    startLocal: row.start_local,
    endLocal: row.end_local,
    minutesAsleep: row.minutes_asleep,
    minutesAwake: row.minutes_awake,
    minutesInBed: row.minutes_in_bed,
    deepMinutes: row.deep_minutes,
    lightMinutes: row.light_minutes,
    remMinutes: row.rem_minutes,
    nap: row.nap === 1,
    stages: parseStages(row.stages),
    deleted: row.deleted_at !== null,
    updatedAt: row.updated_at
  }
}

function toHeart(row: HeartRow): HealthHeartDay {
  let points: Array<[number, number]> = []
  try {
    const value: unknown = JSON.parse(row.points)
    if (Array.isArray(value)) {
      points = value.filter((item): item is [number, number] =>
        Array.isArray(item) && item.length === 2 && typeof item[0] === 'number' && typeof item[1] === 'number')
    }
  } catch {
    points = []
  }
  return { date: row.date, points, updatedAt: row.updated_at }
}

function connectionFrom(row: ConnectionRow | null, nowMs: number): HealthConnection {
  const scopes = row ? parseScopes(row.granted_scopes) : []
  const timeZone = row?.time_zone ?? null
  const today = localDate(nowMs, timeZone ?? 'UTC')
  return {
    connected: Boolean(row && !row.revoked_at),
    accountLabel: row?.account_label ?? null,
    grants: grantsFrom(scopes),
    lastSyncAt: row?.last_sync_at ?? null,
    lastError: row?.last_error ?? null,
    historyFrom: row?.history_from ?? null,
    historyComplete: Boolean(row?.history_from && row.history_from <= historyTarget(today)),
    timeZone,
    device: parseDevice(row?.device ?? null)
  }
}

export async function readHealthSnapshot(env: Env, datasetId: string, since: string | null, now: Date): Promise<HealthSnapshot> {
  const nowMs = now.getTime()
  const sinceMs = since ? Date.parse(since) : Number.NaN
  const floor = Number.isFinite(sinceMs) ? new Date(sinceMs - READ_OVERLAP_MS).toISOString() : ''
  const row = await readConnection(env, datasetId)
  const connection = connectionFrom(row, nowMs)
  const today = localDate(nowMs, connection.timeZone ?? 'UTC')
  const heartFrom = shiftDate(today, -(HEALTH_HEART_CURVE_DAYS - 1))
  const [days, sleeps, heart] = await Promise.all([
    env.DB.prepare('SELECT * FROM health_days WHERE dataset_id = ? AND updated_at >= ? ORDER BY date')
      .bind(datasetId, floor).all<DayRow>(),
    env.DB.prepare(`SELECT * FROM health_sleeps WHERE dataset_id = ? AND updated_at >= ?
      AND (deleted_at IS NULL OR ? = 1) ORDER BY start_time`)
      .bind(datasetId, floor, floor ? 1 : 0).all<SleepDbRow>(),
    env.DB.prepare('SELECT * FROM health_heart WHERE dataset_id = ? AND date >= ? AND updated_at >= ? ORDER BY date')
      .bind(datasetId, heartFrom, floor).all<HeartRow>()
  ])
  return {
    connection,
    days: (days.results ?? []).map(toDay),
    sleeps: (sleeps.results ?? []).map(toSleep),
    heart: (heart.results ?? []).map(toHeart),
    serverTime: now.toISOString()
  }
}

function sinceFrom(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null
}

export async function readHealth(request: Request, env: Env, device: DeviceIdentity, now: Date): Promise<Response> {
  const since = sinceFrom(new URL(request.url).searchParams.get('since'))
  return json({ ok: true, data: await readHealthSnapshot(env, device.datasetId, since, now) })
}

/** Syncs from Google before answering, unless another run is going or the last one just finished. */
export async function syncHealthRequest(request: Request, env: Env, device: DeviceIdentity, now: Date): Promise<Response> {
  let body: unknown = null
  try { body = await request.json() } catch { body = null }
  const input = isRecord(body) ? body : {}
  await syncHealth(env, device.datasetId, now, {
    minimumGapMs: PHONE_SYNC_GAP_MS,
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : null
  })
  const data = await readHealthSnapshot(env, device.datasetId, sinceFrom(input.since), new Date())
  return json({ ok: true, data })
}

export async function runScheduledHealthSync(env: Env, now: Date): Promise<void> {
  const rows = await env.DB.prepare('SELECT dataset_id FROM health_connections WHERE revoked_at IS NULL')
    .all<{ dataset_id: string }>()
  for (const row of rows.results ?? []) {
    await syncHealth(env, row.dataset_id, now, { minimumGapMs: SCHEDULED_SYNC_GAP_MS })
  }
}
