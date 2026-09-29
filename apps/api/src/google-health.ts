import type { HealthDevice, HealthSleepStage, HealthSleepStageKind } from '@ego/api-contracts'

export const GOOGLE_HEALTH_API = 'https://health.googleapis.com/v4/users/me'

export const HEALTH_SCOPES = {
  activity: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  body: 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  sleep: 'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  settings: 'https://www.googleapis.com/auth/googlehealth.settings.readonly'
} as const

const REQUEST_TIMEOUT_MS = 20000
const SLEEP_PAGE_SIZE = 25
const MAX_PAGES = 12
const DAY_MS = 86_400_000

export type DayColumn =
  | 'steps' | 'distance_m' | 'calories_kcal' | 'fat_burn_minutes' | 'cardio_minutes' | 'peak_minutes'
  | 'resting_hr' | 'hrv_ms' | 'hr_min' | 'hr_avg' | 'hr_max' | 'weight_kg'

export type DayValues = Partial<Record<DayColumn, number | null>>

export interface SleepRow {
  id: string
  date: string
  startTime: string
  endTime: string
  startLocal: string
  endLocal: string
  minutesAsleep: number
  minutesAwake: number
  minutesInBed: number
  deepMinutes: number | null
  lightMinutes: number | null
  remMinutes: number | null
  nap: boolean
  stages: HealthSleepStage[]
}

export interface HealthSettings {
  timeZone: string | null
}

export class GoogleHealthError extends Error {
  constructor(message: string, readonly status: number, readonly detail: string | null = null) {
    super(message)
  }
}

/** Google's own reason, such as an invalid filter. It never holds tokens or health data. */
async function googleErrorDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    const error = isRecord(body) && isRecord(body.error) ? body.error : null
    return typeof error?.message === 'string' ? error.message.slice(0, 300) : null
  } catch {
    return null
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordAt(value: unknown, key: string): JsonRecord | null {
  if (!isRecord(value)) return null
  const child = value[key]
  return isRecord(child) ? child : null
}

/** Proto3 JSON sends int64 as a string and leaves out any field that is zero. */
function numberAt(value: JsonRecord | null, key: string): number | null {
  if (!value) return null
  const raw = value[key]
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw)
  return null
}

function stringAt(value: JsonRecord | null, key: string): string | null {
  const raw = value?.[key]
  return typeof raw === 'string' && raw !== '' ? raw : null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function isoFromGoogleDate(value: unknown): string | null {
  if (!isRecord(value)) return null
  const year = numberAt(value, 'year')
  const month = numberAt(value, 'month')
  const day = numberAt(value, 'day')
  if (!year || !month || !day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

function civilDate(iso: string): { date: { year: number; month: number; day: number } } {
  const [year, month, day] = iso.split('-').map(Number)
  return { date: { year, month, day } }
}

/** A CivilDateTime as YYYY-MM-DDTHH:mm. Midnight arrives with no time at all. */
function civilLocal(value: unknown): string | null {
  if (!isRecord(value)) return null
  const date = isoFromGoogleDate(value.date)
  if (!date) return null
  const time = recordAt(value, 'time')
  return `${date}T${pad(numberAt(time, 'hours') ?? 0)}:${pad(numberAt(time, 'minutes') ?? 0)}`
}

function durationSeconds(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(value)
  return match ? Number(match[1]) : null
}

function localFromOffset(instant: string, offset: unknown): string | null {
  const ms = Date.parse(instant)
  const seconds = durationSeconds(offset)
  if (!Number.isFinite(ms) || seconds === null) return null
  return new Date(ms + seconds * 1000).toISOString().slice(0, 16)
}

export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

export function datesIn(from: string, to: string): string[] {
  const dates: string[] = []
  for (let date = from; date < to; date = shiftDate(date, 1)) dates.push(date)
  return dates
}

/** Splits [from, to) into pieces no longer than `maxDays`, since Google caps each roll-up range. */
export function dateChunks(from: string, to: string, maxDays: number): Array<[string, string]> {
  const chunks: Array<[string, string]> = []
  for (let start = from; start < to;) {
    const end = shiftDate(start, maxDays) < to ? shiftDate(start, maxDays) : to
    chunks.push([start, end])
    start = end
  }
  return chunks
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

const partFormatters = new Map<string, Intl.DateTimeFormat>()

function localClock(ms: number, timeZone: string): { date: string; minute: number } {
  let formatter = partFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    })
    partFormatters.set(timeZone, formatter)
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute)
  }
}

export function localDate(ms: number, timeZone: string): string {
  return localClock(ms, timeZone).date
}

/** The instant a local day begins. Accurate except in the hour a clock change skips. */
export function startOfLocalDay(date: string, timeZone: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`)
  const seen = localClock(guess, timeZone)
  const offsetMinutes = daysBetween(date, seen.date) * 1440 + seen.minute
  return guess - offsetMinutes * 60_000
}

function offsetMinutes(ms: number, timeZone: string): number {
  const seen = localClock(ms, timeZone)
  const utc = new Date(ms).toISOString()
  const utcMinute = Number(utc.slice(11, 13)) * 60 + Number(utc.slice(14, 16))
  return daysBetween(utc.slice(0, 10), seen.date) * 1440 + seen.minute - utcMinute
}

/**
 * Formatting every point through Intl would spend most of a free-plan cron run's CPU, so the offset
 * is looked up once and each point is shifted by it, unless a clock change falls inside the range.
 */
export function bucketHeartRate(
  points: Array<{ startTime: string; bpm: number }>, timeZone: string
): Map<string, Array<[number, number]>> {
  const byDate = new Map<string, Array<[number, number]>>()
  const instants = points.map((point) => Date.parse(point.startTime)).filter(Number.isFinite)
  if (instants.length === 0) return byDate
  const first = offsetMinutes(Math.min(...instants), timeZone)
  const steady = first === offsetMinutes(Math.max(...instants), timeZone)
  for (const point of points) {
    const ms = Date.parse(point.startTime)
    if (!Number.isFinite(ms)) continue
    const offset = steady ? first : offsetMinutes(ms, timeZone)
    const local = new Date(ms + offset * 60_000).toISOString()
    const date = local.slice(0, 10)
    const minute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
    const list = byDate.get(date) ?? []
    list.push([minute, Math.round(point.bpm)])
    byDate.set(date, list)
  }
  for (const list of byDate.values()) list.sort((a, b) => a[0] - b[0])
  return byDate
}

const STAGE_KINDS: Record<string, HealthSleepStageKind> = {
  AWAKE: 'awake', LIGHT: 'light', DEEP: 'deep', REM: 'rem', ASLEEP: 'asleep', RESTLESS: 'restless'
}

export function parseSleep(point: unknown): SleepRow | null {
  const sleep = recordAt(point, 'sleep')
  const interval = recordAt(sleep, 'interval')
  const startTime = stringAt(interval, 'startTime')
  const endTime = stringAt(interval, 'endTime')
  if (!sleep || !interval || !startTime || !endTime) return null
  const startMs = Date.parse(startTime)
  const endMs = Date.parse(endTime)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null
  const startLocal = civilLocal(interval.civilStartTime) ?? localFromOffset(startTime, interval.startUtcOffset) ?? startTime.slice(0, 16)
  const endLocal = civilLocal(interval.civilEndTime) ?? localFromOffset(endTime, interval.endUtcOffset) ?? endTime.slice(0, 16)
  const name = isRecord(point) && typeof point.name === 'string' ? point.name : ''
  const id = name.split('/').pop() || `sleep-${startTime}`

  const stages: HealthSleepStage[] = []
  for (const raw of Array.isArray(sleep.stages) ? sleep.stages : []) {
    if (!isRecord(raw)) continue
    const kind = typeof raw.type === 'string' ? STAGE_KINDS[raw.type] : undefined
    const from = Date.parse(stringAt(raw, 'startTime') ?? '')
    const to = Date.parse(stringAt(raw, 'endTime') ?? '')
    if (!kind || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue
    stages.push({ kind, start: Math.round((from - startMs) / 60_000), minutes: Math.round((to - from) / 60_000) })
  }
  stages.sort((a, b) => a.start - b.start)

  const summary = recordAt(sleep, 'summary')
  const byStage = new Map<string, number>()
  for (const raw of Array.isArray(summary?.stagesSummary) ? summary.stagesSummary : []) {
    if (isRecord(raw) && typeof raw.type === 'string') byStage.set(raw.type, numberAt(raw, 'minutes') ?? 0)
  }
  const stageMinutes = (kind: HealthSleepStageKind): number =>
    stages.filter((stage) => stage.kind === kind).reduce((total, stage) => total + stage.minutes, 0)
  const staged = sleep.type === 'STAGES' || byStage.has('DEEP') || stages.some((stage) => stage.kind === 'deep')
  const minutesInBed = numberAt(summary, 'minutesInSleepPeriod') ?? Math.round((endMs - startMs) / 60_000)
  const minutesAwake = numberAt(summary, 'minutesAwake') ?? stageMinutes('awake')
  const minutesAsleep = numberAt(summary, 'minutesAsleep') ?? Math.max(0, minutesInBed - minutesAwake)
  const stagedMinutes = (type: string, kind: HealthSleepStageKind): number | null =>
    staged ? byStage.get(type) ?? stageMinutes(kind) : null

  return {
    id,
    date: endLocal.slice(0, 10),
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    startLocal,
    endLocal,
    minutesAsleep,
    minutesAwake,
    minutesInBed,
    deepMinutes: stagedMinutes('DEEP', 'deep'),
    lightMinutes: stagedMinutes('LIGHT', 'light'),
    remMinutes: stagedMinutes('REM', 'rem'),
    nap: recordAt(sleep, 'metadata')?.nap === true,
    stages
  }
}

interface DailyRollupSpec {
  dataType: string
  field: string
  maxDays: number
  /** Google omits the value when nothing was worn that day, and sends `{}` for a worn day of zeros. */
  read: (value: JsonRecord) => DayValues
}

export const DAILY_ROLLUPS = {
  steps: {
    dataType: 'steps', field: 'steps', maxDays: 90,
    read: (value) => ({ steps: numberAt(value, 'countSum') ?? 0 })
  },
  distance: {
    dataType: 'distance', field: 'distance', maxDays: 90,
    read: (value) => ({ distance_m: (numberAt(value, 'millimetersSum') ?? 0) / 1000 })
  },
  calories: {
    dataType: 'total-calories', field: 'totalCalories', maxDays: 14,
    read: (value) => ({ calories_kcal: numberAt(value, 'kcalSum') ?? 0 })
  },
  zoneMinutes: {
    dataType: 'active-zone-minutes', field: 'activeZoneMinutes', maxDays: 90,
    read: (value) => ({
      fat_burn_minutes: numberAt(value, 'sumInFatBurnHeartZone') ?? 0,
      cardio_minutes: numberAt(value, 'sumInCardioHeartZone') ?? 0,
      peak_minutes: numberAt(value, 'sumInPeakHeartZone') ?? 0
    })
  },
  heartRate: {
    dataType: 'heart-rate', field: 'heartRate', maxDays: 14,
    read: (value) => ({
      hr_min: numberAt(value, 'beatsPerMinuteMin'),
      hr_avg: numberAt(value, 'beatsPerMinuteAvg'),
      hr_max: numberAt(value, 'beatsPerMinuteMax')
    })
  },
  weight: {
    dataType: 'weight', field: 'weight', maxDays: 90,
    read: (value) => {
      const grams = numberAt(value, 'weightGramsAvg')
      return { weight_kg: grams === null ? null : grams / 1000 }
    }
  }
} satisfies Record<string, DailyRollupSpec>

export type DailyRollupName = keyof typeof DAILY_ROLLUPS

export const ROLLUP_COLUMNS: Record<DailyRollupName, DayColumn[]> = {
  steps: ['steps'],
  distance: ['distance_m'],
  calories: ['calories_kcal'],
  zoneMinutes: ['fat_burn_minutes', 'cardio_minutes', 'peak_minutes'],
  heartRate: ['hr_min', 'hr_avg', 'hr_max'],
  weight: ['weight_kg']
}

interface DailySummarySpec {
  dataType: string
  field: string
  /** The REST reference names the filter field in camelCase and the RPC reference in snake_case. */
  filterNames: [string, string]
  read: (value: JsonRecord) => DayValues
}

export const DAILY_SUMMARIES = {
  restingHeartRate: {
    dataType: 'daily-resting-heart-rate',
    field: 'dailyRestingHeartRate',
    filterNames: ['dailyRestingHeartRate', 'daily_resting_heart_rate'],
    read: (value) => ({ resting_hr: numberAt(value, 'beatsPerMinute') })
  },
  hrv: {
    dataType: 'daily-heart-rate-variability',
    field: 'dailyHeartRateVariability',
    filterNames: ['dailyHeartRateVariability', 'daily_heart_rate_variability'],
    read: (value) => ({ hrv_ms: numberAt(value, 'averageHeartRateVariabilityMilliseconds') })
  }
} satisfies Record<string, DailySummarySpec>

export type DailySummaryName = keyof typeof DAILY_SUMMARIES

export const SUMMARY_COLUMNS: Record<DailySummaryName, DayColumn[]> = {
  restingHeartRate: ['resting_hr'],
  hrv: ['hrv_ms']
}

/** Which filter spelling Google accepted last, so later runs skip the one it rejects. */
let summaryFilterStyle: 0 | 1 = 0

export interface GoogleHealthClient {
  dailyRollup: (name: DailyRollupName, from: string, to: string) => Promise<Map<string, DayValues>>
  dailySummary: (name: DailySummaryName, from: string, to: string) => Promise<Map<string, DayValues>>
  sleeps: (from: string, to: string) => Promise<SleepRow[]>
  heartCurve: (startMs: number, endMs: number) => Promise<Array<{ startTime: string; bpm: number }>>
  settings: () => Promise<HealthSettings>
  device: () => Promise<HealthDevice | null>
}

export function googleHealthClient(accessToken: string): GoogleHealthClient {
  const call = async (path: string, init: RequestInit = {}): Promise<JsonRecord> => {
    let response: Response
    try {
      response = await fetch(`${GOOGLE_HEALTH_API}${path}`, {
        ...init,
        // Workers reject redirect: 'error'. A 3xx still fails below, since only 2xx is ok.
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {})
        }
      })
    } catch (error: unknown) {
      console.error(`google-health ${path.split('?')[0]} failed before a response`, error instanceof Error ? error.message : error)
      throw new GoogleHealthError('Google Health did not answer', 0)
    }
    if (!response.ok) {
      const detail = await googleErrorDetail(response)
      console.error(`google-health ${path.split('?')[0]} HTTP ${response.status}`, detail ?? '')
      throw new GoogleHealthError(`Google Health answered with HTTP ${response.status}`, response.status, detail)
    }
    let body: unknown
    try { body = await response.json() } catch { throw new GoogleHealthError('Google Health sent something unreadable', response.status) }
    return isRecord(body) ? body : {}
  }

  const pages = async (
    first: (pageToken: string | null) => Promise<JsonRecord>, listKey: string
  ): Promise<unknown[]> => {
    const items: unknown[] = []
    let token: string | null = null
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body = await first(token)
      const list = body[listKey]
      if (Array.isArray(list)) items.push(...list)
      token = stringAt(body, 'nextPageToken')
      if (!token) break
    }
    return items
  }

  return {
    async dailyRollup(name, from, to) {
      const spec: DailyRollupSpec = DAILY_ROLLUPS[name]
      const values = new Map<string, DayValues>()
      for (const [start, end] of dateChunks(from, to, spec.maxDays)) {
        const points = await pages((pageToken) => call(`/dataTypes/${spec.dataType}/dataPoints:dailyRollUp`, {
          method: 'POST',
          body: JSON.stringify({
            range: { start: civilDate(start), end: civilDate(end) },
            windowSizeDays: 1,
            pageSize: 1000,
            ...(pageToken ? { pageToken } : {})
          })
        }), 'rollupDataPoints')
        for (const point of points) {
          const date = isoFromGoogleDate(recordAt(point, 'civilStartTime')?.date)
          const value = recordAt(point, spec.field)
          if (date && value) values.set(date, spec.read(value))
        }
      }
      return values
    },

    async dailySummary(name, from, to) {
      const spec: DailySummarySpec = DAILY_SUMMARIES[name]
      const request = (style: 0 | 1) => pages((pageToken) => {
        const field = spec.filterNames[style]
        const params = new URLSearchParams({
          filter: `${field}.date >= "${from}" AND ${field}.date < "${to}"`,
          pageSize: '1000'
        })
        if (pageToken) params.set('pageToken', pageToken)
        return call(`/dataTypes/${spec.dataType}/dataPoints?${params}`)
      }, 'dataPoints')
      const tried = summaryFilterStyle
      let points: unknown[]
      try {
        points = await request(tried)
      } catch (error: unknown) {
        if (!(error instanceof GoogleHealthError) || error.status !== 400) throw error
        const other = tried === 0 ? 1 : 0
        points = await request(other)
        summaryFilterStyle = other
      }
      const values = new Map<string, DayValues>()
      for (const point of points) {
        const value = recordAt(point, spec.field)
        const date = isoFromGoogleDate(value?.date)
        if (date && value) values.set(date, spec.read(value))
      }
      return values
    },

    async sleeps(from, to) {
      const points = await pages((pageToken) => {
        const params = new URLSearchParams({
          filter: `sleep.interval.civil_end_time >= "${from}" AND sleep.interval.civil_end_time < "${to}"`,
          pageSize: String(SLEEP_PAGE_SIZE)
        })
        if (pageToken) params.set('pageToken', pageToken)
        return call(`/dataTypes/sleep/dataPoints?${params}`)
      }, 'dataPoints')
      return points.map(parseSleep).filter((row): row is SleepRow => row !== null)
    },

    async heartCurve(startMs, endMs) {
      const points = await pages((pageToken) => call('/dataTypes/heart-rate/dataPoints:rollUp', {
        method: 'POST',
        body: JSON.stringify({
          range: { startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString() },
          windowSize: '300s',
          pageSize: 1000,
          ...(pageToken ? { pageToken } : {})
        })
      }), 'rollupDataPoints')
      const curve: Array<{ startTime: string; bpm: number }> = []
      for (const point of points) {
        const startTime = isRecord(point) ? stringAt(point, 'startTime') : null
        const bpm = numberAt(recordAt(point, 'heartRate'), 'beatsPerMinuteAvg')
        if (startTime && bpm !== null && bpm > 0) curve.push({ startTime, bpm })
      }
      return curve
    },

    async settings() {
      const body = await call('/settings')
      const timeZone = stringAt(body, 'timeZone')
      return { timeZone: isValidTimeZone(timeZone) ? timeZone : null }
    },

    async device() {
      const body = await call('/pairedDevices?pageSize=20')
      const devices = (Array.isArray(body.pairedDevices) ? body.pairedDevices : []).filter(isRecord)
      const trackers = devices.filter((device) => device.deviceType !== 'SCALE')
      const newest = (trackers.length > 0 ? trackers : devices)
        .sort((a, b) => (stringAt(b, 'lastSyncTime') ?? '').localeCompare(stringAt(a, 'lastSyncTime') ?? ''))[0]
      if (!newest) return null
      return {
        name: stringAt(newest, 'deviceVersion') ?? 'Fitbit',
        batteryLevel: numberAt(newest, 'batteryLevel'),
        lastSyncAt: stringAt(newest, 'lastSyncTime')
      }
    }
  }
}
