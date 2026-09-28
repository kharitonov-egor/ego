import { describe, expect, it } from 'vitest'
import { canvasAssignmentUrl, canvasCourseCode, isCalendarText, parseCanvasCalendar } from '../src/canvas-calendar'

const FEED = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:icalendar-ruby',
  'X-WR-CALNAME:Student Calendar (Canvas)',
  'BEGIN:VEVENT',
  'UID:event-assignment-100',
  'DTSTART:20260905T025900Z',
  'DTEND:20260905T025900Z',
  'DESCRIPTION:Submit a PDF with your solutions. For calculat',
  ' ions\\, show your work.\\n\\n \\n\\n \\n\\n ',
  'SUMMARY:PS-1 [CDA4205.002F26]',
  'URL;VALUE=URI:https://school.instructure.com/calendar?include_contexts=co',
  ' urse_2065532&month=09&year=2026#assignment_100',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-200',
  'DTSTART;VALUE=DATE;VALUE=DATE:20260911',
  'SUMMARY:Assignment 1 [COT4210.001F26]',
  'URL;VALUE=URI:https://school.instructure.com/calendar?include_contexts=course_2067196&month=09&year=2026#assignment_200',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-override-300',
  'DTSTART:20260919T025900Z',
  'SUMMARY:Homework 1 - Proof by Induction (1 student) [COT4400.001F26]',
  'URL;VALUE=URI:https://school.instructure.com/calendar?include_contexts=course_2066468&month=09&year=2026#assignment_301',
  'BEGIN:VALARM',
  'DESCRIPTION:Reminder text that belongs to the alarm',
  'TRIGGER:-PT1H',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-calendar-event-400',
  'DTSTART;TZID=America/New_York:20261006T170000',
  'SUMMARY:Review session',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-500',
  'DTSTART:20261008T210000Z',
  'STATUS:CANCELLED',
  'SUMMARY:Dropped quiz [CDA4205.002F26]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-600',
  'SUMMARY:No date [CDA4205.002F26]',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

describe('parseCanvasCalendar', () => {
  const items = parseCanvasCalendar(FEED)
  const byId = new Map(items.map((item) => [item.id, item]))

  it('keeps every dated, live event and drops cancelled or undated ones', () => {
    expect(items.map((item) => item.id)).toEqual([
      'event-assignment-100', 'event-assignment-200', 'event-assignment-override-300', 'event-calendar-event-400'
    ])
  })

  it('reads a UTC deadline as an instant', () => {
    expect(byId.get('event-assignment-100')?.due).toEqual({ kind: 'time', at: '2026-09-05T02:59:00.000Z' })
  })

  it('reads a bare date as an all-day item, even with the parameter written twice', () => {
    expect(byId.get('event-assignment-200')?.due).toEqual({ kind: 'day', date: '2026-09-11' })
  })

  it('keeps only the written date of a zoned time', () => {
    expect(byId.get('event-calendar-event-400')?.due).toEqual({ kind: 'day', date: '2026-10-06' })
  })

  it('splits the course code out of the title and drops the override suffix', () => {
    expect(byId.get('event-assignment-100')).toMatchObject({ title: 'PS-1', course: 'CDA4205' })
    expect(byId.get('event-assignment-override-300')).toMatchObject({ title: 'Homework 1 - Proof by Induction', course: 'COT4400' })
    expect(byId.get('event-calendar-event-400')).toMatchObject({ title: 'Review session', course: null })
  })

  it('unfolds lines, unescapes text, and trims empty paragraphs', () => {
    expect(byId.get('event-assignment-100')?.description).toBe('Submit a PDF with your solutions. For calculations, show your work.')
  })

  it('ignores properties inside a nested alarm', () => {
    expect(byId.get('event-assignment-override-300')?.description).toBe('')
  })

  it('links straight to the assignment page', () => {
    expect(byId.get('event-assignment-100')?.url).toBe('https://school.instructure.com/courses/2065532/assignments/100')
    expect(byId.get('event-assignment-override-300')?.url).toBe('https://school.instructure.com/courses/2066468/assignments/301')
    expect(byId.get('event-calendar-event-400')?.url).toBeNull()
  })

  it('lets a later event with the same UID replace the earlier one', () => {
    const repeated = FEED.replace('END:VCALENDAR', [
      'BEGIN:VEVENT', 'UID:event-assignment-100', 'DTSTART:20260906T025900Z', 'SUMMARY:PS-1 (moved) [CDA4205.002F26]', 'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n'))
    const moved = parseCanvasCalendar(repeated).find((item) => item.id === 'event-assignment-100')
    expect(moved?.title).toBe('PS-1 (moved)')
    expect(moved?.due).toEqual({ kind: 'time', at: '2026-09-06T02:59:00.000Z' })
  })
})

describe('Canvas helpers', () => {
  it('shortens a section code to the course number', () => {
    expect(canvasCourseCode('CDA4205L.002F26')).toBe('CDA4205L')
    expect(canvasCourseCode('Fall 2026 - Intro to CS')).toBe('Fall 2026 - Intro to CS')
  })

  it('leaves a link it does not recognise alone', () => {
    expect(canvasAssignmentUrl('https://school.instructure.com/calendar?event_id=4')).toBe('https://school.instructure.com/calendar?event_id=4')
  })

  it('tells a calendar from a login page', () => {
    expect(isCalendarText(FEED)).toBe(true)
    expect(isCalendarText('<!DOCTYPE html><html>')).toBe(false)
  })
})
