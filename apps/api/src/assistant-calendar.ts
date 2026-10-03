import type { ApiResult, CalendarEvent, CalendarEventDraft, CalendarInfo } from '@ego/api-contracts'
import { describeRecurrence } from '@ego/core'
import type { ReadOutcome, ToolContext, WriteCard, WriteOutcome } from './assistant-tools'
import {
  answerCalendarEvent, createCalendarEvent, deleteCalendarEvent, eventOf, readCalendarAccounts, readCalendarInfos, readLiveRange,
  readStoredEvents, updateCalendarEvent, type CalendarWriteResult
} from './calendar'
import { daysBetween, isValidTimeZone, localClock, localDate, shiftDate, startOfLocalDay } from './google-health'

const MAX_DAYS = 62
const MAX_EVENTS = 200
const MAX_PROMPT_CALENDARS = 60
const ANSWER_WORDS: Record<string, string> = { accepted: 'Going', tentative: 'Maybe', declined: 'Not going' }

function zoneOf(ctx: ToolContext): string {
  return ctx.timeZone && isValidTimeZone(ctx.timeZone) ? ctx.timeZone : 'UTC'
}

function instantOn(ctx: ToolContext, date: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(startOfLocalDay(date, zoneOf(ctx)) + (hours * 60 + minutes) * 60_000).toISOString()
}

/** "2026-10-08 15:00" on the user's clock. */
function localStamp(ctx: ToolContext, iso: string): string {
  const clock = localClock(Date.parse(iso), zoneOf(ctx))
  return `${clock.date} ${String(Math.floor(clock.minute / 60)).padStart(2, '0')}:${String(clock.minute % 60).padStart(2, '0')}`
}

function clock(ctx: ToolContext, iso: string): string {
  const minute = localClock(Date.parse(iso), zoneOf(ctx)).minute
  const hours = Math.floor(minute / 60)
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minute % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

function shortDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "Thu, Oct 8, 3:00 PM to 4:00 PM", or the days of an all-day event. */
function whenText(ctx: ToolContext, times: Pick<CalendarEvent, 'allDay' | 'start' | 'end'>): string {
  if (times.allDay) {
    const last = shiftDate(times.end, -1)
    return last > times.start ? `${shortDay(times.start)} to ${shortDay(last)}, all day` : `${shortDay(times.start)}, all day`
  }
  const startDay = localDate(Date.parse(times.start), zoneOf(ctx))
  const endDay = localDate(Date.parse(times.end), zoneOf(ctx))
  return startDay === endDay
    ? `${shortDay(startDay)}, ${clock(ctx, times.start)} to ${clock(ctx, times.end)}`
    : `${shortDay(startDay)} ${clock(ctx, times.start)} to ${shortDay(endDay)} ${clock(ctx, times.end)}`
}

function splitKey(key: string): { accountId: string; calendarId: string; eventId: string } | null {
  const parts = key.split('/')
  if (parts.length < 3) return null
  return { accountId: parts[0], calendarId: parts.slice(1, -1).join('/'), eventId: parts[parts.length - 1] }
}

async function storedEvent(ctx: ToolContext, key: string): Promise<CalendarEvent> {
  const ref = splitKey(key)
  const row = ref ? await ctx.env.DB.prepare(`SELECT event, updated_at, deleted_at FROM calendar_events
    WHERE dataset_id = ? AND account_id = ? AND calendar_id = ? AND id = ? AND deleted_at IS NULL`)
    .bind(ctx.device.datasetId, ref.accountId, ref.calendarId, ref.eventId).first<{ event: string; updated_at: string; deleted_at: string | null }>() : null
  const event = row ? eventOf(row) : null
  if (!event) throw new Error('That event is not on the calendar. Use a key from read_calendar.')
  return event
}

function calendarName(infos: readonly CalendarInfo[], event: Pick<CalendarEvent, 'accountId' | 'calendarId'>): string {
  return infos.find((info) => info.accountId === event.accountId && info.id === event.calendarId)?.name ?? event.calendarId
}

function settled(result: ApiResult<CalendarWriteResult>): CalendarWriteResult {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

export async function calendarPromptLine(ctx: ToolContext): Promise<string> {
  const [accounts, infos] = await Promise.all([readCalendarAccounts(ctx.env, ctx.device.datasetId), readCalendarInfos(ctx.env, ctx.device.datasetId)])
  if (accounts.length === 0) return 'Google Calendar is not connected. If the user asks about their calendar, tell them to connect it in the Calendar app.'
  const list = infos.slice(0, MAX_PROMPT_CALENDARS).map((info) => ({
    id: info.key, name: info.name, account: info.accountId, primary: info.primary || undefined,
    canAdd: info.accessRole === 'owner' || info.accessRole === 'writer', shown: info.selected
  }))
  return `Google Calendar, across the user's accounts: ${JSON.stringify(list)}. read_calendar lists events with their keys; read an event before changing, deleting, or answering it. New events go to the primary calendar unless the user names another. Times are the user's local clock. Changes reach Google at once and guests get Google's emails.`
}

export async function readCalendar(ctx: ToolContext, args: Record<string, unknown>): Promise<ReadOutcome> {
  const from = String(args.from)
  const to = String(args.to)
  if (from > to) throw new Error('from must not be after to')
  if (daysBetween(from, to) + 1 > MAX_DAYS) throw new Error(`Ask for at most ${MAX_DAYS} days at a time`)
  const zone = zoneOf(ctx)
  const [accounts, infos] = await Promise.all([readCalendarAccounts(ctx.env, ctx.device.datasetId), readCalendarInfos(ctx.env, ctx.device.datasetId)])
  if (accounts.length === 0) throw new Error('Google Calendar is not connected. The user can connect it in the Calendar app.')
  const windows = accounts.filter((account) => account.windowFrom && account.windowTo)
  const stored = windows.length > 0 && windows.every((account) => (account.windowFrom ?? '') <= from && (account.windowTo ?? '') >= to)
  let events: CalendarEvent[]
  if (stored) {
    events = await readStoredEvents(ctx.env, ctx.device.datasetId,
      new Date(startOfLocalDay(from, zone)).toISOString(), new Date(startOfLocalDay(shiftDate(to, 1), zone)).toISOString())
  } else {
    const live = await readLiveRange(ctx.env, ctx.device.datasetId, from, to)
    if (!live.ok) throw new Error(live.error.message)
    events = live.data.events.filter((event) => {
      const startDay = event.allDay ? event.start : localDate(Date.parse(event.start), zone)
      const endDay = event.allDay ? shiftDate(event.end, -1) : localDate(Date.parse(event.end) - 1, zone)
      return startDay <= to && endDay >= from
    })
  }
  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  const matching = (query
    ? events.filter((event) => [event.title, event.location ?? '', event.description ?? ''].some((text) => text.toLowerCase().includes(query)))
    : events).sort((left, right) => left.start.localeCompare(right.start))
  return {
    data: {
      events: matching.slice(0, MAX_EVENTS).map((event) => ({
        key: event.key,
        title: event.title || '(No title)',
        start: event.allDay ? event.start : localStamp(ctx, event.start),
        end: event.allDay ? shiftDate(event.end, -1) : localStamp(ctx, event.end),
        allDay: event.allDay,
        calendar: calendarName(infos, event),
        location: event.location ?? undefined,
        repeats: event.recurringEventId !== null || undefined,
        guests: event.attendees.length || undefined,
        yourAnswer: event.response ?? undefined,
        organizer: event.organizer.self ? undefined : event.organizer.email ?? undefined,
        videoCall: event.conference?.url ?? undefined
      })),
      cutShort: matching.length > MAX_EVENTS || undefined
    },
    trail: `Read the calendar for ${from === to ? shortDay(from) : `${shortDay(from)} to ${shortDay(to)}`}`
  }
}

interface AddArgs {
  calendarId: string | null
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  endDate: string | null
  location: string | null
  description: string | null
  guests: string[] | null
  meet: boolean | null
  repeat: string | null
}

function addTimes(ctx: ToolContext, args: AddArgs): Pick<CalendarEventDraft, 'allDay' | 'start' | 'end'> {
  if (!args.startTime) {
    const last = args.endDate && args.endDate > args.date ? args.endDate : args.date
    return { allDay: true, start: args.date, end: shiftDate(last, 1) }
  }
  const start = instantOn(ctx, args.date, args.startTime)
  let end = args.endTime ? instantOn(ctx, args.endDate ?? args.date, args.endTime) : new Date(Date.parse(start) + 3_600_000).toISOString()
  if (Date.parse(end) <= Date.parse(start) && args.endTime && !args.endDate) end = instantOn(ctx, shiftDate(args.date, 1), args.endTime)
  if (Date.parse(end) <= Date.parse(start)) throw new Error('The event must end after it starts')
  return { allDay: false, start, end }
}

async function targetCalendar(ctx: ToolContext, calendarId: string | null): Promise<CalendarInfo> {
  const infos = await readCalendarInfos(ctx.env, ctx.device.datasetId)
  const writable = infos.filter((info) => info.accessRole === 'owner' || info.accessRole === 'writer')
  const found = calendarId ? writable.find((info) => info.key === calendarId || info.id === calendarId) : writable.find((info) => info.primary) ?? writable[0]
  if (!found) throw new Error(calendarId ? 'The user cannot add events to that calendar. Pick one with canAdd.' : 'No calendar the user can add events to is connected.')
  return found
}

export async function addCalendarEvent(ctx: ToolContext, args: Record<string, unknown>): Promise<WriteOutcome> {
  const input = args as unknown as AddArgs
  const calendar = await targetCalendar(ctx, input.calendarId)
  if (input.repeat && !input.repeat.startsWith('RRULE:')) throw new Error('repeat must start with RRULE:')
  const times = addTimes(ctx, input)
  const draft: CalendarEventDraft = {
    title: input.title.trim(), description: input.description?.trim() || null, location: input.location?.trim() || null,
    ...times, timeZone: zoneOf(ctx), recurrence: input.repeat ? [input.repeat] : [], colorId: null,
    attendees: (input.guests ?? []).map((email) => ({ email: email.trim(), optional: false })), meet: input.meet === true ? true : null,
    reminders: { useDefault: true, overrides: [] }, transparency: times.allDay ? 'transparent' : 'opaque', visibility: 'default',
    guestsCanModify: false, guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true
  }
  const result = settled(await createCalendarEvent(ctx.env, ctx.device.datasetId, { accountId: calendar.accountId, calendarId: calendar.id, draft }))
  const created = result.events[0]
  return {
    data: { added: true, key: created?.key ?? null, title: draft.title, when: whenText(ctx, times), calendar: calendar.name, videoCall: created?.conference?.url ?? undefined },
    trail: `Added "${draft.title}" to ${calendar.name}`,
    failed: false
  }
}

interface UpdateArgs {
  eventKey: string
  title: string | null
  date: string | null
  startTime: string | null
  endTime: string | null
  location: string | null
  description: string | null
  allEvents: boolean | null
}

function updatedTimes(ctx: ToolContext, event: CalendarEvent, args: UpdateArgs): Pick<CalendarEventDraft, 'allDay' | 'start' | 'end'> | null {
  if (!args.date && !args.startTime && !args.endTime) return null
  const zone = zoneOf(ctx)
  if (event.allDay && !args.startTime) {
    const days = args.date ? daysBetween(event.start, args.date) : 0
    return { allDay: true, start: shiftDate(event.start, days), end: shiftDate(event.end, days) }
  }
  const day = args.date ?? (event.allDay ? event.start : localDate(Date.parse(event.start), zone))
  const startClock = args.startTime ?? (() => {
    const minute = localClock(Date.parse(event.start), zone).minute
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  })()
  const start = instantOn(ctx, day, startClock)
  const length = event.allDay ? 3_600_000 : Date.parse(event.end) - Date.parse(event.start)
  let end = args.endTime ? instantOn(ctx, day, args.endTime) : new Date(Date.parse(start) + length).toISOString()
  if (Date.parse(end) <= Date.parse(start)) end = new Date(Date.parse(start) + length).toISOString()
  return { allDay: false, start, end }
}

function updateChanges(ctx: ToolContext, event: CalendarEvent, args: UpdateArgs): Partial<CalendarEventDraft> {
  const changes: Partial<CalendarEventDraft> = {}
  if (args.title) changes.title = args.title.trim()
  if (args.location !== null) changes.location = args.location.trim() || null
  if (args.description !== null) changes.description = args.description.trim() || null
  const times = updatedTimes(ctx, event, args)
  if (times) Object.assign(changes, times, { timeZone: event.timeZone ?? zoneOf(ctx) })
  return changes
}

function timesAfter(event: CalendarEvent, changes: Partial<CalendarEventDraft>): Pick<CalendarEvent, 'allDay' | 'start' | 'end'> {
  return { allDay: changes.allDay ?? event.allDay, start: changes.start ?? event.start, end: changes.end ?? event.end }
}

export async function updateCalendarEventTool(ctx: ToolContext, args: Record<string, unknown>): Promise<WriteOutcome> {
  const input = args as unknown as UpdateArgs
  const event = await storedEvent(ctx, input.eventKey)
  const changes = updateChanges(ctx, event, input)
  if (Object.keys(changes).length === 0) throw new Error('Nothing to change')
  const scope = input.allEvents && event.recurringEventId ? 'all' : 'one'
  settled(await updateCalendarEvent(ctx.env, ctx.device.datasetId, {
    accountId: event.accountId, calendarId: event.calendarId, eventId: event.id, etag: null, scope, changes, targetCalendarId: null
  }))
  return {
    data: { updated: true, key: event.key, title: changes.title ?? event.title, when: changes.start ? whenText(ctx, timesAfter(event, changes)) : undefined },
    trail: `Changed "${changes.title ?? event.title}"`,
    failed: false
  }
}

export async function deleteCalendarEventTool(ctx: ToolContext, args: Record<string, unknown>): Promise<WriteOutcome> {
  const event = await storedEvent(ctx, String(args.eventKey))
  const scope = args.allEvents === true && event.recurringEventId ? 'all' : 'one'
  settled(await deleteCalendarEvent(ctx.env, ctx.device.datasetId, { accountId: event.accountId, calendarId: event.calendarId, eventId: event.id, scope }))
  return { data: { deleted: true, title: event.title }, trail: `Deleted "${event.title}"`, failed: false }
}

export async function answerCalendarEventTool(ctx: ToolContext, args: Record<string, unknown>): Promise<WriteOutcome> {
  const event = await storedEvent(ctx, String(args.eventKey))
  if (event.response === null) throw new Error('The user is not a guest of that event, so there is nothing to answer.')
  const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : null
  settled(await answerCalendarEvent(ctx.env, ctx.device.datasetId, {
    accountId: event.accountId, calendarId: event.calendarId, eventId: event.id, answer: args.answer, comment: note,
    scope: args.allEvents === true ? 'all' : 'one'
  }))
  const word = ANSWER_WORDS[String(args.answer)] ?? 'Answered'
  return { data: { answered: String(args.answer), title: event.title }, trail: `${word}: "${event.title}"`, failed: false }
}

/** The card for a calendar write, with names and times in place of keys. */
export async function describeCalendarWrite(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<WriteCard> {
  if (name === 'add_calendar_event') {
    const input = args as unknown as AddArgs
    const calendar = await targetCalendar(ctx, input.calendarId).catch(() => null)
    const times = addTimes(ctx, input)
    const lines = [`"${input.title.trim()}"`, whenText(ctx, times), `In ${calendar?.name ?? 'an unknown calendar'}`]
    if (input.location?.trim()) lines.push(input.location.trim())
    if (input.guests && input.guests.length > 0) lines.push(`Invite ${input.guests.join(', ')}`)
    if (input.meet) lines.push('With a Google Meet link')
    if (input.repeat) lines.push(describeRecurrence([input.repeat], times.allDay ? times.start : localDate(Date.parse(times.start), zoneOf(ctx)), zoneOf(ctx)) ?? 'Repeats')
    return { title: 'Add an event', lines }
  }
  const event = await storedEvent(ctx, String(args.eventKey)).catch(() => null)
  if (!event) return { title: 'Change an event', lines: ['An event that is no longer on the calendar'] }
  const lines = [`"${event.title || '(No title)'}"`, whenText(ctx, event)]
  const every = args.allEvents === true && event.recurringEventId !== null
  if (name === 'update_calendar_event') {
    const input = args as unknown as UpdateArgs
    const changes = updateChanges(ctx, event, input)
    if (changes.title) lines.push(`Rename to "${changes.title}"`)
    if (changes.start) lines.push(`Move to ${whenText(ctx, timesAfter(event, changes))}`)
    if (changes.location !== undefined) lines.push(changes.location ? `Location: ${changes.location}` : 'Remove the location')
    if (changes.description !== undefined) lines.push(changes.description ? 'New description' : 'Remove the description')
    if (every) lines.push('Every occurrence')
    return { title: 'Change an event', lines }
  }
  if (name === 'delete_calendar_event') {
    if (every) lines.push('Every occurrence')
    if (event.attendees.length > 0) lines.push('Guests are told')
    return { title: 'Delete an event', lines }
  }
  lines.push(ANSWER_WORDS[String(args.answer)] ?? 'Answer')
  if (typeof args.note === 'string' && args.note.trim()) lines.push(`"${args.note.trim()}"`)
  if (every) lines.push('Every occurrence')
  return { title: 'Answer an invitation', lines }
}
