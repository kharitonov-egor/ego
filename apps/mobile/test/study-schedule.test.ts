import { describe, expect, it } from 'vitest'
import {
  courseColors, courseList, courseSummaries, dayHeading, dueDay, dueWithin, isOverdue, overdueCount, studySections,
  type StudyFilter
} from '../lib/study/schedule'
import type { StudyItem } from '../lib/study/store'

const local = (day: number, hour: number, minute = 0): string => new Date(2026, 8, day, hour, minute).toISOString()
const NOW = new Date(2026, 8, 28, 12, 0)
const ALL: StudyFilter = { course: null, hideOverdue: false }

function item(id: string, due: StudyItem['due'], overrides: Partial<StudyItem> = {}): StudyItem {
  return { id, title: id, course: 'CDA4205', due, url: null, description: '', doneAt: null, pending: false, ...overrides }
}

const ITEMS: StudyItem[] = [
  item('late-lab', { kind: 'day', date: '2026-09-24' }, { course: 'CDA4205L' }),
  item('finished', { kind: 'time', at: local(25, 22, 59) }, { doneAt: '2026-09-25T20:00:00.000Z', course: 'COT4400' }),
  item('this-morning', { kind: 'time', at: local(28, 9) }),
  item('tonight', { kind: 'time', at: local(28, 22, 59) }, { course: 'COT4400' }),
  item('today-any-time', { kind: 'day', date: '2026-09-28' }, { course: 'COT4210' }),
  item('next-week', { kind: 'time', at: new Date(2026, 9, 5, 17).toISOString() })
]

describe('study days', () => {
  it('puts a deadline on the day it falls on this phone', () => {
    expect(dueDay(item('x', { kind: 'time', at: local(25, 22, 59) }))).toBe('2026-09-25')
    expect(dueDay(item('x', { kind: 'day', date: '2026-09-25' }))).toBe('2026-09-25')
  })

  it('treats an all-day item as due at the end of its day', () => {
    expect(isOverdue(item('x', { kind: 'day', date: '2026-09-28' }), NOW)).toBe(false)
    expect(isOverdue(item('x', { kind: 'day', date: '2026-09-27' }), NOW)).toBe(true)
    expect(isOverdue(item('x', { kind: 'time', at: local(28, 9) }), NOW)).toBe(true)
    expect(isOverdue(item('x', { kind: 'time', at: local(28, 9) }, { doneAt: 'yes' }), NOW)).toBe(false)
  })

  it('opens Upcoming with unchecked work from earlier days, then each day from today', () => {
    const sections = studySections(ITEMS, 'upcoming', NOW, ALL)
    expect(sections.map((section) => [section.day, section.data.map((entry) => entry.id)])).toEqual([
      [null, ['late-lab']],
      ['2026-09-28', ['this-morning', 'tonight', 'today-any-time']],
      ['2026-10-05', ['next-week']]
    ])
  })

  it('lists earlier days in Past, newest first, done or not', () => {
    const sections = studySections(ITEMS, 'past', NOW, ALL)
    expect(sections.map((section) => section.day)).toEqual(['2026-09-25', '2026-09-24'])
  })

  it('narrows to one course', () => {
    const sections = studySections(ITEMS, 'upcoming', NOW, { course: 'COT4400', hideOverdue: false })
    expect(sections.flatMap((section) => section.data.map((entry) => entry.id))).toEqual(['tonight'])
  })

  it('hides every unchecked item whose deadline has passed, in both views', () => {
    const hidden = { course: null, hideOverdue: true }
    expect(studySections(ITEMS, 'upcoming', NOW, hidden).map((section) => [section.day, section.data.map((entry) => entry.id)])).toEqual([
      ['2026-09-28', ['tonight', 'today-any-time']],
      ['2026-10-05', ['next-week']]
    ])
    expect(studySections(ITEMS, 'past', NOW, hidden).flatMap((section) => section.data.map((entry) => entry.id))).toEqual(['finished'])
  })

  it('counts overdue items for the chosen course', () => {
    expect(overdueCount(ITEMS, NOW, null)).toBe(2)
    expect(overdueCount(ITEMS, NOW, 'CDA4205L')).toBe(1)
    expect(overdueCount(ITEMS, NOW, 'COT4400')).toBe(0)
  })

  it('counts what is still ahead in the next week', () => {
    expect(dueWithin(ITEMS, NOW, 7)).toBe(2)
    expect(dueWithin(ITEMS, NOW, 8)).toBe(3)
  })

  it('names nearby days', () => {
    expect(dayHeading('2026-09-28', '2026-09-28')).toMatch(/^Today · Mon, Sep 28$/)
    expect(dayHeading('2026-09-29', '2026-09-28')).toMatch(/^Tomorrow · /)
    expect(dayHeading('2026-10-05', '2026-09-28')).toBe('Mon, Oct 5')
  })
})

describe('courses', () => {
  it('gives each course a color in sorted order', () => {
    const courses = courseList(ITEMS)
    expect(courses).toEqual(['CDA4205', 'CDA4205L', 'COT4210', 'COT4400'])
    expect(courseColors(courses, ['red', 'blue', 'green']).get('COT4400')).toBe('red')
  })

  it('summarises what is left, what is overdue, and what comes next', () => {
    const cda = courseSummaries(ITEMS, NOW).find((summary) => summary.course === 'CDA4205')
    expect(cda).toMatchObject({ left: 1, overdue: 1, total: 2 })
    expect(cda?.next?.id).toBe('next-week')
  })
})
