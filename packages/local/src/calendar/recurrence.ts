import {
  WEEKDAY_CODES, formatRecurrenceRule, monthlyWeekdayOf, parseRecurrenceRule, recurrencePresets, untilDate, untilToken,
  type RecurrencePreset, type RecurrenceRule
} from '@ego/core'
import { parseIso, shiftIso } from '../dates'
import { instantAt } from './layout'

export function ruleOf(lines: readonly string[]): RecurrenceRule | null {
  const line = lines.find((item) => item.startsWith('RRULE:'))
  return line ? parseRecurrenceRule(line) : null
}

/** Swaps the RRULE and keeps the EXDATE lines, so skipped occurrences stay skipped. */
export function withRule(lines: readonly string[], rule: RecurrenceRule | null): string[] {
  const rest = lines.filter((line) => !line.startsWith('RRULE:'))
  return rule ? [formatRecurrenceRule(rule), ...rest] : []
}

/** Which quick choice the lines match, or `custom` for anything else. */
export function presetOf(lines: readonly string[], startDay: string): RecurrencePreset | 'custom' {
  const rule = lines.find((line) => line.startsWith('RRULE:'))
  if (!rule) return 'none'
  const match = recurrencePresets(startDay).find((preset) => preset.lines[0] === rule)
  return match?.preset ?? 'custom'
}

/** A starting point for the custom builder: weekly on the start's weekday. */
export function defaultRule(startDay: string): RecurrenceRule {
  return {
    frequency: 'WEEKLY', interval: 1, weekdays: [WEEKDAY_CODES[parseIso(startDay).getDay()]], monthly: null,
    end: { kind: 'never' }, extra: []
  }
}

/** The token for "ends on" a day: the day itself for an all-day series, its last second otherwise. */
export function untilFor(day: string, allDay: boolean): string {
  if (allDay) return untilToken({ date: day })
  return untilToken({ instant: new Date(Date.parse(instantAt(shiftIso(day, 1), 0)) - 1000).toISOString() })
}

/** The day an UNTIL token ends on, on this device's clock. */
export function untilDay(until: string): string {
  return untilDate(until, null)
}

export function monthlyChoices(startDay: string): Array<{ kind: 'day' | 'weekday'; label: string; rule: RecurrenceRule['monthly'] }> {
  const nth = monthlyWeekdayOf(startDay)
  const ordinal = nth.ordinal === -1 ? 'last' : ['first', 'second', 'third', 'fourth', 'fifth'][nth.ordinal - 1]
  const weekday = parseIso(startDay).toLocaleDateString('en-US', { weekday: 'long' })
  return [
    { kind: 'day', label: `On day ${parseIso(startDay).getDate()}`, rule: { kind: 'day', day: parseIso(startDay).getDate() } },
    { kind: 'weekday', label: `On the ${ordinal} ${weekday}`, rule: { kind: 'weekday', ordinal: nth.ordinal, weekday: nth.weekday } }
  ]
}
