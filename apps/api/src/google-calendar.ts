import {
  calendarEventKey, calendarKey,
  type CalendarAccessRole, type CalendarAttachment, type CalendarAttendee, type CalendarConference, type CalendarEvent,
  type CalendarEventDraft, type CalendarEventType, type CalendarInfo, type CalendarReminder, type CalendarResponse,
  type CalendarVisibility
} from '@ego/api-contracts'
import { calendarColorOf } from '@ego/core'

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar'

const REQUEST_TIMEOUT_MS = 20000
const PAGE_SIZE = 2500
const MAX_PAGES = 20
/** Google allows up to 8 KB, but imported calendars sometimes paste whole web pages. */
const MAX_DESCRIPTION = 16000

export class GoogleCalendarError extends Error {
  constructor(message: string, readonly status: number, readonly detail: string | null = null) {
    super(message)
  }
}

export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function flag(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

async function errorDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    const error = isRecord(body) && isRecord(body.error) ? body.error : null
    return typeof error?.message === 'string' ? error.message.slice(0, 300) : null
  } catch {
    return null
  }
}

export interface EventPage {
  items: JsonRecord[]
  nextSyncToken: string | null
}

export interface ListEventsOptions {
  syncToken?: string | null
  timeMin?: string
  timeMax?: string
  showDeleted?: boolean
}

export interface WriteOptions {
  etag?: string | null
  sendUpdates?: boolean
  conference?: boolean
}

export interface GoogleCalendarClient {
  timeZone: () => Promise<string | null>
  calendarList: () => Promise<JsonRecord[]>
  listEvents: (calendarId: string, options: ListEventsOptions) => Promise<EventPage>
  instancesBefore: (calendarId: string, eventId: string, before: string) => Promise<number>
  getEvent: (calendarId: string, eventId: string) => Promise<JsonRecord>
  insertEvent: (calendarId: string, body: JsonRecord, options: WriteOptions) => Promise<JsonRecord>
  patchEvent: (calendarId: string, eventId: string, body: JsonRecord, options: WriteOptions) => Promise<JsonRecord>
  moveEvent: (calendarId: string, eventId: string, destination: string) => Promise<JsonRecord>
  deleteEvent: (calendarId: string, eventId: string) => Promise<void>
  patchCalendarListEntry: (calendarId: string, body: JsonRecord) => Promise<JsonRecord>
}

export function googleCalendarClient(accessToken: string): GoogleCalendarClient {
  const request = async (method: string, path: string, params: URLSearchParams | null, body?: JsonRecord, etag?: string | null): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(`${GOOGLE_CALENDAR_API}${path}${params && [...params].length > 0 ? `?${params}` : ''}`, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(etag ? { 'if-match': etag } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      })
    } catch {
      throw new GoogleCalendarError('Google Calendar did not answer', 0)
    } finally {
      clearTimeout(timer)
    }
  }
  const json = async (method: string, path: string, params: URLSearchParams | null, body?: JsonRecord, etag?: string | null): Promise<JsonRecord> => {
    const response = await request(method, path, params, body, etag)
    if (!response.ok) throw new GoogleCalendarError(`Google Calendar answered ${response.status}`, response.status, await errorDetail(response))
    const value: unknown = await response.json().catch(() => null)
    if (!isRecord(value)) throw new GoogleCalendarError('Google Calendar sent something unreadable', 502)
    return value
  }
  const calendarPath = (calendarId: string): string => `/calendars/${encodeURIComponent(calendarId)}`
  const eventPath = (calendarId: string, eventId: string): string => `${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`
  const writeParams = (options: WriteOptions): URLSearchParams => {
    const params = new URLSearchParams({ sendUpdates: options.sendUpdates === false ? 'none' : 'all', supportsAttachments: 'true' })
    if (options.conference) params.set('conferenceDataVersion', '1')
    return params
  }

  return {
    timeZone: async () => {
      const body = await json('GET', '/users/me/settings/timezone', null)
      return text(body.value)
    },
    calendarList: async () => {
      const items: JsonRecord[] = []
      let pageToken: string | null = null
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({ maxResults: '250' })
        if (pageToken) params.set('pageToken', pageToken)
        const body = await json('GET', '/users/me/calendarList', params)
        items.push(...records(body.items))
        pageToken = text(body.nextPageToken)
        if (!pageToken) break
      }
      return items
    },
    listEvents: async (calendarId, options) => {
      const items: JsonRecord[] = []
      let pageToken: string | null = null
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({ singleEvents: 'true', maxResults: String(PAGE_SIZE) })
        if (options.syncToken) params.set('syncToken', options.syncToken)
        else {
          if (options.timeMin) params.set('timeMin', options.timeMin)
          if (options.timeMax) params.set('timeMax', options.timeMax)
          if (options.showDeleted) params.set('showDeleted', 'true')
        }
        if (pageToken) params.set('pageToken', pageToken)
        const body = await json('GET', `${calendarPath(calendarId)}/events`, params)
        items.push(...records(body.items))
        pageToken = text(body.nextPageToken)
        if (!pageToken) return { items, nextSyncToken: text(body.nextSyncToken) }
      }
      throw new GoogleCalendarError('Google Calendar sent too many pages', 502)
    },
    instancesBefore: async (calendarId, eventId, before) => {
      const params = new URLSearchParams({ timeMax: before, showDeleted: 'true', maxResults: String(PAGE_SIZE) })
      const body = await json('GET', `${eventPath(calendarId, eventId)}/instances`, params)
      return records(body.items).length
    },
    getEvent: (calendarId, eventId) => json('GET', eventPath(calendarId, eventId), null),
    insertEvent: (calendarId, body, options) => json('POST', `${calendarPath(calendarId)}/events`, writeParams(options), body),
    patchEvent: (calendarId, eventId, body, options) =>
      json('PATCH', eventPath(calendarId, eventId), writeParams(options), body, options.etag),
    moveEvent: (calendarId, eventId, destination) =>
      json('POST', `${eventPath(calendarId, eventId)}/move`, new URLSearchParams({ destination, sendUpdates: 'all' })),
    deleteEvent: async (calendarId, eventId) => {
      const response = await request('DELETE', eventPath(calendarId, eventId), new URLSearchParams({ sendUpdates: 'all' }))
      if (response.status === 410 || response.status === 404) return
      if (!response.ok) throw new GoogleCalendarError(`Google Calendar answered ${response.status}`, response.status, await errorDetail(response))
    },
    patchCalendarListEntry: (calendarId, body) =>
      json('PATCH', `/users/me/calendarList/${encodeURIComponent(calendarId)}`, null, body)
  }
}

const ACCESS_ROLES: readonly CalendarAccessRole[] = ['owner', 'writer', 'reader', 'freeBusyReader']

function reminders(value: unknown): CalendarReminder[] {
  return records(value).flatMap((item): CalendarReminder[] => {
    const minutes = typeof item.minutes === 'number' ? item.minutes : Number.NaN
    if (!Number.isInteger(minutes) || minutes < 0) return []
    return [{ method: item.method === 'email' ? 'email' : 'popup', minutes }]
  })
}

/** One entry of Google's calendar list, without the columns D1 adds. */
export type CalendarInfoBody = Omit<CalendarInfo, 'deleted' | 'updatedAt'>

export function toCalendarInfo(accountId: string, entry: JsonRecord): CalendarInfoBody | null {
  const id = text(entry.id)
  if (!id) return null
  const role = ACCESS_ROLES.find((item) => item === entry.accessRole) ?? 'reader'
  const conference = isRecord(entry.conferenceProperties) ? entry.conferenceProperties.allowedConferenceSolutionTypes : null
  const colorId = text(entry.colorId)
  return {
    key: calendarKey(accountId, id),
    accountId,
    id,
    name: text(entry.summaryOverride) ?? text(entry.summary) ?? id,
    description: text(entry.description),
    timeZone: text(entry.timeZone),
    accessRole: role,
    primary: flag(entry.primary),
    selected: flag(entry.selected),
    colorId,
    color: calendarColorOf(colorId, text(entry.backgroundColor)),
    defaultReminders: reminders(entry.defaultReminders),
    meet: Array.isArray(conference) && conference.includes('hangoutsMeet')
  }
}

const RESPONSES: readonly CalendarResponse[] = ['needsAction', 'declined', 'tentative', 'accepted']
const EVENT_TYPE_NAMES: readonly CalendarEventType[] = ['default', 'outOfOffice', 'focusTime', 'fromGmail', 'birthday', 'workingLocation']
const VISIBILITIES: readonly CalendarVisibility[] = ['default', 'public', 'private', 'confidential']

function responseOf(value: unknown): CalendarResponse {
  return RESPONSES.find((item) => item === value) ?? 'needsAction'
}

function attendees(value: unknown): CalendarAttendee[] {
  return records(value).flatMap((item): CalendarAttendee[] => {
    const email = text(item.email)
    if (!email) return []
    return [{
      email,
      name: text(item.displayName),
      response: responseOf(item.responseStatus),
      self: flag(item.self),
      organizer: flag(item.organizer),
      optional: flag(item.optional),
      resource: flag(item.resource),
      comment: text(item.comment)
    }]
  })
}

function conference(event: JsonRecord): CalendarConference | null {
  const data = isRecord(event.conferenceData) ? event.conferenceData : null
  const points = records(data?.entryPoints)
  const video = points.find((point) => point.entryPointType === 'video')
  const phone = points.find((point) => point.entryPointType === 'phone')
  const solution = isRecord(data?.conferenceSolution) ? data.conferenceSolution : null
  const url = text(video?.uri) ?? text(event.hangoutLink)
  if (!url && !phone) return null
  return {
    name: text(solution?.name) ?? (text(event.hangoutLink) ? 'Google Meet' : null),
    url,
    phone: text(phone?.label) ?? text(phone?.uri)?.replace(/^tel:/, '') ?? null,
    pin: text(phone?.pin)
  }
}

function attachments(value: unknown): CalendarAttachment[] {
  return records(value).flatMap((item): CalendarAttachment[] => {
    const url = text(item.fileUrl)
    return url ? [{ title: text(item.title) ?? 'Attachment', url, mimeType: text(item.mimeType) }] : []
  })
}

function moment(value: unknown): { allDay: boolean; value: string; timeZone: string | null } | null {
  if (!isRecord(value)) return null
  const date = text(value.date)
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { allDay: true, value: date, timeZone: text(value.timeZone) }
  const dateTime = text(value.dateTime)
  if (!dateTime || !Number.isFinite(Date.parse(dateTime))) return null
  return { allDay: false, value: new Date(dateTime).toISOString(), timeZone: text(value.timeZone) }
}

/** An event as D1 keeps it: everything but the row's own clock and tombstone. */
export type CalendarEventBody = Omit<CalendarEvent, 'deleted' | 'updatedAt'>

/** Null for a cancelled occurrence, a working-location marker, or anything Ego cannot place on a day. */
export function toCalendarEvent(accountId: string, calendarId: string, event: JsonRecord): CalendarEventBody | null {
  const id = text(event.id)
  const start = moment(event.start)
  const end = moment(event.end)
  if (!id || !start || !end || event.status === 'cancelled' || event.eventType === 'workingLocation') return null
  const people = attendees(event.attendees)
  const self = people.find((person) => person.self)
  const organizer = isRecord(event.organizer) ? event.organizer : {}
  const organizerSelf = flag(organizer.self)
  const reminderSettings = isRecord(event.reminders) ? event.reminders : {}
  const original = moment(event.originalStartTime)
  const description = text(event.description)
  return {
    key: calendarEventKey(accountId, calendarId, id),
    accountId,
    calendarId,
    id,
    recurringEventId: text(event.recurringEventId),
    originalStart: original?.value ?? null,
    status: event.status === 'tentative' ? 'tentative' : 'confirmed',
    title: text(event.summary) ?? '',
    description: description && description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION)}…` : description,
    location: text(event.location),
    colorId: text(event.colorId),
    allDay: start.allDay,
    start: start.value,
    end: end.allDay === start.allDay ? end.value : start.value,
    timeZone: start.timeZone,
    htmlLink: text(event.htmlLink),
    conference: conference(event),
    attendees: people,
    attendeesOmitted: flag(event.attendeesOmitted),
    organizer: { email: text(organizer.email), name: text(organizer.displayName), self: organizerSelf },
    response: self && !organizerSelf ? self.response : null,
    guestsCanModify: flag(event.guestsCanModify),
    guestsCanInviteOthers: flag(event.guestsCanInviteOthers, true),
    guestsCanSeeOtherGuests: flag(event.guestsCanSeeOtherGuests, true),
    reminders: { useDefault: flag(reminderSettings.useDefault, true), overrides: reminders(reminderSettings.overrides) },
    transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
    visibility: VISIBILITIES.find((item) => item === event.visibility) ?? 'default',
    eventType: EVENT_TYPE_NAMES.find((item) => item === event.eventType) ?? 'default',
    attachments: attachments(event.attachments),
    etag: text(event.etag) ?? '',
    googleUpdated: text(event.updated) ?? new Date(0).toISOString()
  }
}

/** Where an event sits on the timeline, for range queries. An all-day event spans its days in UTC. */
export function eventSpan(event: Pick<CalendarEventBody, 'allDay' | 'start' | 'end'>): { startsAt: string; endsAt: string } {
  if (!event.allDay) return { startsAt: event.start, endsAt: event.end }
  return { startsAt: `${event.start}T00:00:00.000Z`, endsAt: `${event.end}T00:00:00.000Z` }
}

function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function timeBody(value: string, allDay: boolean, timeZone: string | null): JsonRecord {
  if (allDay) return { date: value.slice(0, 10), dateTime: null }
  return { dateTime: value, date: null, ...(timeZone ? { timeZone } : {}) }
}

/**
 * The Google event body for a change. Only fields in `changes` are sent, so a PATCH leaves the
 * rest alone. A guest list Google left out holds only the account's own row and is never sent.
 */
export function googleEventBody(changes: Partial<CalendarEventDraft>, requestId: () => string): JsonRecord {
  const body: JsonRecord = {}
  if (changes.title !== undefined) body.summary = changes.title
  if (changes.description !== undefined) body.description = changes.description ?? ''
  if (changes.location !== undefined) body.location = changes.location ?? ''
  if (changes.start !== undefined) body.start = timeBody(changes.start, changes.allDay ?? isDay(changes.start), changes.timeZone ?? null)
  if (changes.end !== undefined) body.end = timeBody(changes.end, changes.allDay ?? isDay(changes.end), changes.timeZone ?? null)
  if (changes.recurrence !== undefined) body.recurrence = changes.recurrence
  if (changes.colorId !== undefined) body.colorId = changes.colorId
  if (changes.attendees !== undefined) {
    body.attendees = changes.attendees.map((person) => ({ email: person.email, ...(person.optional ? { optional: true } : {}) }))
  }
  if (changes.meet === true) {
    body.conferenceData = { createRequest: { requestId: requestId(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  } else if (changes.meet === false) {
    body.conferenceData = null
  }
  if (changes.reminders !== undefined) {
    body.reminders = changes.reminders.useDefault
      ? { useDefault: true }
      : { useDefault: false, overrides: changes.reminders.overrides.map((item) => ({ method: item.method, minutes: item.minutes })) }
  }
  if (changes.transparency !== undefined) body.transparency = changes.transparency
  if (changes.visibility !== undefined) body.visibility = changes.visibility
  if (changes.guestsCanModify !== undefined) body.guestsCanModify = changes.guestsCanModify
  if (changes.guestsCanInviteOthers !== undefined) body.guestsCanInviteOthers = changes.guestsCanInviteOthers
  if (changes.guestsCanSeeOtherGuests !== undefined) body.guestsCanSeeOtherGuests = changes.guestsCanSeeOtherGuests
  return body
}

/** Copies what a "this and following" split must keep from the series it leaves. */
export function seriesCopy(master: JsonRecord): JsonRecord {
  const copy: JsonRecord = {}
  for (const field of [
    'summary', 'description', 'location', 'colorId', 'attendees', 'reminders', 'transparency', 'visibility',
    'guestsCanModify', 'guestsCanInviteOthers', 'guestsCanSeeOtherGuests', 'attachments', 'eventType'
  ]) {
    if (master[field] !== undefined) copy[field] = master[field]
  }
  const data = isRecord(master.conferenceData) ? master.conferenceData : null
  if (data && data.conferenceId) {
    copy.conferenceData = {
      conferenceId: data.conferenceId,
      conferenceSolution: data.conferenceSolution,
      entryPoints: data.entryPoints
    }
  }
  return copy
}

/** A new event takes no nulls; only a PATCH needs them, to clear the other kind of time. */
export function forInsert(body: JsonRecord): JsonRecord {
  const clean = (value: unknown): unknown => isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null))
    : value
  return { ...body, start: clean(body.start), end: clean(body.end) }
}
