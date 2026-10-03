import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import type { LocalDatabase } from '../database/types'
import { shiftIso } from '../dates'
import { instantAt } from './layout'

/** The account id Ego's own items use, so they never collide with a Google account. */
export const OVERLAY_ACCOUNT = 'ego'

export type OverlaySource = 'tasks' | 'study' | 'gym'

/** Greys, so Ego's own items stay apart from Google's colors. */
export const OVERLAY_CALENDARS: readonly CalendarInfo[] = ([
  ['tasks', 'Tasks', '#9e9e9e'],
  ['study', 'Study', '#bdbdbd'],
  ['gym', 'Gym', '#757575']
] as const).map(([id, name, color]) => ({
  key: `${OVERLAY_ACCOUNT}/${id}`, accountId: OVERLAY_ACCOUNT, id, name, description: null, timeZone: null,
  accessRole: 'reader', primary: false, selected: true, colorId: null, color, defaultReminders: [], meet: false,
  deleted: false, updatedAt: '1970-01-01T00:00:00.000Z'
}))

export function overlaySourceOf(event: Pick<CalendarEvent, 'accountId' | 'calendarId'>): OverlaySource | null {
  if (event.accountId !== OVERLAY_ACCOUNT) return null
  return event.calendarId === 'tasks' || event.calendarId === 'study' || event.calendarId === 'gym' ? event.calendarId : null
}

function item(source: OverlaySource, id: string, title: string, times: { allDay: boolean; start: string; end: string }, done: boolean): CalendarEvent {
  return {
    key: `${OVERLAY_ACCOUNT}/${source}/${id}`, accountId: OVERLAY_ACCOUNT, calendarId: source, id, recurringEventId: null,
    originalStart: null, status: done ? 'tentative' : 'confirmed', title, description: null, location: null, colorId: null,
    ...times, timeZone: null, htmlLink: null, conference: null, attendees: [], attendeesOmitted: false,
    organizer: { email: null, name: null, self: true }, response: null, guestsCanModify: false, guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false, reminders: { useDefault: false, overrides: [] }, transparency: 'transparent',
    visibility: 'default', eventType: 'default', attachments: [], etag: '', googleUpdated: '', deleted: false, updatedAt: ''
  }
}

function at(day: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return instantAt(day, hours * 60 + minutes)
}

/**
 * Task due dates, Canvas due dates, and logged workouts between two days, drawn on the calendar
 * read-only. A done task or assignment comes back marked tentative, which the views strike through.
 */
export async function overlayEvents(db: LocalDatabase, from: string, to: string): Promise<CalendarEvent[]> {
  const [cards, assignments, workouts] = await Promise.all([
    db.all<{ id: string; title: string; due_date: string; due_time: string | null; done_at: string | null }>(
      `SELECT id, title, due_date, due_time, done_at FROM task_cards
        WHERE deleted_at IS NULL AND archived_at IS NULL AND due_date >= ? AND due_date <= ?`, [from, to]),
    db.all<{ id: string; title: string; course: string | null; due_at: string | null; due_date: string | null; done_at: string | null }>(
      `SELECT id, title, course, due_at, due_date, done_at FROM study_assignments
        WHERE (due_date >= ? AND due_date <= ?) OR (due_at >= ? AND due_at < ?)`,
      [from, to, new Date(`${shiftIso(from, -1)}T00:00:00`).toISOString(), new Date(`${shiftIso(to, 2)}T00:00:00`).toISOString()]),
    db.all<{ date: string; exercises: number }>(
      `SELECT date, COUNT(DISTINCT exercise_id) AS exercises FROM gym_sets
        WHERE deleted_at IS NULL AND date >= ? AND date <= ? GROUP BY date`, [from, to])
  ])
  const events: CalendarEvent[] = []
  for (const card of cards) {
    const times = card.due_time
      ? { allDay: false, start: at(card.due_date, card.due_time), end: new Date(Date.parse(at(card.due_date, card.due_time)) + 30 * 60_000).toISOString() }
      : { allDay: true, start: card.due_date, end: shiftIso(card.due_date, 1) }
    events.push(item('tasks', card.id, card.title, times, card.done_at !== null))
  }
  for (const assignment of assignments) {
    const title = assignment.course ? `${assignment.title} · ${assignment.course}` : assignment.title
    const times = assignment.due_at
      ? { allDay: false, start: new Date(Date.parse(assignment.due_at) - 30 * 60_000).toISOString(), end: assignment.due_at }
      : assignment.due_date ? { allDay: true, start: assignment.due_date, end: shiftIso(assignment.due_date, 1) } : null
    if (times) events.push(item('study', assignment.id, title, times, assignment.done_at !== null))
  }
  for (const workout of workouts) {
    const label = `Workout · ${workout.exercises} exercise${workout.exercises === 1 ? '' : 's'}`
    events.push(item('gym', workout.date, label, { allDay: true, start: workout.date, end: shiftIso(workout.date, 1) }, false))
  }
  return events
}
