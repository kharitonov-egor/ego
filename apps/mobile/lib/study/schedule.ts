import type { CanvasDue } from '@ego/core'
import { isoFromParts, parseIso, shiftIso } from '../dates'
import type { StudyItem } from './store'

export type StudyView = 'upcoming' | 'past'

export interface StudySection {
  key: string
  /** Null for the overdue group, which spans days. */
  day: string | null
  data: StudyItem[]
}

export interface CourseSummary {
  course: string
  left: number
  overdue: number
  total: number
  next: StudyItem | null
}

type Dated = { due: CanvasDue }

export function localDay(instant: Date): string {
  return isoFromParts(instant.getFullYear(), instant.getMonth(), instant.getDate())
}

/** The day on this phone's calendar. A UTC deadline just after midnight belongs to the evening before. */
export function dueDay(item: Dated): string {
  return item.due.kind === 'day' ? item.due.date : localDay(new Date(item.due.at))
}

/** An all-day item is due by the end of its day. */
export function dueTime(item: Dated): number {
  if (item.due.kind === 'time') return Date.parse(item.due.at)
  const day = parseIso(item.due.date)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999).getTime()
}

export function isDone(item: StudyItem): boolean {
  return item.doneAt !== null
}

export function isOverdue(item: StudyItem, now: Date): boolean {
  return !isDone(item) && dueTime(item) < now.getTime()
}

function byDue(a: StudyItem, b: StudyItem): number {
  return dueTime(a) - dueTime(b) || a.title.localeCompare(b.title)
}

function groupByDay(items: StudyItem[]): StudySection[] {
  const sections: StudySection[] = []
  for (const item of items) {
    const day = dueDay(item)
    const current = sections[sections.length - 1]
    if (current && current.day === day) current.data.push(item)
    else sections.push({ key: day, day, data: [item] })
  }
  return sections
}

/**
 * Upcoming starts with anything from an earlier day still unchecked, then every day from today on.
 * Past lists earlier days, most recent first.
 */
export function studySections(items: StudyItem[], view: StudyView, now: Date, course: string | null): StudySection[] {
  const today = localDay(now)
  const sorted = items.filter((item) => course === null || item.course === course).sort(byDue)
  if (view === 'past') return groupByDay(sorted.filter((item) => dueDay(item) < today)).reverse()
  const overdue = sorted.filter((item) => !isDone(item) && dueDay(item) < today)
  const ahead = groupByDay(sorted.filter((item) => dueDay(item) >= today))
  return overdue.length > 0 ? [{ key: 'overdue', day: null, data: overdue }, ...ahead] : ahead
}

export function courseList(items: StudyItem[]): string[] {
  return [...new Set(items.map((item) => item.course).filter((course): course is string => course !== null))]
    .sort((a, b) => a.localeCompare(b))
}

/** Colors follow the sorted course list, so each course keeps its color for the whole term. */
export function courseColors(courses: string[], palette: readonly string[]): Map<string, string> {
  return new Map(courses.map((course, index) => [course, palette[index % palette.length]]))
}

export function courseSummaries(items: StudyItem[], now: Date): CourseSummary[] {
  return courseList(items).map((course) => {
    const own = items.filter((item) => item.course === course).sort(byDue)
    const open = own.filter((item) => !isDone(item))
    return {
      course,
      left: open.filter((item) => dueTime(item) >= now.getTime()).length,
      overdue: open.filter((item) => isOverdue(item, now)).length,
      total: own.length,
      next: open.find((item) => dueTime(item) >= now.getTime()) ?? null
    }
  })
}

export function dueWithin(items: StudyItem[], now: Date, days: number): number {
  const end = shiftIso(localDay(now), days)
  return items.filter((item) => !isDone(item) && dueTime(item) >= now.getTime() && dueDay(item) < end).length
}

export function shortDay(day: string): string {
  return parseIso(day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function dayHeading(day: string, today: string): string {
  if (day === today) return `Today · ${shortDay(day)}`
  if (day === shiftIso(today, 1)) return `Tomorrow · ${shortDay(day)}`
  if (day === shiftIso(today, -1)) return `Yesterday · ${shortDay(day)}`
  return shortDay(day)
}

export function dueClock(item: Dated): string {
  return item.due.kind === 'day'
    ? 'All day'
    : new Date(item.due.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function dueSentence(item: Dated): string {
  const day = shortDay(dueDay(item))
  return item.due.kind === 'day' ? `Due ${day}, any time` : `Due ${day} at ${dueClock(item)}`
}
