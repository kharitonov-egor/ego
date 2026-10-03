import type { HealthDay, HealthHeartDay, HealthSleep } from '@ego/api-contracts'
import {
  DAILY_STEP_TARGET, SLEEP_TARGET_MINUTES, bodyWeightIn, bodyWeightUnit, distanceIn, distanceUnit,
  formatSleepMinutes, mainSleepMinutes, readinessFor, zoneMinutesOf, type HealthUnits, type Readiness
} from '@ego/core'
import { isoFromParts, parseIso, shiftIso } from '../dates'

export type HealthMetric =
  | 'readiness' | 'steps' | 'sleep' | 'calories' | 'distance' | 'zone' | 'heart' | 'resting' | 'hrv' | 'weight'

export const HEALTH_METRICS: readonly HealthMetric[] = [
  'readiness', 'steps', 'sleep', 'calories', 'distance', 'zone', 'heart', 'resting', 'hrv', 'weight'
]

export function isHealthMetric(value: unknown): value is HealthMetric {
  return typeof value === 'string' && (HEALTH_METRICS as readonly string[]).includes(value)
}

export interface MetricSpec {
  title: string
  mark: 'bar' | 'line'
  /** Totals are summed over a day and averaged over longer spans. Levels are only ever averaged. */
  summary: 'total' | 'level'
  unit: (units: HealthUnits) => string
  format: (value: number) => string
  tick: (value: number) => string
  target?: number
  /** Where the chart's value axis starts, so a trend is not flattened against zero. */
  fromZero: boolean
  /** Ticks land on multiples of this, so sleep minutes tick on whole hours. */
  tickUnit?: number
}

const whole = (value: number): string => Math.round(value).toLocaleString('en-US')
const compact = (value: number): string => value >= 10000 ? `${Math.round(value / 1000)}k` : whole(value)
const oneDecimal = (value: number): string => (Math.round(value * 10) / 10).toFixed(1)
/** A narrow weight range ticks in tenths; rounding those to whole numbers would repeat a label. */
const wholeOrTenth = (value: number): string => {
  const tenths = Math.round(value * 10) / 10
  return Number.isInteger(tenths) ? whole(tenths) : tenths.toFixed(1)
}

export const METRIC_SPECS: Record<HealthMetric, MetricSpec> = {
  readiness: { title: 'Readiness', mark: 'line', summary: 'level', unit: () => '', format: whole, tick: whole, fromZero: true },
  steps: { title: 'Steps', mark: 'bar', summary: 'total', unit: () => 'steps', format: whole, tick: compact, target: DAILY_STEP_TARGET, fromZero: true },
  sleep: {
    title: 'Sleep', mark: 'bar', summary: 'total', unit: () => '', format: formatSleepMinutes,
    tick: (value) => `${Math.round(value / 60)}h`, target: SLEEP_TARGET_MINUTES, fromZero: true, tickUnit: 60
  },
  calories: { title: 'Calories', mark: 'bar', summary: 'total', unit: () => 'kcal', format: whole, tick: compact, fromZero: true },
  distance: { title: 'Distance', mark: 'bar', summary: 'total', unit: distanceUnit, format: (value) => value.toFixed(2), tick: oneDecimal, fromZero: true },
  zone: { title: 'Zone minutes', mark: 'bar', summary: 'total', unit: () => 'min', format: whole, tick: whole, fromZero: true },
  heart: { title: 'Heart rate', mark: 'line', summary: 'level', unit: () => 'bpm', format: whole, tick: whole, fromZero: false },
  resting: { title: 'Resting heart rate', mark: 'line', summary: 'level', unit: () => 'bpm', format: whole, tick: whole, fromZero: false },
  hrv: { title: 'Heart rate variability', mark: 'line', summary: 'level', unit: () => 'ms', format: whole, tick: whole, fromZero: false },
  weight: { title: 'Weight', mark: 'line', summary: 'level', unit: bodyWeightUnit, format: oneDecimal, tick: wholeOrTenth, fromZero: false }
}

export interface HealthIndex {
  days: Map<string, HealthDay>
  /** Sessions by the day they ended, oldest first. */
  nights: Map<string, HealthSleep[]>
  heart: Map<string, HealthHeartDay>
  readiness: Map<string, Readiness>
  firstDate: string | null
}

export function buildHealthIndex(days: readonly HealthDay[], sleeps: readonly HealthSleep[], heart: readonly HealthHeartDay[]): HealthIndex {
  const nights = new Map<string, HealthSleep[]>()
  for (const sleep of sleeps) nights.set(sleep.date, [...nights.get(sleep.date) ?? [], sleep])
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const sleepDays = sleeps.map((sleep) => ({ date: sleep.date, minutesAsleep: sleep.minutesAsleep, nap: sleep.nap }))
  const readiness = new Map<string, Readiness>()
  for (let index = 0; index < sorted.length; index += 1) {
    const day = sorted[index]
    if (day.hrvMs === null && day.restingHeartRate === null) continue
    let first = index
    while (first > 0 && sorted[first - 1].date >= shiftIso(day.date, -30)) first -= 1
    const value = readinessFor(day.date, sorted.slice(first, index + 1), sleepDays)
    if (value) readiness.set(day.date, value)
  }
  const dates = [...sorted.map((day) => day.date), ...sleeps.map((sleep) => sleep.date)].sort()
  return {
    days: new Map(sorted.map((day) => [day.date, day])),
    nights,
    heart: new Map(heart.map((day) => [day.date, day])),
    readiness,
    firstDate: dates[0] ?? null
  }
}

export function mainSleep(index: HealthIndex, date: string): HealthSleep | null {
  const sessions = (index.nights.get(date) ?? []).filter((sleep) => !sleep.nap)
  return sessions.reduce<HealthSleep | null>((longest, sleep) =>
    !longest || sleep.minutesAsleep > longest.minutesAsleep ? sleep : longest, null)
}

export function metricValue(index: HealthIndex, metric: HealthMetric, date: string, units: HealthUnits): number | null {
  const day = index.days.get(date)
  switch (metric) {
    case 'readiness': return index.readiness.get(date)?.score ?? null
    case 'sleep': return mainSleepMinutes(index.nights.get(date) ?? [], date)
    case 'steps': return day?.steps ?? null
    case 'calories': return day?.caloriesKcal ?? null
    case 'distance': return day?.distanceMeters == null ? null : distanceIn(day.distanceMeters, units)
    case 'zone': return day ? zoneMinutesOf(day) : null
    case 'heart': return day?.heartRateAvg ?? null
    case 'resting': return day?.restingHeartRate ?? null
    case 'hrv': return day?.hrvMs ?? null
    case 'weight': return day?.weightKg == null ? null : bodyWeightIn(day.weightKg, units)
  }
}

/** The most recent value on or before `date`, for readings like weight that are not taken daily. */
export function latestValue(
  index: HealthIndex, metric: HealthMetric, date: string, units: HealthUnits, lookbackDays = 90
): { date: string; value: number } | null {
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const day = shiftIso(date, -offset)
    if (index.firstDate && day < index.firstDate) return null
    const value = metricValue(index, metric, day, units)
    if (value !== null) return { date: day, value }
  }
  return null
}

export function weekStart(date: string): string {
  return shiftIso(date, -((parseIso(date).getDay() + 6) % 7))
}

/** Zone minutes from Monday through `date`, the way Google counts the weekly goal. */
export function weekZoneMinutes(index: HealthIndex, date: string): number {
  let total = 0
  for (let day = weekStart(date); day <= date; day = shiftIso(day, 1)) {
    total += metricValue(index, 'zone', day, 'metric') ?? 0
  }
  return total
}

export type HealthRange = 'week' | 'month' | 'year'

export interface HealthPeriod {
  range: HealthRange
  /** Inclusive. */
  start: string
  end: string
  label: string
}

const shortDate = (iso: string): string => parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const monthLabel = (iso: string, month: 'short' | 'long' = 'short'): string =>
  parseIso(iso).toLocaleDateString('en-US', { month, year: 'numeric' })

function monthStart(iso: string, delta = 0): string {
  const date = parseIso(iso)
  const moved = new Date(date.getFullYear(), date.getMonth() + delta, 1)
  return isoFromParts(moved.getFullYear(), moved.getMonth(), 1)
}

export function periodFor(range: HealthRange, anchor: string): HealthPeriod {
  if (range === 'week') {
    const start = weekStart(anchor)
    const end = shiftIso(start, 6)
    const sameMonth = start.slice(0, 7) === end.slice(0, 7)
    return { range, start, end, label: `${shortDate(start)} to ${sameMonth ? Number(end.slice(8)) : shortDate(end)}` }
  }
  if (range === 'month') {
    const start = monthStart(anchor)
    return { range, start, end: shiftIso(monthStart(anchor, 1), -1), label: monthLabel(start, 'long') }
  }
  const start = monthStart(anchor, -11)
  return { range, start, end: shiftIso(monthStart(anchor, 1), -1), label: `${monthLabel(start)} to ${monthLabel(anchor)}` }
}

export function shiftPeriod(period: HealthPeriod, steps: number): HealthPeriod {
  if (period.range === 'week') return periodFor('week', shiftIso(period.start, steps * 7))
  if (period.range === 'month') return periodFor('month', monthStart(period.start, steps))
  return periodFor('year', monthStart(period.end, steps * 12))
}

export interface ChartPoint {
  key: string
  /** The axis label, kept short. */
  label: string
  /** The full label for the list under the chart and the selected readout. */
  title: string
  value: number | null
  /** The day this point stands for. Year points stand for a month and have none. */
  date: string | null
}

export function metricSeries(
  index: HealthIndex, metric: HealthMetric, period: HealthPeriod, units: HealthUnits, today: string
): ChartPoint[] {
  if (period.range !== 'year') {
    const points: ChartPoint[] = []
    for (let date = period.start; date <= period.end; date = shiftIso(date, 1)) {
      const day = parseIso(date)
      points.push({
        key: date,
        label: period.range === 'week'
          ? day.toLocaleDateString('en-US', { weekday: 'narrow' })
          : day.getDate() === 1 || day.getDate() % 7 === 1 ? String(day.getDate()) : '',
        title: day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        value: date > today ? null : metricValue(index, metric, date, units),
        date
      })
    }
    return points
  }
  const points: ChartPoint[] = []
  for (let offset = 0; offset < 12; offset += 1) {
    const start = monthStart(period.start, offset)
    const end = shiftIso(monthStart(start, 1), -1)
    const values: number[] = []
    for (let date = start; date <= end && date <= today; date = shiftIso(date, 1)) {
      const value = metricValue(index, metric, date, units)
      if (value !== null) values.push(value)
    }
    points.push({
      key: start,
      label: parseIso(start).toLocaleDateString('en-US', { month: 'narrow' }),
      title: monthLabel(start, 'long'),
      value: values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length,
      date: null
    })
  }
  return points
}

export interface SeriesStats {
  average: number | null
  total: number | null
  low: ChartPoint | null
  high: ChartPoint | null
  count: number
}

export function seriesStats(points: readonly ChartPoint[]): SeriesStats {
  const present = points.filter((point): point is ChartPoint & { value: number } => point.value !== null)
  if (present.length === 0) return { average: null, total: null, low: null, high: null, count: 0 }
  const total = present.reduce((sum, point) => sum + point.value, 0)
  return {
    average: total / present.length,
    total,
    low: present.reduce((low, point) => point.value < low.value ? point : low),
    high: present.reduce((high, point) => point.value > high.value ? point : high),
    count: present.length
  }
}

/** Clean ticks that bracket the values, three or four of them. A `unit` other than 1 steps in whole units. */
export function ticksFor(values: readonly number[], fromZero: boolean, target?: number, unit = 1): number[] {
  if (unit === 1) return niceTicks(values, fromZero, target, false)
  return niceTicks(values.map((value) => value / unit), fromZero, target === undefined ? undefined : target / unit, true)
    .map((tick) => tick * unit)
}

function niceTicks(values: readonly number[], fromZero: boolean, target: number | undefined, wholeSteps: boolean): number[] {
  const all = target === undefined ? [...values] : [...values, target]
  if (all.length === 0) return [0, 1]
  let low = fromZero ? 0 : Math.min(...all)
  let high = Math.max(...all)
  if (low === high) {
    const pad = Math.max(1, Math.abs(high) * 0.1)
    low = fromZero ? 0 : low - pad
    high += pad
  }
  const raw = (high - low) / 3
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / magnitude
  const nice = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * magnitude
  const step = wholeSteps ? Math.max(1, Math.ceil(nice)) : nice
  const first = Math.floor(low / step) * step
  const ticks: number[] = []
  for (let tick = first; tick < high + step; tick += step) {
    ticks.push(Math.round(tick * 1000) / 1000)
    if (tick >= high) break
  }
  return ticks
}
