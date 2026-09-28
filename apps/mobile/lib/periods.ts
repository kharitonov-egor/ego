import type { DateRange, PeriodPreset } from '@ego/core'
import { WEEKDAYS, formatIso, isoFromParts, isoToday, parseIso, shiftIso } from './dates'

export const PERIOD_PRESETS: PeriodPreset[] = ['today', 'week', 'month', 'year', 'all', 'custom']

/** The presets that name one calendar day, week, month, or year, and so can step back and forth. */
export type SteppedPeriod = 'today' | 'week' | 'month' | 'year'

export interface Span {
  from: string
  to: string
}

export function isStepped(period: PeriodPreset): period is SteppedPeriod {
  return period === 'today' || period === 'week' || period === 'month' || period === 'year'
}

function isoOf(date: Date): string {
  return isoFromParts(date.getFullYear(), date.getMonth(), date.getDate())
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86400000)
}

/** Weeks start on Monday. */
export function periodSpan(period: SteppedPeriod, anchor: string): Span {
  const date = parseIso(anchor)
  const year = date.getFullYear()
  const month = date.getMonth()
  if (period === 'today') return { from: anchor, to: anchor }
  if (period === 'week') {
    const from = shiftIso(anchor, -((date.getDay() + 6) % 7))
    return { from, to: shiftIso(from, 6) }
  }
  if (period === 'month') return { from: isoFromParts(year, month, 1), to: isoOf(new Date(year, month + 1, 0)) }
  return { from: isoFromParts(year, 0, 1), to: isoFromParts(year, 11, 31) }
}

export function rangeForPeriod(period: PeriodPreset, custom: DateRange, anchor: string = isoToday()): DateRange {
  if (period === 'all') return { from: null, to: null }
  if (period === 'custom') return custom
  return periodSpan(period, anchor)
}

function shiftMonths(anchor: string, months: number): string {
  const date = parseIso(anchor)
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return isoFromParts(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay))
}

/**
 * Moves one period back or forward and keeps the day of the month where it exists, so stepping
 * from September 27 lands on August 27 and switching to Day shows the same date. A step that
 * reaches the current period snaps to today.
 */
export function stepAnchor(period: SteppedPeriod, anchor: string, delta: number, today: string = isoToday()): string {
  const next = shiftPeriod(period, anchor, delta)
  return containsDay(periodSpan(period, next), today) ? today : next
}

function shiftPeriod(period: SteppedPeriod, day: string, delta: number): string {
  if (period === 'today') return shiftIso(day, delta)
  if (period === 'week') return shiftIso(day, delta * 7)
  return shiftMonths(day, period === 'month' ? delta : delta * 12)
}

export function containsDay(span: Span, day: string): boolean {
  return span.from <= day && day <= span.to
}

export function isCurrentPeriod(period: SteppedPeriod, anchor: string, today: string = isoToday()): boolean {
  return containsDay(periodSpan(period, anchor), today)
}

export function canStepForward(period: SteppedPeriod, anchor: string, today: string = isoToday()): boolean {
  return periodSpan(period, anchor).to < today
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const SHORT_DAY_FORMAT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const SHORT_MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short' })
const LONG_MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long' })

/**
 * "Sep 21 – 27, 2026", "Aug 31 – Sep 6, 2026", or "Dec 28, 2026 – Jan 3, 2027". `thisYear` drops the
 * year when both ends fall in it.
 */
export function formatSpan(from: string, to: string, thisYear?: number): string {
  const start = parseIso(from)
  const end = parseIso(to)
  const sameYear = start.getFullYear() === end.getFullYear()
  const year = sameYear && end.getFullYear() === thisYear ? '' : `, ${end.getFullYear()}`
  if (!sameYear) return `${formatIso(from)} – ${formatIso(to)}`
  if (from === to) return `${MONTH_DAY_FORMAT.format(start)}${year}`
  if (start.getMonth() !== end.getMonth()) return `${MONTH_DAY_FORMAT.format(start)} – ${MONTH_DAY_FORMAT.format(end)}${year}`
  return `${MONTH_DAY_FORMAT.format(start)} – ${end.getDate()}${year}`
}

export function periodTitle(period: PeriodPreset, anchor: string, custom: DateRange): string {
  if (period === 'all') return 'All time'
  if (period === 'custom') {
    if (custom.from && custom.to) return formatSpan(custom.from, custom.to)
    if (custom.from) return `From ${formatIso(custom.from)}`
    if (custom.to) return `Until ${formatIso(custom.to)}`
    return 'Custom range'
  }
  const date = parseIso(anchor)
  if (period === 'today') return DAY_FORMAT.format(date)
  if (period === 'month') return MONTH_FORMAT.format(date)
  if (period === 'year') return String(date.getFullYear())
  const span = periodSpan('week', anchor)
  return formatSpan(span.from, span.to)
}

const UNIT: Record<Exclude<SteppedPeriod, 'today'>, string> = { week: 'week', month: 'month', year: 'year' }

/** "This month", "Last week", "Yesterday", or null once the period is further back than that. */
export function relativePeriodName(period: SteppedPeriod, anchor: string, today: string = isoToday()): string | null {
  if (period === 'today') {
    if (anchor === today) return 'Today'
    return anchor === shiftIso(today, -1) ? 'Yesterday' : null
  }
  if (isCurrentPeriod(period, anchor, today)) return `This ${UNIT[period]}`
  return isCurrentPeriod(period, stepAnchor(period, anchor, 1, today), today) ? `Last ${UNIT[period]}` : null
}

export function currentPeriodName(period: SteppedPeriod): string {
  return period === 'today' ? 'today' : `this ${UNIT[period]}`
}

export interface Comparison extends Span {
  /** Short enough for a stat card: "Aug 1 – 27", "July", "2025", "Sat, Sep 26". */
  label: string
}

function shortTitle(period: SteppedPeriod, anchor: string, thisYear: number): string {
  const date = parseIso(anchor)
  const year = date.getFullYear() === thisYear ? '' : ` ${date.getFullYear()}`
  if (period === 'today') return `${SHORT_DAY_FORMAT.format(date)}${year ? `,${year}` : ''}`
  if (period === 'month') return `${LONG_MONTH_FORMAT.format(date)}${year}`
  if (period === 'year') return String(date.getFullYear())
  const span = periodSpan('week', anchor)
  return formatSpan(span.from, span.to, thisYear)
}

/**
 * The period to measure against. While the current period is still running it is compared with
 * the same stretch of the previous one, so September 1-27 meets August 1-27 rather than a whole
 * August.
 */
export function comparisonSpan(period: SteppedPeriod, anchor: string, today: string = isoToday()): Comparison {
  const thisYear = parseIso(today).getFullYear()
  const previousAnchor = stepAnchor(period, anchor, -1, today)
  const previous = periodSpan(period, previousAnchor)
  if (period === 'today' || !isCurrentPeriod(period, anchor, today)) {
    return { ...previous, label: shortTitle(period, previousAnchor, thisYear) }
  }
  const sameDay = shiftPeriod(period, today, -1)
  const to = sameDay < previous.to ? sameDay : previous.to
  return { from: previous.from, to, label: formatSpan(previous.from, to, thisYear) }
}

export type BucketSize = 'day' | 'month' | 'year'

export interface ChartBucket extends Span {
  key: string
  /** Axis text, or an empty string where a label would crowd its neighbours. */
  tick: string
  title: string
  drill: { period: SteppedPeriod; anchor: string }
}

export function bucketSizeFor(span: Span): BucketSize {
  const days = daysBetween(span.from, span.to) + 1
  if (days <= 62) return 'day'
  const start = parseIso(span.from)
  const end = parseIso(span.to)
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
  return months <= 36 ? 'month' : 'year'
}

/** The key a transaction date falls under for a bucket size: 2026-09-14, 2026-09, or 2026. */
export function bucketKey(size: BucketSize, date: string): string {
  return size === 'day' ? date : size === 'month' ? date.slice(0, 7) : date.slice(0, 4)
}

export function chartBuckets(span: Span): ChartBucket[] {
  const size = bucketSizeFor(span)
  const buckets: ChartBucket[] = []
  if (size === 'day') {
    const count = daysBetween(span.from, span.to) + 1
    const every = count <= 7 ? 1 : count <= 31 ? 7 : 14
    for (let index = 0; index < count; index += 1) {
      const day = shiftIso(span.from, index)
      const date = parseIso(day)
      const tick = count <= 7 ? WEEKDAYS[date.getDay()]
        : index % every === 0 ? (index === 0 || date.getDate() === 1 ? MONTH_DAY_FORMAT.format(date) : String(date.getDate())) : ''
      buckets.push({ key: day, from: day, to: day, tick, title: SHORT_DAY_FORMAT.format(date), drill: { period: 'today', anchor: day } })
    }
    return buckets
  }
  if (size === 'month') {
    const start = parseIso(span.from)
    const end = parseIso(span.to)
    const count = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
    for (let index = 0; index < count; index += 1) {
      const first = new Date(start.getFullYear(), start.getMonth() + index, 1)
      const from = isoOf(first)
      const tick = count <= 12 ? SHORT_MONTH_FORMAT.format(first).charAt(0)
        : first.getMonth() === 0 ? String(first.getFullYear()) : ''
      buckets.push({
        key: from.slice(0, 7), from, to: isoOf(new Date(first.getFullYear(), first.getMonth() + 1, 0)),
        tick, title: MONTH_FORMAT.format(first), drill: { period: 'month', anchor: from }
      })
    }
    return buckets
  }
  const first = parseIso(span.from).getFullYear()
  const last = parseIso(span.to).getFullYear()
  const every = Math.ceil((last - first + 1) / 6)
  for (let year = first; year <= last; year += 1) {
    buckets.push({
      key: String(year), from: isoFromParts(year, 0, 1), to: isoFromParts(year, 11, 31),
      tick: (year - first) % every === 0 ? String(year) : '', title: String(year),
      drill: { period: 'year', anchor: isoFromParts(year, 0, 1) }
    })
  }
  return buckets
}

const SWIPE_DISTANCE = 56
const FLICK_VELOCITY = 0.45

/**
 * The reverse of a paging carousel, by request: a swipe to the left goes back in time and a swipe
 * to the right goes forward. A short fast flick counts as well as a long slow drag.
 */
export function swipeStep(dx: number, vx: number): -1 | 0 | 1 {
  if (dx <= -SWIPE_DISTANCE || (dx < -24 && vx <= -FLICK_VELOCITY)) return -1
  if (dx >= SWIPE_DISTANCE || (dx > 24 && vx >= FLICK_VELOCITY)) return 1
  return 0
}

/** Clearly sideways, so a slightly slanted vertical scroll never changes the period. */
export function isHorizontalSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 2
}
