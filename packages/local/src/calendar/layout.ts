import type { CalendarEvent } from '@ego/api-contracts'
import { isoFromParts, parseIso, shiftIso } from '../dates'

export type CalendarView = 'day' | '3day' | 'week' | 'month' | 'schedule'

export const CALENDAR_VIEWS: ReadonlyArray<{ view: CalendarView; label: string; short: string }> = [
  { view: 'day', label: 'Day', short: 'D' },
  { view: '3day', label: '3 days', short: '3' },
  { view: 'week', label: 'Week', short: 'W' },
  { view: 'month', label: 'Month', short: 'M' },
  { view: 'schedule', label: 'Schedule', short: 'S' }
]

export const DAY_MINUTES = 1440
export const SNAP_MINUTES = 15
/** Short events still draw tall enough to read, and Google lays them out as if they were. */
export const MIN_BLOCK_MINUTES = 20
export const SCHEDULE_DAYS = 30

const DAY_MS = 86_400_000

export function isCalendarView(value: unknown): value is CalendarView {
  return value === 'day' || value === '3day' || value === 'week' || value === 'month' || value === 'schedule'
}

/** Monday of the week holding `date`, as everywhere else in Ego. */
export function weekStartOf(date: string): string {
  return shiftIso(date, -((parseIso(date).getDay() + 6) % 7))
}

export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`
}

function shiftMonths(date: string, months: number): string {
  const parsed = parseIso(monthStartOf(date))
  parsed.setMonth(parsed.getMonth() + months)
  return isoFromParts(parsed.getFullYear(), parsed.getMonth(), 1)
}

/** The weeks a month view shows: every Monday-to-Sunday row touching the month. */
export function monthWeeks(date: string): string[][] {
  const first = monthStartOf(date)
  const next = shiftMonths(first, 1)
  const weeks: string[][] = []
  for (let start = weekStartOf(first); start < next; start = shiftIso(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftIso(start, index)))
  }
  return weeks
}

export function visibleDays(view: CalendarView, anchor: string): string[] {
  switch (view) {
    case 'day': return [anchor]
    case '3day': return [anchor, shiftIso(anchor, 1), shiftIso(anchor, 2)]
    case 'week': {
      const start = weekStartOf(anchor)
      return Array.from({ length: 7 }, (_, index) => shiftIso(start, index))
    }
    case 'month': return monthWeeks(anchor).flat()
    case 'schedule': return Array.from({ length: SCHEDULE_DAYS }, (_, index) => shiftIso(anchor, index))
  }
}

/** The day the previous or next page of the view opens on. */
export function stepAnchor(view: CalendarView, anchor: string, direction: 1 | -1): string {
  switch (view) {
    case 'day': return shiftIso(anchor, direction)
    case '3day': return shiftIso(anchor, direction * 3)
    case 'week': return shiftIso(weekStartOf(anchor), direction * 7)
    case 'month': return shiftMonths(anchor, direction)
    case 'schedule': return shiftIso(anchor, direction * SCHEDULE_DAYS)
  }
}

function monthName(date: string, style: 'long' | 'short'): string {
  return parseIso(date).toLocaleDateString('en-US', { month: style })
}

/** "October 2026", or "Sep – Oct 2026" when a page crosses months. */
export function rangeLabel(view: CalendarView, anchor: string): string {
  if (view === 'month') return parseIso(anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const days = visibleDays(view, anchor)
  const first = days[0]
  const last = days[days.length - 1]
  if (view === 'day') return parseIso(first).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  if (first.slice(0, 7) === last.slice(0, 7)) return `${monthName(first, 'long')} ${first.slice(0, 4)}`
  if (first.slice(0, 4) === last.slice(0, 4)) return `${monthName(first, 'short')} – ${monthName(last, 'short')} ${last.slice(0, 4)}`
  return `${monthName(first, 'short')} ${first.slice(0, 4)} – ${monthName(last, 'short')} ${last.slice(0, 4)}`
}

// Time on the device's own clock ------------------------------------------------------------------

export function localDayOf(iso: string): string {
  const date = new Date(iso)
  return isoFromParts(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Minutes from the start of `day` to `iso`: negative before it, past 1440 after it. */
export function minutesInto(iso: string, day: string): number {
  return Math.round((Date.parse(iso) - parseIso(day).getTime()) / 60_000)
}

/** The instant `minutes` into `day`, following the day's own clock changes. */
export function instantAt(day: string, minutes: number): string {
  const date = parseIso(day)
  date.setMinutes(minutes)
  return date.toISOString()
}

export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step
}

/** The first and last day an event covers, inclusive. */
export function eventDays(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>): { first: string; last: string } {
  if (event.allDay) return { first: event.start, last: event.end > event.start ? shiftIso(event.end, -1) : event.start }
  const first = localDayOf(event.start)
  const last = localDayOf(new Date(Math.max(Date.parse(event.start), Date.parse(event.end) - 1)).toISOString())
  return { first, last }
}

/** All-day events and anything a day long or longer go in the bar above the hours, as in Google. */
export function inAllDayRow(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>): boolean {
  return event.allDay || Date.parse(event.end) - Date.parse(event.start) >= DAY_MS
}

export function coversDay(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>, day: string): boolean {
  const { first, last } = eventDays(event)
  return first <= day && last >= day
}

// Hour grid ---------------------------------------------------------------------------------------

export interface TimedPlacement {
  event: CalendarEvent
  /** Minutes from midnight, clipped to the day. */
  top: number
  bottom: number
  column: number
  columns: number
  /** How many columns the block may widen into, because nothing beside it overlaps. */
  span: number
  startsBefore: boolean
  endsAfter: boolean
}

/**
 * Lays one day's timed events out like Google: events that overlap share the width in columns, and
 * a block widens to the right while the columns beside it are free.
 */
export function layoutDay(events: readonly CalendarEvent[], day: string): TimedPlacement[] {
  const items = events
    .filter((event) => !inAllDayRow(event) && coversDay(event, day))
    .map((event) => {
      const start = minutesInto(event.start, day)
      const end = minutesInto(event.end, day)
      const top = Math.max(0, start)
      return {
        event,
        top,
        bottom: Math.min(DAY_MINUTES, Math.max(end, top + 1)),
        startsBefore: start < 0,
        endsAfter: end > DAY_MINUTES
      }
    })
    .sort((left, right) => left.top - right.top || right.bottom - left.bottom || left.event.key.localeCompare(right.event.key))

  const placements: TimedPlacement[] = []
  let cluster: Array<(typeof items)[number] & { column: number }> = []
  let clusterEnd = -1
  const visualEnd = (item: { top: number; bottom: number }): number => Math.max(item.bottom, item.top + MIN_BLOCK_MINUTES)

  const flush = (): void => {
    const columns = cluster.reduce((count, item) => Math.max(count, item.column + 1), 0)
    for (const item of cluster) {
      let span = 1
      for (let next = item.column + 1; next < columns; next += 1) {
        const blocked = cluster.some((other) => other.column === next && other.top < visualEnd(item) && visualEnd(other) > item.top)
        if (blocked) break
        span += 1
      }
      placements.push({ ...item, columns, span })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const item of items) {
    if (cluster.length > 0 && item.top >= clusterEnd) flush()
    const ends: number[] = []
    for (const placed of cluster) ends[placed.column] = Math.max(ends[placed.column] ?? -1, visualEnd(placed))
    let column = ends.findIndex((end) => end <= item.top)
    if (column < 0) column = ends.length
    cluster.push({ ...item, column })
    clusterEnd = Math.max(clusterEnd, visualEnd(item))
  }
  if (cluster.length > 0) flush()
  return placements
}

// Bars --------------------------------------------------------------------------------------------

export interface SpanPlacement {
  event: CalendarEvent
  /** Indexes into the row's days, inclusive. */
  startIndex: number
  endIndex: number
  lane: number
  continuesBefore: boolean
  continuesAfter: boolean
}

function spanOrder(left: CalendarEvent, right: CalendarEvent): number {
  const leftRow = inAllDayRow(left)
  const rightRow = inAllDayRow(right)
  if (leftRow !== rightRow) return leftRow ? -1 : 1
  return left.start.localeCompare(right.start) || right.end.localeCompare(left.end) || left.key.localeCompare(right.key)
}

/**
 * Stacks events into lanes across a row of days. The all-day bar uses it for the hour views; the
 * month view passes `includeTimed` so every event gets a line, all-day ones first.
 */
export function layoutSpans(
  events: readonly CalendarEvent[], days: readonly string[], options: { includeTimed?: boolean } = {}
): { items: SpanPlacement[]; lanes: number } {
  if (days.length === 0) return { items: [], lanes: 0 }
  const first = days[0]
  const last = days[days.length - 1]
  const laneEnds: number[] = []
  const items: SpanPlacement[] = []
  const candidates = events
    .filter((event) => options.includeTimed || inAllDayRow(event))
    .filter((event) => {
      const span = eventDays(event)
      return span.first <= last && span.last >= first
    })
    .sort((left, right) => {
      const leftDays = eventDays(left)
      const rightDays = eventDays(right)
      return leftDays.first.localeCompare(rightDays.first) || rightDays.last.localeCompare(leftDays.last) || spanOrder(left, right)
    })
  for (const event of candidates) {
    const span = eventDays(event)
    const startIndex = Math.max(0, days.indexOf(span.first < first ? first : span.first))
    const endIndex = span.last > last ? days.length - 1 : Math.max(startIndex, days.indexOf(span.last))
    let lane = laneEnds.findIndex((end) => end < startIndex)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = endIndex
    items.push({ event, startIndex, endIndex, lane, continuesBefore: span.first < first, continuesAfter: span.last > last })
  }
  return { items, lanes: laneEnds.length }
}

/** Each day that has events, with every event that covers it, in the order Google lists them. */
export function scheduleDays(events: readonly CalendarEvent[], days: readonly string[]): Array<{ day: string; events: CalendarEvent[] }> {
  return days.flatMap((day) => {
    const covering = events.filter((event) => coversDay(event, day)).sort(spanOrder)
    return covering.length > 0 ? [{ day, events: covering }] : []
  })
}

// Moving ------------------------------------------------------------------------------------------

export interface EventTimes {
  allDay: boolean
  start: string
  end: string
}

/** Moves an event by whole days and minutes, keeping its length and its clock time across a time change. */
export function shiftEvent(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>, days: number, minutes: number): EventTimes {
  if (event.allDay) return { allDay: true, start: shiftIso(event.start, days), end: shiftIso(event.end, days) }
  const length = Date.parse(event.end) - Date.parse(event.start)
  const startDay = localDayOf(event.start)
  const start = instantAt(shiftIso(startDay, days), minutesInto(event.start, startDay) + minutes)
  return { allDay: false, start, end: new Date(Date.parse(start) + length).toISOString() }
}

/** Puts a timed event at `minutes` into `day`, keeping its length. */
export function moveEventTo(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>, day: string, minutes: number): EventTimes {
  const length = event.allDay ? 60 * 60_000 : Date.parse(event.end) - Date.parse(event.start)
  const start = instantAt(day, minutes)
  return { allDay: false, start, end: new Date(Date.parse(start) + length).toISOString() }
}

/** Puts an event in the all-day row on `day`, keeping how many days it covers. */
export function moveEventToDay(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>, day: string): EventTimes {
  const { first, last } = eventDays(event)
  const length = event.allDay ? Math.max(1, Math.round((parseIso(last).getTime() - parseIso(first).getTime()) / DAY_MS) + 1) : 1
  return { allDay: true, start: day, end: shiftIso(day, length) }
}

/** Drags the end of a timed event; it never gets shorter than one snap. */
export function resizeEvent(event: Pick<CalendarEvent, 'start' | 'end'>, endMinutes: number, day: string): EventTimes {
  const end = instantAt(day, endMinutes)
  const earliest = Date.parse(event.start) + SNAP_MINUTES * 60_000
  return { allDay: false, start: event.start, end: new Date(Math.max(Date.parse(end), earliest)).toISOString() }
}

// Words -------------------------------------------------------------------------------------------

/** "9 AM" or "9:30 AM". Without the period, "9" or "9:30". */
export function clockLabel(iso: string, withPeriod = true): string {
  const date = new Date(iso)
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const hour = hours % 12 === 0 ? 12 : hours % 12
  const clock = minutes === 0 ? `${hour}` : `${hour}:${String(minutes).padStart(2, '0')}`
  return withPeriod ? `${clock} ${hours < 12 ? 'AM' : 'PM'}` : clock
}

export function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`
}

/** "9 – 10:30 AM", or "11 AM – 1 PM" when the halves differ. */
export function timeRangeLabel(event: Pick<CalendarEvent, 'start' | 'end'>): string {
  const sameHalf = (new Date(event.start).getHours() < 12) === (new Date(event.end).getHours() < 12)
  return `${clockLabel(event.start, !sameHalf)} – ${clockLabel(event.end)}`
}

function dayLabel(date: string, withYear: boolean): string {
  return parseIso(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

/** "Monday, October 5 · 9 – 10:30 AM", or the days an all-day or overnight event covers. */
export function whenLabel(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>, today: string): string {
  const { first, last } = eventDays(event)
  const withYear = first.slice(0, 4) !== today.slice(0, 4)
  if (event.allDay) {
    if (first === last) return dayLabel(first, withYear)
    const short = (date: string): string => parseIso(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
    return `${short(first)} – ${short(last)}`
  }
  if (first === last) return `${dayLabel(first, withYear)} · ${timeRangeLabel(event)}`
  const short = (iso: string): string =>
    `${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clockLabel(iso)}`
  return `${short(event.start)} – ${short(event.end)}`
}

export function weekdayShort(date: string): string {
  return parseIso(date).toLocaleDateString('en-US', { weekday: 'short' })
}

/** "09:30", for a time field. */
export function clockValue(iso: string): string {
  const date = new Date(iso)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The instant at "HH:MM" on `day`. */
export function atClock(day: string, clock: string): string {
  const [hours, minutes] = clock.split(':').map(Number)
  return instantAt(day, (hours || 0) * 60 + (minutes || 0))
}
