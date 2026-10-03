export interface NamedColor {
  name: string
  /** Google Calendar's current palette, which is what calendar.google.com draws. */
  hex: string
  /** What the API still returns for the same id. */
  classic: string
}

/** Google's 11 event colors by id. */
export const EVENT_COLORS: Readonly<Record<string, NamedColor>> = {
  1: { name: 'Lavender', hex: '#7986cb', classic: '#a4bdfc' },
  2: { name: 'Sage', hex: '#33b679', classic: '#7ae7bf' },
  3: { name: 'Grape', hex: '#8e24aa', classic: '#dbadff' },
  4: { name: 'Flamingo', hex: '#e67c73', classic: '#ff887c' },
  5: { name: 'Banana', hex: '#f6bf26', classic: '#fbd75b' },
  6: { name: 'Tangerine', hex: '#f4511e', classic: '#ffb878' },
  7: { name: 'Peacock', hex: '#039be5', classic: '#46d6db' },
  8: { name: 'Graphite', hex: '#616161', classic: '#e1e1e1' },
  9: { name: 'Blueberry', hex: '#3f51b5', classic: '#5484ed' },
  10: { name: 'Basil', hex: '#0b8043', classic: '#51b749' },
  11: { name: 'Tomato', hex: '#d50000', classic: '#dc2127' }
}

/** Google's 24 calendar colors by id. */
export const CALENDAR_COLORS: Readonly<Record<string, NamedColor>> = {
  1: { name: 'Cocoa', hex: '#795548', classic: '#ac725e' },
  2: { name: 'Flamingo', hex: '#e67c73', classic: '#d06b64' },
  3: { name: 'Tomato', hex: '#d50000', classic: '#f83a22' },
  4: { name: 'Tangerine', hex: '#f4511e', classic: '#fa573c' },
  5: { name: 'Pumpkin', hex: '#ef6c00', classic: '#ff7537' },
  6: { name: 'Mango', hex: '#f09300', classic: '#ffad46' },
  7: { name: 'Eucalyptus', hex: '#009688', classic: '#42d692' },
  8: { name: 'Basil', hex: '#0b8043', classic: '#16a765' },
  9: { name: 'Pistachio', hex: '#7cb342', classic: '#7bd148' },
  10: { name: 'Avocado', hex: '#c0ca33', classic: '#b3dc6c' },
  11: { name: 'Citron', hex: '#e4c441', classic: '#fbe983' },
  12: { name: 'Banana', hex: '#f6bf26', classic: '#fad165' },
  13: { name: 'Sage', hex: '#33b679', classic: '#92e1c0' },
  14: { name: 'Peacock', hex: '#039be5', classic: '#9fe1e7' },
  15: { name: 'Cobalt', hex: '#4285f4', classic: '#9fc6e7' },
  16: { name: 'Blueberry', hex: '#3f51b5', classic: '#4986e7' },
  17: { name: 'Lavender', hex: '#7986cb', classic: '#9a9cff' },
  18: { name: 'Wisteria', hex: '#b39ddb', classic: '#b99aff' },
  19: { name: 'Graphite', hex: '#616161', classic: '#c2c2c2' },
  20: { name: 'Birch', hex: '#a79b8e', classic: '#cabdbf' },
  21: { name: 'Radicchio', hex: '#ad1457', classic: '#cca6ac' },
  22: { name: 'Cherry Blossom', hex: '#d81b60', classic: '#f691b2' },
  23: { name: 'Grape', hex: '#8e24aa', classic: '#cd74e6' },
  24: { name: 'Amethyst', hex: '#9e69af', classic: '#a47ae2' }
}

export const DEFAULT_CALENDAR_COLOR = CALENDAR_COLORS[14].hex

const HEX = /^#[0-9a-f]{6}$/i

/**
 * A calendar's color as Google Calendar draws it. The API answers with the classic shade of the
 * picked id, which maps to the current one; any other hex is a custom color and stays as it is.
 */
export function calendarColorOf(colorId: string | null, backgroundColor: string | null): string {
  const named = colorId ? CALENDAR_COLORS[colorId] : undefined
  const background = backgroundColor && HEX.test(backgroundColor) ? backgroundColor.toLowerCase() : null
  if (named && (!background || background === named.classic)) return named.hex
  return background ?? named?.hex ?? DEFAULT_CALENDAR_COLOR
}

export function eventColorOf(colorId: string | null, calendarColor: string): string {
  return (colorId ? EVENT_COLORS[colorId]?.hex : undefined) ?? calendarColor
}

function channel(value: number): number {
  const share = value / 255
  return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4
}

/** Black or white, whichever reads better on `hex`. */
export function textOn(hex: string): '#000000' | '#ffffff' {
  if (!HEX.test(hex)) return '#ffffff'
  const luminance = 0.2126 * channel(parseInt(hex.slice(1, 3), 16)) +
    0.7152 * channel(parseInt(hex.slice(3, 5), 16)) + 0.0722 * channel(parseInt(hex.slice(5, 7), 16))
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff'
}

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/** Sunday first, matching `Date.getDay()`. */
export const WEEKDAY_CODES: readonly Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday'
}
const WORKWEEK: readonly Weekday[] = ['MO', 'TU', 'WE', 'TH', 'FR']
const ORDINALS: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' }

export type RecurrenceEnd =
  | { kind: 'never' }
  | { kind: 'count'; count: number }
  /** `until` is Google's own token: YYYYMMDD, or YYYYMMDDTHHMMSSZ for a timed series. */
  | { kind: 'until'; until: string }

export type MonthlyPattern =
  | { kind: 'day'; day: number }
  | { kind: 'weekday'; ordinal: number; weekday: Weekday }

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  interval: number
  /** Weekly days. Empty means the start's own weekday. */
  weekdays: Weekday[]
  /** Null means the start's own day of the month. */
  monthly: MonthlyPattern | null
  end: RecurrenceEnd
  /** RRULE parts Ego does not edit, kept as written so a change cannot drop them. */
  extra: string[]
}

function isWeekday(value: string): value is Weekday {
  return (WEEKDAY_CODES as readonly string[]).includes(value)
}

function isFrequency(value: string): value is RecurrenceFrequency {
  return value === 'DAILY' || value === 'WEEKLY' || value === 'MONTHLY' || value === 'YEARLY'
}

/** Reads one `RRULE:` line. Null for anything else, or a rule Ego cannot show. */
export function parseRecurrenceRule(line: string): RecurrenceRule | null {
  const body = line.startsWith('RRULE:') ? line.slice(6) : null
  if (body === null) return null
  const parts = new Map<string, string>()
  for (const part of body.split(';')) {
    const [name, value] = part.split('=')
    if (name && value !== undefined) parts.set(name.toUpperCase(), value)
  }
  const frequency = parts.get('FREQ')
  if (!frequency || !isFrequency(frequency)) return null
  const interval = Number(parts.get('INTERVAL') ?? '1')
  const rule: RecurrenceRule = {
    frequency,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    weekdays: [],
    monthly: null,
    end: { kind: 'never' },
    extra: []
  }
  const count = parts.get('COUNT')
  const until = parts.get('UNTIL')
  if (count && Number(count) > 0) rule.end = { kind: 'count', count: Number(count) }
  else if (until && /^\d{8}(T\d{6}Z?)?$/.test(until)) rule.end = { kind: 'until', until }
  const byDay = parts.get('BYDAY')
  const setPosition = parts.get('BYSETPOS')
  if (byDay) {
    const days = byDay.split(',').map((item) => /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(item))
    if (days.some((match) => !match || !isWeekday(match[2]))) return null
    if (frequency === 'MONTHLY' || frequency === 'YEARLY') {
      const match = days[0]
      const ordinal = Number(match?.[1] ?? setPosition ?? '0')
      if (days.length !== 1 || !match || !isWeekday(match[2]) || !ORDINALS[ordinal]) return null
      rule.monthly = { kind: 'weekday', ordinal, weekday: match[2] }
    } else {
      rule.weekdays = days.flatMap((match) => match && isWeekday(match[2]) ? [match[2]] : [])
    }
  }
  const byMonthDay = parts.get('BYMONTHDAY')
  if (byMonthDay) {
    const day = Number(byMonthDay)
    if (!Number.isInteger(day) || day < 1 || day > 31) return null
    rule.monthly = { kind: 'day', day }
  }
  const handled = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYSETPOS'])
  for (const [name, value] of parts) if (!handled.has(name)) rule.extra.push(`${name}=${value}`)
  return rule
}

export function formatRecurrenceRule(rule: RecurrenceRule): string {
  const parts = [`FREQ=${rule.frequency}`]
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`)
  if (rule.frequency === 'WEEKLY' && rule.weekdays.length > 0) {
    parts.push(`BYDAY=${[...rule.weekdays].sort((a, b) => weekdayOrder(a) - weekdayOrder(b)).join(',')}`)
  }
  if ((rule.frequency === 'MONTHLY' || rule.frequency === 'YEARLY') && rule.monthly) {
    parts.push(rule.monthly.kind === 'day'
      ? `BYMONTHDAY=${rule.monthly.day}`
      : `BYDAY=${rule.monthly.ordinal}${rule.monthly.weekday}`)
  }
  if (rule.end.kind === 'count') parts.push(`COUNT=${rule.end.count}`)
  if (rule.end.kind === 'until') parts.push(`UNTIL=${rule.end.until}`)
  parts.push(...rule.extra)
  return `RRULE:${parts.join(';')}`
}

function weekdayOrder(day: Weekday): number {
  return (WEEKDAY_CODES.indexOf(day) + 6) % 7
}

function dateParts(date: string): { year: number; month: number; day: number; weekday: Weekday } {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day, weekday: WEEKDAY_CODES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] }
}

/** The weekday-of-the-month a date falls on: the 2nd Tuesday, or the last one in a fifth week. */
export function monthlyWeekdayOf(date: string): { ordinal: number; weekday: Weekday } {
  const { day, weekday } = dateParts(date)
  const ordinal = Math.ceil(day / 7)
  return { ordinal: ordinal === 5 ? -1 : ordinal, weekday }
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** An `UNTIL` token as YYYY-MM-DD in `timeZone`. */
export function untilDate(until: string, timeZone: string | null = null): string {
  const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`
  if (until.length === 8) return date
  const instant = `${date}T${until.slice(9, 11)}:${until.slice(11, 13)}:${until.slice(13, 15)}Z`
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {})
    }).formatToParts(new Date(instant))
    const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? ''
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return date
  }
}

/** The token for a series that ends at `instant`, or on `date` for an all-day series. */
export function untilToken(end: { date: string } | { instant: string }): string {
  if ('date' in end) return end.date.replace(/-/g, '')
  return new Date(end.instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function longDate(date: string, withYear: boolean): string {
  const { year, month, day } = dateParts(date)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    month: withYear ? 'short' : 'long', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {})
  })
}

/**
 * "Weekly on Monday and Wednesday", "Monthly on the last Friday, 10 times". `start` is the first
 * day of the series, which fills in what the rule leaves to it.
 */
export function describeRecurrence(lines: readonly string[], start: string, timeZone: string | null = null): string | null {
  const line = lines.find((item) => item.startsWith('RRULE:'))
  if (!line) return lines.length > 0 ? 'Repeats' : null
  const rule = parseRecurrenceRule(line)
  if (!rule) return 'Repeats'
  const { weekday } = dateParts(start)
  const every = (unit: string): string => `Every ${rule.interval} ${unit}s`
  let text: string
  switch (rule.frequency) {
    case 'DAILY':
      text = rule.interval === 1 ? 'Daily' : every('day')
      break
    case 'WEEKLY': {
      const days = rule.weekdays.length > 0 ? [...rule.weekdays].sort((a, b) => weekdayOrder(a) - weekdayOrder(b)) : [weekday]
      if (rule.interval === 1 && days.length === 5 && WORKWEEK.every((day) => days.includes(day))) {
        text = 'Every weekday'
      } else {
        const names = days.length === 7 ? 'every day' : list(days.map((day) => WEEKDAY_NAMES[day]))
        text = `${rule.interval === 1 ? 'Weekly' : every('week')} on ${names}`
      }
      break
    }
    case 'MONTHLY': {
      const pattern = rule.monthly ?? { kind: 'day' as const, day: dateParts(start).day }
      const on = pattern.kind === 'day' ? `day ${pattern.day}` : `the ${ORDINALS[pattern.ordinal]} ${WEEKDAY_NAMES[pattern.weekday]}`
      text = `${rule.interval === 1 ? 'Monthly' : every('month')} on ${on}`
      break
    }
    case 'YEARLY':
      text = `${rule.interval === 1 ? 'Annually' : every('year')} on ${longDate(start, false)}`
      break
  }
  if (rule.end.kind === 'count') text += `, ${rule.end.count} times`
  if (rule.end.kind === 'until') text += `, until ${longDate(untilDate(rule.end.until, timeZone), true)}`
  return text
}

export type RecurrencePreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays'

/** The quick choices Google Calendar offers, worded for the event's start day. */
export function recurrencePresets(start: string): Array<{ preset: RecurrencePreset; label: string; lines: string[] }> {
  const { weekday } = dateParts(start)
  const nth = monthlyWeekdayOf(start)
  return [
    { preset: 'none', label: 'Does not repeat', lines: [] },
    { preset: 'daily', label: 'Daily', lines: ['RRULE:FREQ=DAILY'] },
    { preset: 'weekly', label: `Weekly on ${WEEKDAY_NAMES[weekday]}`, lines: [`RRULE:FREQ=WEEKLY;BYDAY=${weekday}`] },
    {
      preset: 'monthly',
      label: `Monthly on the ${ORDINALS[nth.ordinal]} ${WEEKDAY_NAMES[nth.weekday]}`,
      lines: [`RRULE:FREQ=MONTHLY;BYDAY=${nth.ordinal}${nth.weekday}`]
    },
    { preset: 'yearly', label: `Annually on ${longDate(start, false)}`, lines: ['RRULE:FREQ=YEARLY'] },
    { preset: 'weekdays', label: 'Every weekday (Monday to Friday)', lines: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'] }
  ]
}

/**
 * Splits a series at one occurrence for "this and following". The old series stops before it, and
 * the new one carries the rest. `before` counts the occurrences ahead of the split, which a
 * series with COUNT needs to divide its total.
 */
export function splitRecurrence(
  lines: readonly string[], until: string, before: number
): { ended: string[]; rest: string[] } {
  const ended: string[] = []
  const rest: string[] = []
  for (const line of lines) {
    const rule = line.startsWith('RRULE:') ? parseRecurrenceRule(line) : null
    if (!rule) {
      ended.push(line)
      rest.push(line)
      continue
    }
    if (rule.end.kind === 'count') {
      ended.push(formatRecurrenceRule({ ...rule, end: { kind: 'count', count: Math.max(1, before) } }))
      rest.push(formatRecurrenceRule({ ...rule, end: { kind: 'count', count: Math.max(1, rule.end.count - before) } }))
    } else {
      ended.push(formatRecurrenceRule({ ...rule, end: { kind: 'until', until } }))
      rest.push(line)
    }
  }
  return { ended, rest }
}
