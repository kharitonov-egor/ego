import {
  HEALTH_HEART_CURVE_DAYS,
  type ApiResult, type HealthConnection, type HealthDay, type HealthHeartDay, type HealthSleep,
  type HealthSleepStage, type HealthSnapshot
} from '@ego/api-contracts'
import type { HealthApi } from '../api-client'
import { withPreparedRuns, type LocalDatabase } from '../database/types'
import { shiftIso } from '../dates'

export interface CachedHealth {
  connection: HealthConnection | null
  days: HealthDay[]
  sleeps: HealthSleep[]
  heart: HealthHeartDay[]
  /** The Worker's clock at the last read, sent back so it answers with only the difference. */
  serverTime: string | null
  fetchedAt: string | null
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

interface SleepRow {
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
}

interface StateRow {
  connection: string | null
  server_time: string | null
  fetched_at: string | null
}

const STAGE_KINDS = new Set(['awake', 'light', 'deep', 'rem', 'asleep', 'restless'])

function parseJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function isStage(value: unknown): value is HealthSleepStage {
  if (typeof value !== 'object' || value === null) return false
  const stage = value as Record<string, unknown>
  return typeof stage.kind === 'string' && STAGE_KINDS.has(stage.kind) &&
    typeof stage.start === 'number' && typeof stage.minutes === 'number'
}

function isConnection(value: unknown): value is HealthConnection {
  if (typeof value !== 'object' || value === null) return false
  const connection = value as Record<string, unknown>
  return typeof connection.connected === 'boolean' && typeof connection.grants === 'object' && connection.grants !== null
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

function toSleep(row: SleepRow): HealthSleep {
  const stages = parseJson(row.stages)
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
    stages: Array.isArray(stages) ? stages.filter(isStage) : [],
    deleted: false,
    updatedAt: row.updated_at
  }
}

function toHeart(row: { date: string; points: string; updated_at: string }): HealthHeartDay {
  const points = parseJson(row.points)
  return {
    date: row.date,
    points: Array.isArray(points)
      ? points.filter((item): item is [number, number] => Array.isArray(item) && typeof item[0] === 'number' && typeof item[1] === 'number')
      : [],
    updatedAt: row.updated_at
  }
}

export async function cachedHealth(db: LocalDatabase): Promise<CachedHealth> {
  const [days, sleeps, heart, state] = await Promise.all([
    db.all<DayRow>('SELECT * FROM health_days ORDER BY date'),
    db.all<SleepRow>('SELECT * FROM health_sleeps ORDER BY start_time'),
    db.all<{ date: string; points: string; updated_at: string }>('SELECT * FROM health_heart ORDER BY date'),
    db.all<StateRow>('SELECT connection, server_time, fetched_at FROM health_state WHERE id = 1')
  ])
  const connection = parseJson(state[0]?.connection ?? null)
  return {
    connection: isConnection(connection) ? connection : null,
    days: days.map(toDay),
    sleeps: sleeps.map(toSleep),
    heart: heart.map(toHeart),
    serverTime: state[0]?.server_time ?? null,
    fetchedAt: state[0]?.fetched_at ?? null
  }
}

/** Merges what the Worker sent into the copy. A read with no `since` replaces the copy outright. */
export async function saveHealthSnapshot(
  db: LocalDatabase, snapshot: HealthSnapshot, replace: boolean, fetchedAt: string, today: string
): Promise<void> {
  await db.transaction((tx) => withPreparedRuns(tx, async (cached) => {
    if (replace) {
      await cached.run('DELETE FROM health_days')
      await cached.run('DELETE FROM health_sleeps')
      await cached.run('DELETE FROM health_heart')
    }
    for (const day of snapshot.days) {
      await cached.run(`INSERT OR REPLACE INTO health_days
        (date, steps, distance_m, calories_kcal, fat_burn_minutes, cardio_minutes, peak_minutes,
          resting_hr, hrv_ms, hr_min, hr_avg, hr_max, weight_kg, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        day.date, day.steps, day.distanceMeters, day.caloriesKcal, day.fatBurnMinutes, day.cardioMinutes,
        day.peakMinutes, day.restingHeartRate, day.hrvMs, day.heartRateMin, day.heartRateAvg,
        day.heartRateMax, day.weightKg, day.updatedAt
      ])
    }
    for (const sleep of snapshot.sleeps) {
      if (sleep.deleted) {
        await cached.run('DELETE FROM health_sleeps WHERE id = ?', [sleep.id])
        continue
      }
      await cached.run(`INSERT OR REPLACE INTO health_sleeps
        (id, date, start_time, end_time, start_local, end_local, minutes_asleep, minutes_awake,
          minutes_in_bed, deep_minutes, light_minutes, rem_minutes, nap, stages, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        sleep.id, sleep.date, sleep.startTime, sleep.endTime, sleep.startLocal, sleep.endLocal,
        sleep.minutesAsleep, sleep.minutesAwake, sleep.minutesInBed, sleep.deepMinutes, sleep.lightMinutes,
        sleep.remMinutes, sleep.nap ? 1 : 0, JSON.stringify(sleep.stages), sleep.updatedAt
      ])
    }
    for (const day of snapshot.heart) {
      await cached.run('INSERT OR REPLACE INTO health_heart (date, points, updated_at) VALUES (?, ?, ?)',
        [day.date, JSON.stringify(day.points), day.updatedAt])
    }
    await cached.run('DELETE FROM health_heart WHERE date < ?', [shiftIso(today, -(HEALTH_HEART_CURVE_DAYS - 1))])
    await cached.run(`INSERT INTO health_state (id, connection, server_time, fetched_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET connection = excluded.connection, server_time = excluded.server_time,
        fetched_at = excluded.fetched_at`, [JSON.stringify(snapshot.connection), snapshot.serverTime, fetchedAt])
  }))
}

export async function forgetHealth(db: LocalDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM health_days')
    await tx.run('DELETE FROM health_sleeps')
    await tx.run('DELETE FROM health_heart')
    await tx.run('DELETE FROM health_state')
  })
}

/**
 * Asks the Worker for everything that changed since the last read, pulling from Google first when
 * `sync` is set. The copy on the phone is untouched when the request fails.
 */
export async function refreshHealth(
  db: LocalDatabase,
  api: HealthApi,
  options: { sync: boolean; timeZone: string | null; now: string; today: string }
): Promise<ApiResult<HealthConnection>> {
  const state = await db.all<StateRow>('SELECT server_time FROM health_state WHERE id = 1')
  const since = state[0]?.server_time ?? null
  const result = options.sync ? await api.healthSync(since, options.timeZone) : await api.healthData(since)
  if (!result.ok) return result
  await saveHealthSnapshot(db, result.data, since === null, options.now, options.today)
  return { ok: true, data: result.data.connection }
}
