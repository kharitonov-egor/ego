/** The Worker sends the browser here once Google Calendar access is granted or refused. */
export const CALENDAR_RETURN_URL = 'ego://calendar'

/** The Worker keeps events from this many days back. Older weeks load from Google when opened. */
export const CALENDAR_WINDOW_PAST_DAYS = 92
/** And this many days ahead. */
export const CALENDAR_WINDOW_FUTURE_DAYS = 366

export type CalendarAccessRole = 'owner' | 'writer' | 'reader' | 'freeBusyReader'
export type CalendarResponse = 'needsAction' | 'declined' | 'tentative' | 'accepted'
export type CalendarAnswer = 'accepted' | 'tentative' | 'declined'
export type CalendarEventType = 'default' | 'outOfOffice' | 'focusTime' | 'fromGmail' | 'birthday' | 'workingLocation'
export type CalendarVisibility = 'default' | 'public' | 'private' | 'confidential'
export type CalendarTransparency = 'opaque' | 'transparent'
/** Which events of a series a change applies to: the one opened, it and every later one, or all of them. */
export type CalendarScope = 'one' | 'following' | 'all'

export interface CalendarAccount {
  /** The Google account's email, lowercased. */
  id: string
  connected: boolean
  timeZone: string | null
  lastSyncAt: string | null
  /** The last sync failed with this message. Events already in D1 are still served. */
  lastError: string | null
  /** The days the Worker holds, inclusive. Null until the first sync finishes. */
  windowFrom: string | null
  windowTo: string | null
}

export interface CalendarReminder {
  method: 'popup' | 'email'
  minutes: number
}

export interface CalendarInfo {
  /** `account/calendar`, unique across accounts. */
  key: string
  accountId: string
  id: string
  name: string
  description: string | null
  timeZone: string | null
  accessRole: CalendarAccessRole
  primary: boolean
  /** Ticked in Google Calendar's list, so its events show. */
  selected: boolean
  colorId: string | null
  /** In Google's current palette, or the custom color picked in Google. */
  color: string
  defaultReminders: CalendarReminder[]
  /** Google Meet links can be added to events here. */
  meet: boolean
  deleted: boolean
  updatedAt: string
}

export interface CalendarAttendee {
  email: string
  name: string | null
  response: CalendarResponse
  self: boolean
  organizer: boolean
  optional: boolean
  resource: boolean
  comment: string | null
}

export interface CalendarConference {
  /** "Google Meet", "Zoom Meeting", and so on. */
  name: string | null
  url: string | null
  phone: string | null
  pin: string | null
}

export interface CalendarAttachment {
  title: string
  url: string
  mimeType: string | null
}

export interface CalendarEvent {
  /** `account/calendar/event`, unique across accounts. */
  key: string
  accountId: string
  calendarId: string
  id: string
  /** Set on one occurrence of a repeating event. */
  recurringEventId: string | null
  /** Where Google first placed this occurrence, as an instant or a YYYY-MM-DD day. */
  originalStart: string | null
  status: 'confirmed' | 'tentative'
  title: string
  /** May hold Google's HTML: links, line breaks, bold. */
  description: string | null
  location: string | null
  /** One of Google's 11 event colors. Null uses the calendar's color. */
  colorId: string | null
  allDay: boolean
  /** An ISO instant, or YYYY-MM-DD for an all-day event. */
  start: string
  /** Exclusive: an all-day event on the 3rd ends on the 4th. */
  end: string
  timeZone: string | null
  htmlLink: string | null
  conference: CalendarConference | null
  attendees: CalendarAttendee[]
  /** Google left the guest list out because it is too long. Only the account's own row can change. */
  attendeesOmitted: boolean
  organizer: { email: string | null; name: string | null; self: boolean }
  /** The account's own answer when it is a guest. Null for its own events. */
  response: CalendarResponse | null
  guestsCanModify: boolean
  guestsCanInviteOthers: boolean
  guestsCanSeeOtherGuests: boolean
  reminders: { useDefault: boolean; overrides: CalendarReminder[] }
  transparency: CalendarTransparency
  visibility: CalendarVisibility
  eventType: CalendarEventType
  attachments: CalendarAttachment[]
  etag: string
  /** Google's own last-modified time. */
  googleUpdated: string
  deleted: boolean
  updatedAt: string
}

export interface CalendarSnapshot {
  accounts: CalendarAccount[]
  calendars: CalendarInfo[]
  events: CalendarEvent[]
  /** More changed events are waiting. Ask again with this cursor and the same `since`. */
  cursor: string | null
  /** Send this back as `since` to receive only what changed after this read. */
  serverTime: string
}

export interface CalendarSyncRequest {
  since: string | null
  cursor: string | null
}

export interface CalendarConnectStart {
  authorizationUrl: string
  expiresAt: string
}

/** Everything the editor sets. A new event sends all of it; a change sends only what moved. */
export interface CalendarEventDraft {
  title: string
  description: string | null
  location: string | null
  allDay: boolean
  start: string
  end: string
  /** The zone a repeating timed event keeps its clock time in. */
  timeZone: string | null
  /** RRULE, EXDATE, and RDATE lines. Empty for a one-off. */
  recurrence: string[]
  colorId: string | null
  attendees: Array<{ email: string; optional: boolean }>
  /** Ask Google for a Meet link, or drop the current call when false. Null leaves it alone. */
  meet: boolean | null
  reminders: { useDefault: boolean; overrides: CalendarReminder[] }
  transparency: CalendarTransparency
  visibility: CalendarVisibility
  guestsCanModify: boolean
  guestsCanInviteOthers: boolean
  guestsCanSeeOtherGuests: boolean
}

export interface CalendarEventRef {
  accountId: string
  calendarId: string
  eventId: string
}

export interface CalendarCreateRequest {
  since: string | null
  accountId: string
  calendarId: string
  draft: CalendarEventDraft
}

export interface CalendarUpdateRequest extends CalendarEventRef {
  since: string | null
  /** The version the change was made against. Google refuses it when the event moved on. */
  etag: string | null
  scope: CalendarScope
  changes: Partial<CalendarEventDraft>
  /** Moves the event to another calendar of the same account. */
  targetCalendarId: string | null
}

export interface CalendarDeleteRequest extends CalendarEventRef {
  since: string | null
  scope: CalendarScope
}

export interface CalendarRestoreRequest extends CalendarEventRef {
  since: string | null
}

export interface CalendarRsvpRequest extends CalendarEventRef {
  since: string | null
  answer: CalendarAnswer
  comment: string | null
  scope: 'one' | 'all'
}

export interface CalendarListChange {
  since: string | null
  accountId: string
  calendarId: string
  selected: boolean | null
  colorId: string | null
}

/** The repeating event an occurrence belongs to, read live from Google for the editor. */
export interface CalendarSeries {
  recurrence: string[]
  start: string
  end: string
  allDay: boolean
  timeZone: string | null
}

export interface CalendarRange {
  events: CalendarEvent[]
}

export function calendarKey(accountId: string, calendarId: string): string {
  return `${accountId}/${calendarId}`
}

export function calendarEventKey(accountId: string, calendarId: string, eventId: string): string {
  return `${accountId}/${calendarId}/${eventId}`
}
