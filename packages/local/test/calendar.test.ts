import { describe, expect, it } from 'vitest'
import type { ApiResult, CalendarEvent, CalendarInfo, CalendarSnapshot } from '@ego/api-contracts'
import type { CalendarApi } from '../src/api-client'
import { blankDraft, descriptionParts, descriptionText, draftChanges, draftFrom, permissionsFor } from '../src/calendar/draft'
import {
  eventDays, instantAt, layoutDay, layoutSpans, monthWeeks, moveEventTo, rangeLabel, resizeEvent, scheduleDays, shiftEvent,
  stepAnchor, timeRangeLabel, visibleDays, weekStartOf
} from '../src/calendar/layout'
import { applyCalendarAnswer, cachedCalendarMeta, cachedEvents, freshNextCalendarEvent, nextCalendarEvent, refreshCalendar } from '../src/calendar/store'
import { openTestLedger } from './local-db'

const ACCOUNT = 'me@example.com'

function at(day: string, hours: number, minutes = 0): string {
  return instantAt(day, hours * 60 + minutes)
}

function event(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    key: `${ACCOUNT}/${ACCOUNT}/${id}`, accountId: ACCOUNT, calendarId: ACCOUNT, id, recurringEventId: null, originalStart: null,
    status: 'confirmed', title: id, description: null, location: null, colorId: null, allDay: false,
    start: at('2026-10-05', 9), end: at('2026-10-05', 10), timeZone: null, htmlLink: null, conference: null, attendees: [],
    attendeesOmitted: false, organizer: { email: ACCOUNT, name: null, self: true }, response: null, guestsCanModify: false,
    guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true, reminders: { useDefault: true, overrides: [] },
    transparency: 'opaque', visibility: 'default', eventType: 'default', attachments: [], etag: '"1"',
    googleUpdated: '2026-10-01T00:00:00.000Z', deleted: false, updatedAt: '2026-10-02T00:00:00.000Z', ...overrides
  }
}

function calendar(id: string, overrides: Partial<CalendarInfo> = {}): CalendarInfo {
  return {
    key: `${ACCOUNT}/${id}`, accountId: ACCOUNT, id, name: id, description: null, timeZone: null, accessRole: 'owner',
    primary: id === ACCOUNT, selected: true, colorId: '14', color: '#039be5', defaultReminders: [{ method: 'popup', minutes: 10 }],
    meet: true, deleted: false, updatedAt: '2026-10-02T00:00:00.000Z', ...overrides
  }
}

function snapshot(overrides: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
  return {
    accounts: [{ id: ACCOUNT, connected: true, timeZone: 'America/New_York', lastSyncAt: null, lastError: null, windowFrom: '2026-07-01', windowTo: '2027-10-01' }],
    calendars: [calendar(ACCOUNT)], events: [], cursor: null, serverTime: '2026-10-02T12:00:00.000Z', ...overrides
  }
}

function fakeApi(pages: Array<ApiResult<CalendarSnapshot>>): Pick<CalendarApi, 'calendarData' | 'calendarSync'> & { calls: Array<[string, string | null, string | null]> } {
  const calls: Array<[string, string | null, string | null]> = []
  return {
    calls,
    calendarSync: async (since, cursor) => { calls.push(['sync', since, cursor]); return pages.shift() ?? { ok: true, data: snapshot() } },
    calendarData: async (since, cursor) => { calls.push(['data', since, cursor]); return pages.shift() ?? { ok: true, data: snapshot() } }
  }
}

describe('calendar pages', () => {
  it('opens weeks on Monday and steps each view by its own length', () => {
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28')
    expect(visibleDays('week', '2026-10-07')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    expect(visibleDays('3day', '2026-10-30')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
    expect(stepAnchor('month', '2026-01-31', 1)).toBe('2026-02-01')
    expect(stepAnchor('week', '2026-10-07', -1)).toBe('2026-09-28')
    expect(monthWeeks('2026-10-15')).toHaveLength(5)
    expect(monthWeeks('2026-10-15')[0][0]).toBe('2026-09-28')
    expect(rangeLabel('week', '2026-10-01')).toBe('Sep – Oct 2026')
    expect(rangeLabel('week', '2026-10-07')).toBe('October 2026')
    expect(rangeLabel('month', '2026-10-07')).toBe('October 2026')
  })
})

describe('calendar layout', () => {
  it('shares the width between overlapping events and widens a block beside free columns', () => {
    const day = '2026-10-05'
    const placed = layoutDay([
      event('long', { start: at(day, 9), end: at(day, 12) }),
      event('a', { start: at(day, 9, 30), end: at(day, 10) }),
      event('b', { start: at(day, 10), end: at(day, 11) }),
      event('c', { start: at(day, 9, 45), end: at(day, 10, 30) }),
      event('alone', { start: at(day, 14), end: at(day, 15) })
    ], day)
    const byId = new Map(placed.map((item) => [item.event.id, item]))
    expect(byId.get('long')).toMatchObject({ top: 540, bottom: 720, column: 0, columns: 3 })
    expect(byId.get('a')).toMatchObject({ column: 1, columns: 3, span: 1 })
    expect(byId.get('c')).toMatchObject({ column: 2 })
    expect(byId.get('b')).toMatchObject({ column: 1, span: 1 })
    expect(byId.get('alone')).toMatchObject({ column: 0, columns: 1, span: 1 })
  })

  it('clips an overnight event to each day it crosses', () => {
    const overnight = event('night', { start: at('2026-10-05', 22), end: at('2026-10-06', 2) })
    expect(layoutDay([overnight], '2026-10-05')[0]).toMatchObject({ top: 1320, bottom: 1440, endsAfter: true })
    expect(layoutDay([overnight], '2026-10-06')[0]).toMatchObject({ top: 0, bottom: 120, startsBefore: true })
  })

  it('stacks all-day and day-long events into lanes', () => {
    const days = visibleDays('week', '2026-10-05')
    const { items, lanes } = layoutSpans([
      event('trip', { allDay: true, start: '2026-10-04', end: '2026-10-08' }),
      event('holiday', { allDay: true, start: '2026-10-06', end: '2026-10-07' }),
      event('conference', { start: at('2026-10-08', 9), end: at('2026-10-10', 17) }),
      event('meeting')
    ], days)
    expect(lanes).toBe(2)
    expect(items.map((item) => [item.event.id, item.startIndex, item.endIndex, item.lane, item.continuesBefore])).toEqual([
      ['trip', 0, 2, 0, true], ['holiday', 1, 1, 1, false], ['conference', 3, 5, 0, false]
    ])
    expect(eventDays(event('x', { allDay: true, start: '2026-10-05', end: '2026-10-06' }))).toEqual({ first: '2026-10-05', last: '2026-10-05' })
  })

  it('lists every day an event covers in the schedule', () => {
    const groups = scheduleDays([event('trip', { allDay: true, start: '2026-10-05', end: '2026-10-07' }), event('meeting')], visibleDays('schedule', '2026-10-05'))
    expect(groups.map((group) => [group.day, group.events.map((item) => item.id)])).toEqual([
      ['2026-10-05', ['trip', 'meeting']], ['2026-10-06', ['trip']]
    ])
  })

  it('moves and stretches events by whole snaps', () => {
    const meeting = event('m')
    expect(shiftEvent(meeting, 1, 30)).toEqual({ allDay: false, start: at('2026-10-06', 9, 30), end: at('2026-10-06', 10, 30) })
    expect(shiftEvent(event('d', { allDay: true, start: '2026-10-05', end: '2026-10-06' }), 2, 0)).toEqual({ allDay: true, start: '2026-10-07', end: '2026-10-08' })
    expect(moveEventTo(meeting, '2026-10-07', 14 * 60)).toEqual({ allDay: false, start: at('2026-10-07', 14), end: at('2026-10-07', 15) })
    expect(resizeEvent(meeting, 9 * 60, '2026-10-05').end).toBe(at('2026-10-05', 9, 15))
    expect(timeRangeLabel({ start: at('2026-10-05', 9), end: at('2026-10-05', 10, 30) })).toBe('9 – 10:30 AM')
    expect(timeRangeLabel({ start: at('2026-10-05', 11), end: at('2026-10-05', 13) })).toBe('11 AM – 1 PM')
  })
})

describe('calendar drafts', () => {
  it('sends only what the editor changed, with the times together', () => {
    const original = event('m', { colorId: '3', attendees: [{ email: 'a@example.com', name: null, response: 'accepted', self: false, organizer: false, optional: false, resource: false, comment: null }] })
    const before = draftFrom(original)
    expect(draftChanges(before, { ...before, title: 'Renamed' })).toEqual({ title: 'Renamed' })
    const moved = draftChanges(before, { ...before, end: at('2026-10-05', 11) })
    expect(Object.keys(moved).sort()).toEqual(['allDay', 'end', 'start', 'timeZone'])
    expect(draftChanges(before, { ...before, meet: true })).toEqual({ meet: true })
    expect(blankDraft(calendar(ACCOUNT), { allDay: true, start: '2026-10-05', end: '2026-10-06' })).toMatchObject({
      reminders: { useDefault: true }, transparency: 'transparent'
    })
  })

  it('lets a guest answer but not edit unless the organizer allows it', () => {
    const invite = event('i', { response: 'needsAction', organizer: { email: 'boss@example.com', name: null, self: false } })
    expect(permissionsFor(invite, calendar(ACCOUNT))).toMatchObject({ edit: false, respond: true, reason: 'Only the organizer can change this event.' })
    expect(permissionsFor({ ...invite, guestsCanModify: true }, calendar(ACCOUNT)).edit).toBe(true)
    expect(permissionsFor(event('h'), calendar('holidays', { accessRole: 'reader' }))).toMatchObject({ edit: false, respond: false })
  })

  it('keeps the words and links of an HTML description', () => {
    const html = 'Join <a href="https://zoom.us/j/1">here</a><br>Bring <b>notes</b> &amp; snacks https://example.com/x'
    expect(descriptionParts(html)).toEqual([
      { text: 'Join ', href: null, bold: false },
      { text: 'here', href: 'https://zoom.us/j/1', bold: false },
      { text: '\nBring ', href: null, bold: false },
      { text: 'notes', href: null, bold: true },
      { text: ' & snacks ', href: null, bold: false },
      { text: 'https://example.com/x', href: 'https://example.com/x', bold: false }
    ])
    expect(descriptionText(html)).toBe('Join here (https://zoom.us/j/1)\nBring notes & snacks https://example.com/x')
  })
})

describe('calendar store', () => {
  it('follows the cursor and keeps the Worker\'s clock only once the read is whole', async () => {
    const db = await openTestLedger()
    const api = fakeApi([
      { ok: true, data: snapshot({ events: [event('a')], cursor: 'page-2' }) },
      { ok: true, data: snapshot({ calendars: [], events: [event('b', { start: at('2026-10-06', 9), end: at('2026-10-06', 10) })] }) }
    ])
    const result = await refreshCalendar(db, api, { sync: true, now: '2026-10-02T12:00:00.000Z' })
    expect(result.ok).toBe(true)
    expect(api.calls).toEqual([['sync', null, null], ['data', null, 'page-2']])
    const meta = await cachedCalendarMeta(db)
    expect(meta.serverTime).toBe('2026-10-02T12:00:00.000Z')
    expect(meta.calendars.map((item) => item.name)).toEqual([ACCOUNT])
    const week = await cachedEvents(db, at('2026-10-05', 0), at('2026-10-12', 0))
    expect(week.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('applies a write\'s answer and drops deleted events', async () => {
    const db = await openTestLedger()
    await refreshCalendar(db, fakeApi([{ ok: true, data: snapshot({ events: [event('a'), event('b')] }) }]), { sync: false, now: '2026-10-02T12:00:00.000Z' })
    await applyCalendarAnswer(db, snapshot({ calendars: [], events: [{ ...event('a'), deleted: true }, event('b', { title: 'Moved' })], serverTime: '2026-10-02T12:05:00.000Z' }), '2026-10-02T12:05:00.000Z')
    const events = await cachedEvents(db, at('2026-10-05', 0), at('2026-10-06', 0))
    expect(events.map((item) => [item.id, item.title])).toEqual([['b', 'Moved']])
    expect((await cachedCalendarMeta(db)).serverTime).toBe('2026-10-02T12:05:00.000Z')
  })

  it('finds the next event on a ticked calendar that was not declined', async () => {
    const db = await openTestLedger()
    await refreshCalendar(db, fakeApi([{
      ok: true,
      data: snapshot({
        calendars: [calendar(ACCOUNT), calendar('hidden', { selected: false })],
        events: [
          event('past', { start: at('2026-10-05', 7), end: at('2026-10-05', 8) }),
          event('declined', { start: at('2026-10-05', 9), response: 'declined' }),
          event('off', { calendarId: 'hidden', key: `${ACCOUNT}/hidden/off`, start: at('2026-10-05', 9, 30) }),
          event('next', { start: at('2026-10-05', 11), end: at('2026-10-05', 12) })
        ]
      })
    }]), { sync: false, now: '2026-10-05T12:00:00.000Z' })
    const next = await nextCalendarEvent(db, at('2026-10-05', 8, 30))
    expect(next?.event.id).toBe('next')
  })
})

describe('next event on the start screen', () => {
  it('reads the Worker first when the copy is stale, and keeps the copy when that fails', async () => {
    const db = await openTestLedger()
    await refreshCalendar(db, fakeApi([{ ok: true, data: snapshot({ events: [event('old', { start: at('2026-10-05', 11), end: at('2026-10-05', 12) })] }) }]), { sync: false, now: '2026-10-05T00:00:00.000Z' })
    const api = fakeApi([{ ok: true, data: snapshot({ calendars: [], events: [event('new', { start: at('2026-10-05', 10), end: at('2026-10-05', 11) })], serverTime: '2026-10-05T13:00:00.000Z' }) }])
    const found = await freshNextCalendarEvent(db, api, new Date(at('2026-10-05', 9)))
    expect(api.calls).toEqual([['data', '2026-10-02T12:00:00.000Z', null]])
    expect(found?.event.id).toBe('new')
    const offline = fakeApi([{ ok: false, error: { code: 'OFFLINE', message: 'No' } }])
    expect((await freshNextCalendarEvent(db, offline, new Date(at('2026-10-05', 9, 30))))?.event.id).toBe('new')
  })
})
