/** Google Health data as the phone shows it. Distances and weights are stored in metres and kilograms. */
export type HealthUnits = 'imperial' | 'metric'

const METERS_PER_MILE = 1609.344
const POUNDS_PER_KG = 2.2046226218

export function distanceIn(meters: number, units: HealthUnits): number {
  return units === 'imperial' ? meters / METERS_PER_MILE : meters / 1000
}

export function distanceUnit(units: HealthUnits): string {
  return units === 'imperial' ? 'mi' : 'km'
}

export function formatHealthDistance(meters: number, units: HealthUnits): string {
  return `${distanceIn(meters, units).toFixed(2)} ${distanceUnit(units)}`
}

export function bodyWeightIn(kg: number, units: HealthUnits): number {
  return units === 'imperial' ? kg * POUNDS_PER_KG : kg
}

export function bodyWeightUnit(units: HealthUnits): string {
  return units === 'imperial' ? 'lb' : 'kg'
}

export function formatBodyWeight(kg: number, units: HealthUnits): string {
  return `${bodyWeightIn(kg, units).toFixed(1)} ${bodyWeightUnit(units)}`
}

/** 452 becomes 7h 32m, and 45 stays 45m. */
export function formatSleepMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes))
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return hours === 0 ? `${rest}m` : `${hours}h ${String(rest).padStart(2, '0')}m`
}

/** Google's weekly Active Zone Minutes goal, which follows the WHO's 150 minutes of moderate activity. */
export const WEEKLY_ZONE_MINUTES_TARGET = 150
export const DAILY_STEP_TARGET = 10000
/** The night Ego's readiness compares sleep against. */
export const SLEEP_TARGET_MINUTES = 450

export interface ZoneMinutesLike {
  fatBurnMinutes: number | null
  cardioMinutes: number | null
  peakMinutes: number | null
}

export function zoneMinutesOf(day: ZoneMinutesLike): number | null {
  if (day.fatBurnMinutes === null && day.cardioMinutes === null && day.peakMinutes === null) return null
  return (day.fatBurnMinutes ?? 0) + (day.cardioMinutes ?? 0) + (day.peakMinutes ?? 0)
}

export interface ReadinessDay {
  date: string
  restingHeartRate: number | null
  hrvMs: number | null
}

export interface ReadinessNight {
  date: string
  minutesAsleep: number
  nap: boolean
}

export type ReadinessLevel = 'low' | 'moderate' | 'high'
export type ReadinessPartKey = 'hrv' | 'restingHeartRate' | 'sleep'

/** One input to the score: its value, what it is measured against, and how far above or below that it is. */
export interface ReadinessPart {
  key: ReadinessPartKey
  value: number
  baseline: number
  /** Standard deviations in the good direction, clamped to a band. */
  effect: number
}

export interface Readiness {
  score: number
  level: ReadinessLevel
  parts: ReadinessPart[]
}

const BASELINE_DAYS = 30
const MINIMUM_BASELINE = 7
const WEIGHTS: Record<ReadinessPartKey, number> = { hrv: 0.45, restingHeartRate: 0.35, sleep: 0.2 }

function shiftDay(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function spread(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length
  return { mean, sd: Math.sqrt(variance) }
}

/** Minutes asleep in the main sleep that ended on `date`. Naps do not count, as in Google Health. */
export function mainSleepMinutes(nights: readonly ReadinessNight[], date: string): number | null {
  const matching = nights.filter((night) => night.date === date && !night.nap)
  return matching.length === 0 ? null : matching.reduce((total, night) => total + night.minutesAsleep, 0)
}

export function readinessLevel(score: number): ReadinessLevel {
  return score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low'
}

/**
 * Ego's own readiness estimate, 1 to 100. Google does not publish its readiness score, so this
 * follows the same inputs it names: last night's HRV and resting heart rate against the 30 days
 * before, and last night's sleep against 7.5 hours. A typical day lands near 60. Returns null until
 * a week of HRV or resting heart rate exists to compare against.
 */
export function readinessFor(
  date: string, days: readonly ReadinessDay[], nights: readonly ReadinessNight[]
): Readiness | null {
  const today = days.find((day) => day.date === date)
  const earliest = shiftDay(date, -BASELINE_DAYS)
  const window = days.filter((day) => day.date >= earliest && day.date < date)
  const parts: ReadinessPart[] = []

  const hrvHistory = window.map((day) => day.hrvMs).filter((value): value is number => value !== null)
  if (today?.hrvMs != null && hrvHistory.length >= MINIMUM_BASELINE) {
    const { mean, sd } = spread(hrvHistory)
    const effect = clamp((today.hrvMs - mean) / Math.max(sd, mean * 0.08, 2), -2.5, 2.5)
    parts.push({ key: 'hrv', value: today.hrvMs, baseline: mean, effect })
  }
  const restingHistory = window.map((day) => day.restingHeartRate).filter((value): value is number => value !== null)
  if (today?.restingHeartRate != null && restingHistory.length >= MINIMUM_BASELINE) {
    const { mean, sd } = spread(restingHistory)
    const effect = clamp((mean - today.restingHeartRate) / Math.max(sd, 1.5), -2.5, 2.5)
    parts.push({ key: 'restingHeartRate', value: today.restingHeartRate, baseline: mean, effect })
  }
  if (parts.length === 0) return null

  const slept = mainSleepMinutes(nights, date)
  if (slept !== null) {
    parts.push({ key: 'sleep', value: slept, baseline: SLEEP_TARGET_MINUTES, effect: clamp((slept - SLEEP_TARGET_MINUTES) / 60, -2.5, 1.5) })
  }
  const weight = parts.reduce((total, part) => total + WEIGHTS[part.key], 0)
  const combined = parts.reduce((total, part) => total + WEIGHTS[part.key] * part.effect, 0) / weight
  const score = Math.round(clamp(60 + 18 * combined, 1, 100))
  return { score, level: readinessLevel(score), parts }
}
