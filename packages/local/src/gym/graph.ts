import {
  formatSetDuration, formatWeight, type DistanceUnit, type GraphMetric, type WeightUnit
} from '@ego/core'
import { parseIso } from '../dates'

function niceStep(span: number): number {
  const raw = span / 3
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / magnitude
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return step * magnitude
}

/** Clean ticks that bracket the data, so the line never touches the frame. */
export function ticksFor(values: number[]): number[] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low === high) {
    const pad = Math.max(1, Math.abs(high) * 0.1)
    return ticksFor([Math.max(0, low - pad), high + pad])
  }
  const step = niceStep(high - low)
  const first = Math.floor(low / step) * step
  const last = Math.ceil(high / step) * step
  const ticks: number[] = []
  for (let tick = first; tick <= last + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000)
  return ticks
}

function isTime(metric: GraphMetric): boolean {
  return metric === 'max_time' || metric === 'workout_time'
}

export function formatMetric(metric: GraphMetric, value: number, weightUnit: WeightUnit, distanceUnit: DistanceUnit): string {
  if (isTime(metric)) return formatSetDuration(value)
  if (metric === 'max_distance' || metric === 'workout_distance') return `${Math.round(value * 100) / 100} ${distanceUnit}`
  if (metric === 'max_reps' || metric === 'workout_reps') return `${Math.round(value)} reps`
  if (metric === 'workout_volume') return `${Math.round(value).toLocaleString('en-US')} ${weightUnit}`
  return `${formatWeight(value)} ${weightUnit}`
}

export function tickLabel(metric: GraphMetric, value: number): string {
  if (isTime(metric)) return formatSetDuration(value)
  if (value >= 10000) return `${Math.round(value / 1000)}k`
  return Number.isInteger(value) ? value.toLocaleString('en-US') : String(value)
}

export function dayNumber(iso: string): number {
  return Math.round(parseIso(iso).getTime() / 86400000)
}
