import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HealthConnectStart, HealthSnapshot } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { encryptConnectorToken } from '../src/connector-crypto'
import { HEALTH_SCOPES, bucketHeartRate, parseSleep, startOfLocalDay } from '../src/google-health'
import { readHealthSnapshot, runScheduledHealthSync, syncHealth } from '../src/health'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-aaaaaa'
const KEY = `v1:${Buffer.alloc(32, 7).toString('base64')}`
const ALL_SCOPES = ['openid', 'email', ...Object.values(HEALTH_SCOPES)].join(' ')
const SYNC_AT = new Date('2026-09-28T16:00:00.000Z')
let ledger: Ledger | null = null

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

async function environment(): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, account_email)
    VALUES ('device-a', 'Phone', ?, 'ego', ?, 'me@example.com')`, [await hashToken(TOKEN), NOW])
  return {
    DB: ledger.db,
    CONNECTOR_TOKEN_KEY: KEY,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    PUBLIC_BASE_URL: 'https://ego.example'
  }
}

async function connect(env: Env, scopes = Object.values(HEALTH_SCOPES)): Promise<void> {
  const token = await encryptConnectorToken('refresh-1', env)
  await exec(env.DB, `INSERT INTO health_connections (dataset_id, encrypted_refresh_token, token_key_version,
    granted_scopes, account_label, created_at, updated_at) VALUES ('ego', ?, ?, ?, 'me@example.com', ?, ?)`,
  [token.encrypted, token.keyVersion, JSON.stringify(scopes), NOW, NOW])
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ego.example${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...init.headers }
  })
}

function googleDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function isoOf(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
}

function shift(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function fakeIdToken(email: string): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part({ email })}.signature`
}

interface FakeSleep {
  id: string
  bedtime: string
  wake: string
}

/**
 * Google Health as the Worker sees it: int64 values as strings, zero fields left out, a value only
 * on days the band was worn, and daily-summary filters that accept only one spelling.
 */
function fakeGoogle(options: {
  firstDay?: string
  sleeps?: FakeSleep[]
  refresh?: 'ok' | 'revoked'
  acceptedFilter?: 'camel' | 'snake'
} = {}): { fetch: typeof fetch; calls: string[]; sleeps: FakeSleep[] } {
  const firstDay = options.firstDay ?? '2026-06-01'
  const calls: string[] = []
  const sleeps = [...(options.sleeps ?? [])]
  const value = (type: string, date: string): Record<string, unknown> | null => {
    if (date < firstDay) return null
    const day = Number(date.slice(8))
    switch (type) {
      case 'steps': return { steps: day === 28 ? {} : { countSum: String(8000 + day) } }
      case 'distance': return { distance: { millimetersSum: String(6_000_000 + day * 1000) } }
      case 'total-calories': return { totalCalories: { kcalSum: 2200.5 } }
      case 'active-zone-minutes': return { activeZoneMinutes: { sumInCardioHeartZone: '20', sumInPeakHeartZone: '4' } }
      case 'heart-rate': return { heartRate: { beatsPerMinuteMin: 52, beatsPerMinuteAvg: 71.4, beatsPerMinuteMax: 150 } }
      case 'weight': return day % 7 === 0 ? { weight: { weightGramsAvg: 80250 } } : null
      default: return null
    }
  }
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.redirect === 'error') {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual" ("error" is not supported)')
    }
    const url = new URL(String(input))
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body))
      if (body.get('grant_type') === 'authorization_code') {
        return json({ access_token: 'access-1', refresh_token: 'refresh-1', scope: ALL_SCOPES, id_token: fakeIdToken('Me@Example.com') })
      }
      if (options.refresh === 'revoked') return json({ error: 'invalid_grant' }, 400)
      return json({ access_token: 'access-2', expires_in: 3599 })
    }
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json({})
    const path = url.pathname.replace('/v4/users/me', '')
    if (path === '/settings') return json({ timeZone: 'America/New_York', distanceUnit: 'DISTANCE_UNIT_MILES' })
    if (path === '/pairedDevices') {
      return json({ pairedDevices: [{ deviceType: 'TRACKER', deviceVersion: 'Fitbit Air', batteryLevel: 64, lastSyncTime: '2026-09-28T15:40:00Z' }] })
    }
    const rollup = /^\/dataTypes\/([a-z-]+)\/dataPoints:dailyRollUp$/.exec(path)
    if (rollup) {
      const body = JSON.parse(String(init?.body)) as { range: { start: { date: { year: number; month: number; day: number } }; end: { date: { year: number; month: number; day: number } } } }
      const from = isoOf(body.range.start.date)
      const to = isoOf(body.range.end.date)
      const limit = rollup[1] === 'total-calories' || rollup[1] === 'heart-rate' ? 14 : 90
      if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) > limit) return json({ error: { code: 400 } }, 400)
      const points = []
      for (let date = from; date < to; date = shift(date, 1)) {
        points.push({ civilStartTime: { date: googleDate(date) }, civilEndTime: { date: googleDate(shift(date, 1)) }, ...value(rollup[1], date) })
      }
      return json({ rollupDataPoints: points })
    }
    if (path === '/dataTypes/heart-rate/dataPoints:rollUp') {
      return json({
        rollupDataPoints: [
          { startTime: '2026-09-27T03:55:00Z', endTime: '2026-09-27T04:00:00Z', heartRate: { beatsPerMinuteAvg: 60 } },
          { startTime: '2026-09-27T04:00:00Z', endTime: '2026-09-27T04:05:00Z', heartRate: { beatsPerMinuteAvg: 58.6 } },
          { startTime: '2026-09-28T04:00:00Z', endTime: '2026-09-28T04:05:00Z' },
          { startTime: '2026-09-28T15:00:00Z', endTime: '2026-09-28T15:05:00Z', heartRate: { beatsPerMinuteAvg: 88 } }
        ]
      })
    }
    const summary = /^\/dataTypes\/(daily-resting-heart-rate|daily-heart-rate-variability)\/dataPoints$/.exec(path)
    if (summary) {
      const filter = url.searchParams.get('filter') ?? ''
      const camel = /^daily[A-Z]/.test(filter)
      if ((options.acceptedFilter ?? 'snake') === 'snake' ? camel : !camel) return json({ error: { code: 400 } }, 400)
      const [, from, to] = /"(\d{4}-\d{2}-\d{2})".*"(\d{4}-\d{2}-\d{2})"/.exec(filter) ?? []
      const dataPoints = []
      for (let date = from; date < to; date = shift(date, 1)) {
        if (date < firstDay) continue
        dataPoints.push(summary[1] === 'daily-resting-heart-rate'
          ? { dailyRestingHeartRate: { date: googleDate(date), beatsPerMinute: '58' } }
          : { dailyHeartRateVariability: { date: googleDate(date), averageHeartRateVariabilityMilliseconds: 45.5 } })
      }
      return json({ dataPoints })
    }
    if (path === '/dataTypes/sleep/dataPoints') {
      const filter = url.searchParams.get('filter') ?? ''
      const [, from, to] = /"(\d{4}-\d{2}-\d{2})".*"(\d{4}-\d{2}-\d{2})"/.exec(filter) ?? []
      const matching = sleeps.filter((sleep) => sleep.wake.slice(0, 10) >= from && sleep.wake.slice(0, 10) < to)
      const offset = Number(url.searchParams.get('pageToken') ?? '0')
      const page = matching.slice(offset, offset + 25)
      return json({
        dataPoints: page.map((sleep) => ({
          name: `users/abc/dataTypes/sleep/dataPoints/${sleep.id}`,
          sleep: {
            interval: {
              startTime: new Date(`${sleep.bedtime}-04:00`).toISOString(),
              startUtcOffset: '-14400s',
              endTime: new Date(`${sleep.wake}-04:00`).toISOString(),
              endUtcOffset: '-14400s',
              civilStartTime: { date: googleDate(sleep.bedtime.slice(0, 10)), time: { hours: Number(sleep.bedtime.slice(11, 13)), minutes: Number(sleep.bedtime.slice(14, 16)) } },
              civilEndTime: { date: googleDate(sleep.wake.slice(0, 10)), time: { hours: Number(sleep.wake.slice(11, 13)), minutes: Number(sleep.wake.slice(14, 16)) } }
            },
            type: 'STAGES',
            summary: {
              stagesSummary: [{ type: 'DEEP', minutes: '70', count: '3' }, { type: 'LIGHT', minutes: '250' }, { type: 'REM', minutes: '95' }, { type: 'AWAKE', minutes: '45' }],
              minutesInSleepPeriod: '460', minutesAsleep: '415', minutesAwake: '45'
            },
            metadata: { processed: true }
          }
        })),
        ...(offset + 25 < matching.length ? { nextPageToken: String(offset + 25) } : {})
      })
    }
    return json({ error: { code: 404 } }, 404)
  }
  return { fetch: vi.fn(handler) as unknown as typeof fetch, calls, sleeps }
}

function nights(fromWake: string, count: number): FakeSleep[] {
  return Array.from({ length: count }, (_, index) => {
    const wake = shift(fromWake, index)
    return { id: `night-${wake}`, bedtime: `${shift(wake, -1)}T23:10`, wake: `${wake}T06:50` }
  })
}

async function dayRow(env: Env, date: string): Promise<Record<string, unknown> | null> {
  return env.DB.prepare('SELECT * FROM health_days WHERE dataset_id = ? AND date = ?').bind('ego', date).first()
}

describe('google health parsing', () => {
  it('reads a staged night with int64 strings and fields Google leaves out', () => {
    const row = parseSleep({
      name: 'users/abc/dataTypes/sleep/dataPoints/night-1',
      sleep: {
        interval: {
          startTime: '2026-09-28T03:10:00Z', startUtcOffset: '-14400s',
          endTime: '2026-09-28T10:50:00Z', endUtcOffset: '-14400s',
          civilStartTime: { date: { year: 2026, month: 9, day: 27 }, time: { hours: 23, minutes: 10 } },
          civilEndTime: { date: { year: 2026, month: 9, day: 28 }, time: { hours: 6, minutes: 50 } }
        },
        type: 'STAGES',
        stages: [
          { type: 'LIGHT', startTime: '2026-09-28T03:25:00Z', endTime: '2026-09-28T04:00:00Z' },
          { type: 'AWAKE', startTime: '2026-09-28T03:10:00Z', endTime: '2026-09-28T03:25:00Z' },
          { type: 'DEEP', startTime: '2026-09-28T04:00:00Z', endTime: '2026-09-28T05:00:00Z' }
        ],
        summary: { stagesSummary: [{ type: 'DEEP', minutes: '60' }, { type: 'LIGHT', minutes: '35' }], minutesInSleepPeriod: '460', minutesAsleep: '95' },
        metadata: { nap: false }
      }
    })
    expect(row).toMatchObject({
      id: 'night-1', date: '2026-09-28', startLocal: '2026-09-27T23:10', endLocal: '2026-09-28T06:50',
      minutesAsleep: 95, minutesAwake: 15, minutesInBed: 460, deepMinutes: 60, lightMinutes: 35, remMinutes: 0, nap: false
    })
    expect(row?.stages).toEqual([
      { kind: 'awake', start: 0, minutes: 15 },
      { kind: 'light', start: 15, minutes: 35 },
      { kind: 'deep', start: 50, minutes: 60 }
    ])
  })

  it('files a classic nap with no stage totals', () => {
    const row = parseSleep({ sleep: {
      interval: { startTime: '2026-09-28T18:00:00Z', endTime: '2026-09-28T18:40:00Z', startUtcOffset: '-14400s', endUtcOffset: '-14400s' },
      type: 'CLASSIC',
      metadata: { nap: true }
    } })
    expect(row).toMatchObject({
      id: 'sleep-2026-09-28T18:00:00Z', date: '2026-09-28', startLocal: '2026-09-28T14:00',
      minutesInBed: 40, minutesAsleep: 40, deepMinutes: null, nap: true
    })
  })

  it('splits heart rate into local days', () => {
    expect(startOfLocalDay('2026-09-28', 'America/New_York')).toBe(Date.parse('2026-09-28T04:00:00Z'))
    expect(startOfLocalDay('2026-09-28', 'Asia/Tokyo')).toBe(Date.parse('2026-09-27T15:00:00Z'))
    const days = bucketHeartRate([
      { startTime: '2026-09-28T04:00:00Z', bpm: 61.4 },
      { startTime: '2026-09-28T03:55:00Z', bpm: 60 }
    ], 'America/New_York')
    expect(days.get('2026-09-27')).toEqual([[1435, 60]])
    expect(days.get('2026-09-28')).toEqual([[0, 61]])
    const fallBack = bucketHeartRate([
      { startTime: '2026-11-01T05:55:00Z', bpm: 55 },
      { startTime: '2026-11-01T06:05:00Z', bpm: 54 }
    ], 'America/New_York')
    expect(fallBack.get('2026-11-01')).toEqual([[65, 54], [115, 55]])
  })
})

describe('google health connection', () => {
  it('asks Google for the read-only health scopes and stores the grant from the shared callback', async () => {
    const env = await environment()
    const google = fakeGoogle()
    vi.stubGlobal('fetch', google.fetch)
    const started = await handle(request('/v1/health/connect', { method: 'POST' }), env)
    const start = (await started.json() as Envelope<HealthConnectStart>).data
    const authorization = new URL(start.authorizationUrl)
    expect(authorization.searchParams.get('scope')).toBe(ALL_SCOPES)
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://ego.example/v1/connectors/google/callback')
    expect(authorization.searchParams.get('login_hint')).toBe('me@example.com')
    expect(authorization.searchParams.get('access_type')).toBe('offline')

    const state = authorization.searchParams.get('state') ?? ''
    const callback = await handle(new Request(`https://ego.example/v1/connectors/google/callback?state=${state}&code=abc`), env)
    expect(callback.status).toBe(302)
    expect(callback.headers.get('location')).toBe('ego://health?connected=1')

    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection).toMatchObject({
      connected: true, accountLabel: 'me@example.com',
      grants: { activity: true, body: true, sleep: true, settings: true }
    })
    const again = await handle(new Request(`https://ego.example/v1/connectors/google/callback?state=${state}&code=abc`), env)
    expect(again.headers.get('location')).toBe('ego://health?error=expired')

    const session = await handle(request('/v1/session'), env)
    expect((await session.json() as Envelope<{ services: { googleHealth: boolean } }>).data.services.googleHealth).toBe(true)
  })

  it('refuses a grant with no health data in it', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/token')
      ? new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'openid email' }))
      : new Response('{}')))
    const started = await handle(request('/v1/health/connect', { method: 'POST' }), env)
    const state = new URL((await started.json() as Envelope<HealthConnectStart>).data.authorizationUrl).searchParams.get('state')
    const callback = await handle(new Request(`https://ego.example/v1/connectors/google/callback?state=${state}&code=abc`), env)
    expect(callback.headers.get('location')).toBe('ego://health?error=no_access')
    expect((await readHealthSnapshot(env, 'ego', null, SYNC_AT)).connection.connected).toBe(false)
  })

  it('disconnects and keeps the synced days', async () => {
    const env = await environment()
    await connect(env)
    await exec(env.DB, `INSERT INTO health_days (dataset_id, date, steps, updated_at) VALUES ('ego', '2026-09-27', 9000, ?)`, [NOW])
    vi.stubGlobal('fetch', fakeGoogle().fetch)
    const response = await handle(request('/v1/health/connection', { method: 'DELETE' }), env)
    expect(response.status).toBe(200)
    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection.connected).toBe(false)
    expect(snapshot.days.map((day) => day.steps)).toEqual([9000])
  })
})

describe('google health sync', () => {
  it('writes ten recent days and one slice of history, then continues the history on the next run', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle({ sleeps: nights('2026-09-20', 9) })
    vi.stubGlobal('fetch', google.fetch)

    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0 })).toBe('synced')
    const first = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(first.connection).toMatchObject({
      historyFrom: '2026-06-27', historyComplete: false, timeZone: 'America/New_York',
      lastError: null, device: { name: 'Fitbit Air', batteryLevel: 64 }
    })
    expect(first.days[0].date).toBe('2026-06-27')
    expect(first.days.at(-1)?.date).toBe('2026-09-28')
    expect(first.days.find((day) => day.date === '2026-09-21')).toMatchObject({
      steps: 8021, distanceMeters: 6021, caloriesKcal: 2200.5, fatBurnMinutes: 0, cardioMinutes: 20, peakMinutes: 4,
      restingHeartRate: 58, hrvMs: 45.5, heartRateAvg: 71.4, weightKg: 80.25
    })
    expect(first.days.find((day) => day.date === '2026-09-28')?.steps).toBe(0)
    expect(first.days.find((day) => day.date === '2026-07-01')).toMatchObject({ steps: 8001, heartRateAvg: null, weightKg: null })
    expect(first.sleeps.map((sleep) => sleep.date)).toEqual(nights('2026-09-20', 9).map((night) => night.wake.slice(0, 10)))
    expect(first.sleeps[0]).toMatchObject({ startLocal: '2026-09-19T23:10', minutesAsleep: 415, deepMinutes: 70, remMinutes: 95, deleted: false })
    expect(first.heart).toEqual([
      { date: '2026-09-27', points: [[0, 59]], updatedAt: SYNC_AT.toISOString() },
      { date: '2026-09-28', points: [[660, 88]], updatedAt: SYNC_AT.toISOString() }
    ])

    const phoneRead = new Date(SYNC_AT.getTime() + 16 * 60_000)
    const later = new Date(SYNC_AT.getTime() + 20 * 60_000)
    expect(await syncHealth(env, 'ego', later, { minimumGapMs: 0 })).toBe('synced')
    expect((await dayRow(env, '2026-06-01'))?.steps).toBe(8001)
    expect(await dayRow(env, '2026-05-31')).toBeNull()
    expect((await dayRow(env, '2026-09-21'))?.updated_at).toBe(SYNC_AT.toISOString())
    const changed = await readHealthSnapshot(env, 'ego', phoneRead.toISOString(), later)
    expect(changed.days.map((day) => day.date)).toEqual(Array.from({ length: 26 }, (_, index) => shift('2026-06-01', index)))
    expect(changed.sleeps).toEqual([])
    expect(changed.heart).toEqual([])
  })

  it('finishes a year of history in five runs, the most calls a run makes staying under fifty', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle({ firstDay: '2025-01-01', sleeps: nights('2025-09-29', 365) })
    vi.stubGlobal('fetch', google.fetch)
    let most = 0
    for (let run = 0; run < 5; run += 1) {
      const before = google.calls.length
      await syncHealth(env, 'ego', new Date(SYNC_AT.getTime() + run * 60_000), { minimumGapMs: 0 })
      most = Math.max(most, google.calls.length - before)
    }
    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection).toMatchObject({ historyFrom: '2025-09-29', historyComplete: true })
    expect(snapshot.days).toHaveLength(365)
    expect(snapshot.sleeps).toHaveLength(365)
    expect(most).toBeLessThan(40)
  })

  it('marks a sleep removed in Google Health as deleted for the next incremental read', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle({ sleeps: nights('2026-09-26', 3) })
    vi.stubGlobal('fetch', google.fetch)
    await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0 })
    const removed = google.sleeps.splice(1, 1)[0]
    const later = new Date(SYNC_AT.getTime() + 20 * 60_000)
    await syncHealth(env, 'ego', later, { minimumGapMs: 0 })
    const changed = await readHealthSnapshot(env, 'ego', later.toISOString(), later)
    expect(changed.sleeps).toEqual([expect.objectContaining({ id: removed.id, deleted: true })])
    const fresh = await readHealthSnapshot(env, 'ego', null, later)
    expect(fresh.sleeps.map((sleep) => sleep.id)).not.toContain(removed.id)
  })

  it('reads only what the grant allows', async () => {
    const env = await environment()
    await connect(env, [HEALTH_SCOPES.activity])
    const google = fakeGoogle({ sleeps: nights('2026-09-26', 2) })
    vi.stubGlobal('fetch', google.fetch)
    await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0, timeZone: 'America/Chicago' })
    expect(google.calls.some((call) => call.includes('sleep') || call.includes('heart') || call.includes('settings'))).toBe(false)
    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection.timeZone).toBe('America/Chicago')
    expect(snapshot.days.find((day) => day.date === '2026-09-27')).toMatchObject({ steps: 8027, restingHeartRate: null })
  })

  it('falls back to the other spelling of the daily summary filter', async () => {
    const env = await environment()
    await connect(env)
    vi.stubGlobal('fetch', fakeGoogle({ acceptedFilter: 'camel' }).fetch)
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0 })).toBe('synced')
    expect((await dayRow(env, '2026-09-27'))?.resting_hr).toBe(58)
  })

  it('skips while another run is going and right after one finished', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle({ firstDay: '2026-09-01' })
    vi.stubGlobal('fetch', google.fetch)
    await exec(env.DB, `UPDATE health_connections SET sync_started_at = ?`, [new Date(SYNC_AT.getTime() - 30_000).toISOString()])
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 60_000 })).toBe('skipped')
    expect(google.calls).toHaveLength(0)

    await exec(env.DB, `UPDATE health_connections SET sync_started_at = NULL, history_from = '2025-01-01', sync_finished_at = ?`,
      [new Date(SYNC_AT.getTime() - 30_000).toISOString()])
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 60_000 })).toBe('skipped')
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 10_000 })).toBe('synced')
  })

  it('ends the connection when Google revokes the refresh token', async () => {
    const env = await environment()
    await connect(env)
    vi.stubGlobal('fetch', fakeGoogle({ refresh: 'revoked' }).fetch)
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0 })).toBe('failed')
    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection).toMatchObject({ connected: false, lastError: 'Google Health access ended. Connect again.' })
  })

  it('keeps D1 as it was and reports the problem when Google fails mid-run', async () => {
    const env = await environment()
    await connect(env)
    await exec(env.DB, `INSERT INTO health_days (dataset_id, date, steps, updated_at) VALUES ('ego', '2026-09-27', 9000, ?)`, [NOW])
    const google = fakeGoogle()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/dataTypes/sleep/') ? new Response('{}', { status: 429 }) : google.fetch(input, init)))
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0 })).toBe('failed')
    expect((await dayRow(env, '2026-09-27'))?.steps).toBe(9000)
    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection.lastError).toBe('Google Health asked Ego to slow down. The next sync tries again.')
    expect(snapshot.connection.connected).toBe(true)
  })

  it('skips a data type Google refuses and still writes the rest', async () => {
    const env = await environment()
    await connect(env)
    const google = fakeGoogle({ firstDay: '2026-09-20', sleeps: nights('2026-09-26', 2) })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes('/dataTypes/sleep/')
        ? new Response(JSON.stringify({ error: { code: 400, message: 'Invalid filter', status: 'INVALID_ARGUMENT' } }), { status: 400 })
        : google.fetch(input, init)))
    expect(await syncHealth(env, 'ego', SYNC_AT, { minimumGapMs: 0 })).toBe('synced')
    const snapshot = await readHealthSnapshot(env, 'ego', null, SYNC_AT)
    expect(snapshot.connection.lastError).toBe('Google Health refused sleep (Invalid filter). Everything else synced.')
    expect(snapshot.connection.historyFrom).toBe('2026-06-27')
    expect(snapshot.days.find((day) => day.date === '2026-09-27')?.steps).toBe(8027)
    expect(snapshot.sleeps).toEqual([])
  })

  it('syncs every live connection from the cron trigger', async () => {
    const env = await environment()
    await connect(env)
    vi.stubGlobal('fetch', fakeGoogle({ firstDay: '2026-09-20' }).fetch)
    await runScheduledHealthSync(env, SYNC_AT)
    expect((await dayRow(env, '2026-09-27'))?.steps).toBe(8027)
  })

  it('answers the phone with a sync followed by the rows it has not seen', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(SYNC_AT)
    const env = await environment()
    await connect(env)
    vi.stubGlobal('fetch', fakeGoogle({ firstDay: '2026-09-25' }).fetch)
    const response = await handle(request('/v1/health/sync', {
      method: 'POST',
      body: JSON.stringify({ since: null, timeZone: 'America/New_York' })
    }), env)
    const snapshot = (await response.json() as Envelope<HealthSnapshot>).data
    expect(snapshot.days.map((day) => day.date)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'])
    expect(snapshot.serverTime).toBe(SYNC_AT.toISOString())
    const read = await handle(request(`/v1/health/data?since=${encodeURIComponent(snapshot.serverTime)}`), env)
    expect((await read.json() as Envelope<HealthSnapshot>).data.connection.connected).toBe(true)
  })
})
