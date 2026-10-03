import { calendarEventKey, type CalendarEvent, type CalendarEventDraft, type CalendarInfo, type CalendarSeries } from '@ego/api-contracts'
import { parseIso, shiftIso } from '../dates'
import { inAllDayRow, instantAt, localDayOf } from './layout'

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function blankDraft(
  calendar: Pick<CalendarInfo, 'defaultReminders'> | null, times: { allDay: boolean; start: string; end: string }
): CalendarEventDraft {
  return {
    title: '',
    description: null,
    location: null,
    allDay: times.allDay,
    start: times.start,
    end: times.end,
    timeZone: deviceTimeZone(),
    recurrence: [],
    colorId: null,
    attendees: [],
    meet: null,
    reminders: { useDefault: true, overrides: calendar?.defaultReminders ?? [] },
    transparency: times.allDay ? 'transparent' : 'opaque',
    visibility: 'default',
    guestsCanModify: false,
    guestsCanInviteOthers: true,
    guestsCanSeeOtherGuests: true
  }
}

/** The editor's starting point. A series' rule comes from `series`, which Google sends separately. */
export function draftFrom(event: CalendarEvent, series: CalendarSeries | null = null): CalendarEventDraft {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    timeZone: event.timeZone ?? deviceTimeZone(),
    recurrence: series?.recurrence ?? [],
    colorId: event.colorId,
    attendees: event.attendees.filter((person) => !person.resource).map((person) => ({ email: person.email, optional: person.optional })),
    meet: null,
    reminders: { useDefault: event.reminders.useDefault, overrides: event.reminders.overrides },
    transparency: event.transparency,
    visibility: event.visibility,
    guestsCanModify: event.guestsCanModify,
    guestsCanInviteOthers: event.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Only the fields the editor changed, so Google keeps everything else as it is. Times travel
 * together, with the zone, because Google needs all of them to place the event.
 */
export function draftChanges(before: CalendarEventDraft, after: CalendarEventDraft): Partial<CalendarEventDraft> {
  const changes: Partial<CalendarEventDraft> = {}
  const fields: Array<keyof CalendarEventDraft> = [
    'title', 'description', 'location', 'recurrence', 'colorId', 'attendees', 'meet', 'reminders', 'transparency',
    'visibility', 'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests'
  ]
  for (const field of fields) {
    if (!same(before[field], after[field])) Object.assign(changes, { [field]: after[field] })
  }
  if (after.meet === null) delete changes.meet
  if (before.allDay !== after.allDay || before.start !== after.start || before.end !== after.end) {
    changes.allDay = after.allDay
    changes.start = after.start
    changes.end = after.end
    changes.timeZone = after.timeZone
  }
  return changes
}

export interface EventPermissions {
  /** Title, times, guests, and the rest. */
  edit: boolean
  /** Yes, maybe, or no as a guest. */
  respond: boolean
  /** Color and reminders are the account's own even on someone else's event. */
  personal: boolean
  /** Why editing is off, for the panel. */
  reason: string | null
}

export function isWritable(calendar: Pick<CalendarInfo, 'accessRole'> | null | undefined): boolean {
  return calendar?.accessRole === 'owner' || calendar?.accessRole === 'writer'
}

export function permissionsFor(event: CalendarEvent, calendar: CalendarInfo | null | undefined): EventPermissions {
  const writable = isWritable(calendar)
  const guest = event.response !== null
  const managed = event.eventType === 'fromGmail' || event.eventType === 'birthday'
  const edit = writable && !managed && (!guest || event.guestsCanModify)
  let reason: string | null = null
  if (!writable) reason = 'This calendar is read-only for you.'
  else if (managed) reason = event.eventType === 'birthday' ? 'Google makes birthdays from your contacts.' : 'Gmail made this event, so only some parts can change.'
  else if (guest && !event.guestsCanModify) reason = 'Only the organizer can change this event.'
  return { edit, respond: guest, personal: writable, reason }
}

/** Repeating events ask which occurrences a change covers. */
export function isRecurring(event: Pick<CalendarEvent, 'recurringEventId'>): boolean {
  return event.recurringEventId !== null
}

/** A timed block that runs a day or more draws in the all-day bar, where only whole days move. */
export function movesByDay(event: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>): boolean {
  return inAllDayRow(event)
}

export const REMINDER_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'At the start' },
  { minutes: 5, label: '5 minutes before' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' }
]

export function reminderLabel(minutes: number, method: 'popup' | 'email' = 'popup'): string {
  const known = REMINDER_CHOICES.find((choice) => choice.minutes === minutes)?.label
  const text = known ?? (minutes % 1440 === 0 ? `${minutes / 1440} days before`
    : minutes % 60 === 0 ? `${minutes / 60} hours before` : `${minutes} minutes before`)
  return method === 'email' ? `Email ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text
}

export const RESPONSE_LABELS: Record<'accepted' | 'tentative' | 'declined' | 'needsAction', string> = {
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Not going',
  needsAction: 'Awaiting'
}

/** Google's descriptions mix HTML and plain text. This keeps the words and the links. */
export function descriptionParts(description: string): Array<{ text: string; href: string | null; bold: boolean }> {
  const parts: Array<{ text: string; href: string | null; bold: boolean }> = []
  const decoded = (value: string): string => value
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, '\'')
  const normalized = description
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
  const token = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|<(b|strong)>([\s\S]*?)<\/\3>|(https?:\/\/[^\s<]+)/gi
  let index = 0
  const plain = (text: string): void => {
    const value = decoded(text.replace(/<[^>]+>/g, ''))
    if (value) parts.push({ text: value, href: null, bold: false })
  }
  for (let match = token.exec(normalized); match; match = token.exec(normalized)) {
    plain(normalized.slice(index, match.index))
    if (match[1] !== undefined) {
      const href = decoded(match[1])
      parts.push({ text: decoded(match[2].replace(/<[^>]+>/g, '')) || href, href: /^(https?|mailto|tel):/i.test(href) ? href : null, bold: false })
    } else if (match[4] !== undefined) {
      parts.push({ text: decoded(match[4].replace(/<[^>]+>/g, '')), href: null, bold: true })
    } else if (match[5] !== undefined) {
      parts.push({ text: match[5], href: match[5], bold: false })
    }
    index = match.index + match[0].length
  }
  plain(normalized.slice(index))
  return parts
}

/** The description as plain text for editing, keeping link targets. */
export function descriptionText(description: string | null): string {
  if (!description) return ''
  return descriptionParts(description)
    .map((part) => part.href && part.href !== part.text ? `${part.text} (${part.href})` : part.text)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** What a new event looks like on screen while Google is still making it. */
export function pendingEvent(calendar: Pick<CalendarInfo, 'accountId' | 'id'>, draft: CalendarEventDraft, now = Date.now()): CalendarEvent {
  const id = `pending-${now}`
  return {
    key: calendarEventKey(calendar.accountId, calendar.id, id), accountId: calendar.accountId, calendarId: calendar.id, id,
    recurringEventId: null, originalStart: null, status: 'confirmed', title: draft.title, description: draft.description,
    location: draft.location, colorId: draft.colorId, allDay: draft.allDay, start: draft.start, end: draft.end,
    timeZone: draft.timeZone, htmlLink: null, conference: null, attendees: [], attendeesOmitted: false,
    organizer: { email: null, name: null, self: true }, response: null, guestsCanModify: draft.guestsCanModify,
    guestsCanInviteOthers: draft.guestsCanInviteOthers, guestsCanSeeOtherGuests: draft.guestsCanSeeOtherGuests,
    reminders: draft.reminders, transparency: draft.transparency, visibility: draft.visibility, eventType: 'default',
    attachments: [], etag: '', googleUpdated: '', deleted: false, updatedAt: ''
  }
}

/** Switches between a timed and an all-day event the way Google's checkbox does. */
export function withAllDay(draft: CalendarEventDraft, allDay: boolean): CalendarEventDraft {
  if (draft.allDay === allDay) return draft
  if (allDay) {
    const first = localDayOf(draft.start)
    const last = localDayOf(new Date(Math.max(Date.parse(draft.start), Date.parse(draft.end) - 1)).toISOString())
    return { ...draft, allDay, start: first, end: shiftIso(last, 1), transparency: 'transparent' }
  }
  const start = instantAt(draft.start, 9 * 60)
  return { ...draft, allDay, start, end: new Date(Date.parse(start) + 60 * 60_000).toISOString(), transparency: 'opaque' }
}

/** A new start keeps the event's length, as in Google's editor. */
export function withStart(draft: CalendarEventDraft, start: string): CalendarEventDraft {
  if (draft.allDay) {
    const days = Math.round((parseIso(draft.end).getTime() - parseIso(draft.start).getTime()) / 86_400_000)
    return { ...draft, start, end: shiftIso(start, Math.max(1, days)) }
  }
  const length = Date.parse(draft.end) - Date.parse(draft.start)
  return { ...draft, start, end: new Date(Date.parse(start) + length).toISOString() }
}

/** The last day an all-day draft covers, for an inclusive end field. */
export function lastDayOf(draft: Pick<CalendarEventDraft, 'start' | 'end'>): string {
  return draft.end > draft.start ? shiftIso(draft.end, -1) : draft.start
}

export function draftProblem(draft: CalendarEventDraft): string | null {
  if (draft.allDay ? draft.end <= draft.start : Date.parse(draft.end) <= Date.parse(draft.start)) return 'The event must end after it starts.'
  const guest = draft.attendees.find((person) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email))
  if (guest) return `${guest.email} is not an email address.`
  return null
}
