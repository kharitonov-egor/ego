import { describe, expect, it } from 'vitest'
import type { ApiResult, HealthConnection, HealthDay, HealthSleep, HealthSnapshot } from '@ego/api-contracts'
import type { HealthApi } from '../src/api-client'
import { cachedHealth, refreshHealth, saveHealthSnapshot } from '../src/health/store'
import {
  buildHealthIndex, latestValue, mainSleep, metricSeries, metricValue, periodFor, seriesStats, shiftPeriod,
  ticksFor, weekZoneMinutes
} from '../src/health/metrics'
import { openTestLedger } from './local-db'

const TODAY = '2026-09-28'

function shift(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function day(date: string, overrides: Partial<HealthDay> = {}): HealthDay {
  return {
    date, steps: 8000, distanceMeters: 6437.376, caloriesKcal: 2300, fatBurnMinutes: 10, cardioMinutes: 6, peakMinutes: 0,
    restingHeartRate: 58, hrvMs: 45, heartRateMin: 50, heartRateAvg: 70, heartRateMax: 140, weightKg: null,
    updatedAt: '2026-09-28T12:00:00.000Z', ...overrides
  }
}

function sleep(date: string, overrides: Partial<HealthSleep> = {}): HealthSleep {
  return {
    id: `night-${date}`, date, startTime: `${shift(date, -1)}T03:10:00.000Z`, endTime: `${date}T10:50:00.000Z`,
    startLocal: `${shift(date, -1)}T23:10`, endLocal: `${date}T06:50`, minutesAsleep: 420, minutesAwake: 40,
    minutesInBed: 460, deepMinutes: 70, lightMinutes: 250, remMinutes: 100, nap: false,
    stages: [{ kind: 'awake', start: 0, minutes: 10 }, { kind: 'light', start: 10, minutes: 60 }],
    deleted: false, updatedAt: '2026-09-28T12:00:00.000Z', ...overrides
  }
}

const connection: HealthConnection = {
  connected: true, accountLabel: 'me@example.com', grants: { activity: true, body: true, sleep: true, settings: true },
  lastSyncAt: '2026-09-28T12:00:00.000Z', lastError: null, historyFrom: '2025-09-29', historyComplete: true,
  timeZone: 'America/New_York', device: { name: 'Fitbit Air', batteryLevel: 64, lastSyncAt: '2026-09-28T11:50:00.000Z' }
}

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return { connection, days: [], sleeps: [], heart: [], serverTime: '2026-09-28T12:00:00.000Z', ...overrides }
}

function fakeHealthApi(results: Array<ApiResult<HealthSnapshot>>): HealthApi & { calls: Array<{ since: string | null; sync: boolean }> } {
  const calls: Array<{ since: string | null; sync: boolean }> = []
  const next = (): ApiResult<HealthSnapshot> => results.length > 1 ? results.shift() as ApiResult<HealthSnapshot> : results[0]
  return {
    calls,
    healthData: async (since) => { calls.push({ since, sync: false }); return next() },
    healthSync: async (since) => { calls.push({ since, sync: true }); return next() },
    healthConnect: async () => ({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'No' } }),
    healthDisconnect: async () => ({ ok: true, data: { disconnected: true } })
  }
}

describe('health store', () => {
  it('keeps the snapshot and reads it back', async () => {
    const db = await openTestLedger()
    await saveHealthSnapshot(db, snapshot({
      days: [day('2026-09-27'), day('2026-09-28', { steps: null })],
      sleeps: [sleep('2026-09-28')],
      heart: [{ date: '2026-09-28', points: [[0, 61], [5, 60]], updatedAt: '2026-09-28T12:00:00.000Z' }]
    }), true, '2026-09-28T12:00:05.000Z', TODAY)
    const cached = await cachedHealth(db)
    expect(cached.connection).toEqual(connection)
    expect(cached.serverTime).toBe('2026-09-28T12:00:00.000Z')
    expect(cached.fetchedAt).toBe('2026-09-28T12:00:05.000Z')
    expect(cached.days.map((item) => [item.date, item.steps])).toEqual([['2026-09-27', 8000], ['2026-09-28', null]])
    expect(cached.sleeps[0]).toEqual(sleep('2026-09-28'))
    expect(cached.heart[0].points).toEqual([[0, 61], [5, 60]])
  })

  it('merges a partial read, drops deleted nights, and prunes old heart curves', async () => {
    const db = await openTestLedger()
    await saveHealthSnapshot(db, snapshot({
      days: [day('2026-09-26'), day('2026-09-27')],
      sleeps: [sleep('2026-09-26'), sleep('2026-09-27')],
      heart: [{ date: '2026-09-10', points: [[0, 60]], updatedAt: '' }, { date: '2026-09-27', points: [[0, 60]], updatedAt: '' }]
    }), true, '2026-09-28T12:00:00.000Z', TODAY)
    await saveHealthSnapshot(db, snapshot({
      days: [day('2026-09-27', { steps: 12000 })],
      sleeps: [sleep('2026-09-26', { deleted: true })],
      serverTime: '2026-09-28T12:30:00.000Z'
    }), false, '2026-09-28T12:30:00.000Z', TODAY)
    const cached = await cachedHealth(db)
    expect(cached.days.map((item) => [item.date, item.steps])).toEqual([['2026-09-26', 8000], ['2026-09-27', 12000]])
    expect(cached.sleeps.map((item) => item.date)).toEqual(['2026-09-27'])
    expect(cached.heart.map((item) => item.date)).toEqual(['2026-09-27'])
  })

  it('asks for the whole copy once, then only for changes, and keeps the copy when a request fails', async () => {
    const db = await openTestLedger()
    const api = fakeHealthApi([
      { ok: true, data: snapshot({ days: [day('2026-09-27')] }) },
      { ok: true, data: snapshot({ days: [day('2026-09-28')], serverTime: '2026-09-28T13:00:00.000Z' }) },
      { ok: false, error: { code: 'OFFLINE', message: 'The Ego server is unreachable' } }
    ])
    const options = { sync: true, timeZone: 'America/New_York', now: '2026-09-28T12:00:00.000Z', today: TODAY }
    expect((await refreshHealth(db, api, options)).ok).toBe(true)
    expect((await refreshHealth(db, api, options)).ok).toBe(true)
    const failed = await refreshHealth(db, api, { ...options, sync: false })
    expect(failed.ok).toBe(false)
    expect(api.calls).toEqual([
      { since: null, sync: true },
      { since: '2026-09-28T12:00:00.000Z', sync: true },
      { since: '2026-09-28T13:00:00.000Z', sync: false }
    ])
    expect((await cachedHealth(db)).days.map((item) => item.date)).toEqual(['2026-09-27', '2026-09-28'])
  })
})

describe('health metrics', () => {
  const days = Array.from({ length: 40 }, (_, index) => day(shift(TODAY, index - 39), {
    steps: 5000 + index * 100,
    weightKg: index % 10 === 0 ? 80 : null,
    hrvMs: 45 + (index % 3) - 1,
    restingHeartRate: 58 + (index % 2)
  }))
  const index = buildHealthIndex(days, [
    sleep('2026-09-28'),
    sleep('2026-09-28', { id: 'nap', nap: true, minutesAsleep: 30 }),
    sleep('2026-09-27', { minutesAsleep: 380 })
  ], [])

  it('reads each metric for a day in the chosen units', () => {
    expect(metricValue(index, 'steps', TODAY, 'imperial')).toBe(8900)
    expect(metricValue(index, 'distance', TODAY, 'imperial')).toBeCloseTo(4, 5)
    expect(metricValue(index, 'distance', TODAY, 'metric')).toBeCloseTo(6.437, 3)
    expect(metricValue(index, 'sleep', TODAY, 'metric')).toBe(420)
    expect(metricValue(index, 'zone', TODAY, 'metric')).toBe(16)
    expect(mainSleep(index, TODAY)?.id).toBe('night-2026-09-28')
    expect(latestValue(index, 'weight', TODAY, 'imperial')).toEqual({ date: '2026-09-19', value: expect.closeTo(176.37, 1) })
  })

  it('scores readiness once a week of history exists', () => {
    expect(index.readiness.has(days[3].date)).toBe(false)
    expect(index.readiness.get(TODAY)?.parts.map((part) => part.key)).toEqual(['hrv', 'restingHeartRate', 'sleep'])
    expect(metricValue(index, 'readiness', TODAY, 'metric')).toBe(index.readiness.get(TODAY)?.score)
  })

  it('counts zone minutes from Monday', () => {
    expect(weekZoneMinutes(index, '2026-09-28')).toBe(16)
    expect(weekZoneMinutes(index, '2026-09-27')).toBe(16 * 7)
  })

  it('builds week, month, and year periods', () => {
    expect(periodFor('week', TODAY)).toMatchObject({ start: '2026-09-28', end: '2026-10-04', label: 'Sep 28 to Oct 4' })
    expect(periodFor('week', '2026-09-24')).toMatchObject({ start: '2026-09-21', end: '2026-09-27', label: 'Sep 21 to 27' })
    expect(periodFor('month', TODAY)).toMatchObject({ start: '2026-09-01', end: '2026-09-30', label: 'September 2026' })
    expect(periodFor('year', TODAY)).toMatchObject({ start: '2025-10-01', end: '2026-09-30' })
    expect(shiftPeriod(periodFor('month', TODAY), -1)).toMatchObject({ start: '2026-08-01', end: '2026-08-31' })
    expect(shiftPeriod(periodFor('week', TODAY), -1).start).toBe('2026-09-21')
  })

  it('lays out a series with no values after today and monthly averages for a year', () => {
    const week = metricSeries(index, 'steps', periodFor('week', TODAY), 'metric', TODAY)
    expect(week.map((point) => point.value)).toEqual([8900, null, null, null, null, null, null])
    const year = metricSeries(index, 'steps', periodFor('year', TODAY), 'metric', TODAY)
    expect(year).toHaveLength(12)
    expect(year[10].value).toBeCloseTo(days.filter((item) => item.date.startsWith('2026-08')).reduce((total, item) => total + (item.steps ?? 0), 0) / 12, 5)
    expect(year[0].value).toBeNull()
    const stats = seriesStats(metricSeries(index, 'steps', periodFor('month', TODAY), 'metric', TODAY))
    expect(stats.count).toBe(28)
    expect(stats.high?.key).toBe(TODAY)
    expect(stats.total).toBe(Array.from({ length: 28 }, (_, offset) => 6200 + offset * 100).reduce((total, value) => total + value, 0))
  })

  it('picks clean ticks, and whole hours for sleep', () => {
    expect(ticksFor([8200, 9400], true, 10000)).toEqual([0, 5000, 10000])
    expect(ticksFor([56, 61], false)).toEqual([56, 58, 60, 62])
    expect(ticksFor([380, 420], true, 450, 60)).toEqual([0, 180, 360, 540])
  })
})
