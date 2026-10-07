// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult, CalendarConnectStart, CalendarEvent, CalendarInfo, CalendarSnapshot, CalendarUpdateRequest } from '@ego/api-contracts'
import type { CalendarApi } from '@ego/local/api-client'
import type { LocalDatabase } from '@ego/local/database/types'
import { instantAt } from '@ego/local/calendar/layout'
import type { CalendarMeta } from '@ego/local/calendar/store'
import { isoToday, shiftIso } from '@ego/local/dates'
import { BlurProvider } from '../../lib/blur'
import CalendarScreen from './Calendar'

const ledger = vi.hoisted(() => ({ value: null as null | { db: LocalDatabase; api: Partial<CalendarApi>; enabled: boolean } }))
vi.mock('../../lib/ledger', () => ({ useLedger: () => ledger.value }))

/** The SQLite copy, kept in memory: jsdom cannot load node:sqlite, and the store has its own tests. */
const copy = vi.hoisted(() => ({
  meta: { accounts: [], calendars: [], serverTime: null, fetchedAt: null } as CalendarMeta,
  events: new Map<string, CalendarEvent>()
}))
vi.mock('@ego/local/calendar/store', () => {
  const apply = (snapshot: CalendarSnapshot): void => {
    const calendars = new Map(copy.meta.calendars.map((calendar) => [calendar.key, calendar]))
    for (const calendar of snapshot.calendars) calendars.set(calendar.key, calendar)
    copy.meta = { accounts: snapshot.accounts, calendars: [...calendars.values()], serverTime: snapshot.serverTime, fetchedAt: new Date().toISOString() }
    for (const event of snapshot.events) {
      if (event.deleted) copy.events.delete(event.key)
      else copy.events.set(event.key, event)
    }
  }
  return {
    cachedCalendarMeta: async () => copy.meta,
    cachedEvents: async () => [...copy.events.values()],
    refreshCalendar: async (_db: LocalDatabase, api: Pick<CalendarApi, 'calendarData' | 'calendarSync'>, options: { sync: boolean }) => {
      const result = options.sync ? await api.calendarSync(copy.meta.serverTime, null) : await api.calendarData(copy.meta.serverTime, null)
      if (!result.ok) return result
      apply(result.data)
      return { ok: true, data: result.data.accounts }
    },
    applyCalendarAnswer: async (_db: LocalDatabase, snapshot: CalendarSnapshot) => apply(snapshot),
    nextCalendarEvent: async () => null
  }
})

const ACCOUNT = 'me@example.com'
const BOX = { left: 0, top: 0, right: 700, bottom: 1152, width: 700, height: 1152, x: 0, y: 0, toJSON: () => ({}) }

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function monday(): string {
  const today = isoToday()
  const weekday = (new Date(`${today}T12:00:00`).getDay() + 6) % 7
  return shiftIso(today, -weekday)
}

function event(id: string, day: string, hour: number): CalendarEvent {
  return {
    key: `${ACCOUNT}/${ACCOUNT}/${id}`, accountId: ACCOUNT, calendarId: ACCOUNT, id, recurringEventId: null, originalStart: null,
    status: 'confirmed', title: id, description: null, location: null, colorId: null, allDay: false,
    start: instantAt(day, hour * 60), end: instantAt(day, hour * 60 + 60), timeZone: 'America/New_York', htmlLink: null, conference: null,
    attendees: [], attendeesOmitted: false, organizer: { email: ACCOUNT, name: null, self: true }, response: null, guestsCanModify: false,
    guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true, reminders: { useDefault: true, overrides: [] },
    transparency: 'opaque', visibility: 'default', eventType: 'default', attachments: [], etag: '"1"',
    googleUpdated: '2026-10-01T00:00:00.000Z', deleted: false, updatedAt: '2026-10-02T00:00:00.000Z'
  }
}

const PRIMARY: CalendarInfo = {
  key: `${ACCOUNT}/${ACCOUNT}`, accountId: ACCOUNT, id: ACCOUNT, name: 'Personal', description: null, timeZone: null,
  accessRole: 'owner', primary: true, selected: true, colorId: '14', color: '#039be5', defaultReminders: [],
  meet: true, deleted: false, updatedAt: '2026-10-02T00:00:00.000Z'
}

function snapshot(events: CalendarEvent[], calendars: CalendarInfo[] = [PRIMARY]): CalendarSnapshot {
  return {
    accounts: [{ id: ACCOUNT, connected: true, timeZone: 'America/New_York', lastSyncAt: null, lastError: null, windowFrom: '2000-01-01', windowTo: '2100-01-01' }],
    calendars, events, cursor: null, serverTime: new Date().toISOString()
  }
}

beforeEach(async () => {
  vi.stubGlobal('ResizeObserver', NoResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX as DOMRect)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preferenceGet: vi.fn(async () => null), preferenceSet: vi.fn(async () => undefined), openExternalUrl: vi.fn(async () => undefined) }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(api: Partial<CalendarApi>): Promise<void> {
  copy.meta = { accounts: [], calendars: [], serverTime: null, fetchedAt: null }
  copy.events.clear()
  ledger.value = { db: {} as LocalDatabase, api, enabled: true }
  render(<MemoryRouter><BlurProvider><CalendarScreen /></BlurProvider></MemoryRouter>)
}

describe('Calendar', () => {
  it('asks to connect Google Calendar before any account is connected', async () => {
    const calendarConnect = vi.fn(async (): Promise<ApiResult<CalendarConnectStart>> => ({ ok: true, data: { authorizationUrl: 'https://accounts.google.com/x', expiresAt: '' } }))
    const empty: ApiResult<CalendarSnapshot> = { ok: true, data: { ...snapshot([]), accounts: [], calendars: [] } }
    await open({ calendarSync: async () => empty, calendarData: async () => empty, calendarConnect })
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Google Calendar' }))
    await waitFor(() => expect(window.api.openExternalUrl).toHaveBeenCalledWith('https://accounts.google.com/x'))
    expect(calendarConnect).toHaveBeenCalledWith(false)
  })

  it('shows the week from Google, moves an event by dragging, and undoes it', async () => {
    const week = monday()
    const standup = event('standup', week, 9)
    const updates: CalendarUpdateRequest[] = []
    const calendarUpdate = vi.fn(async (request: CalendarUpdateRequest): Promise<ApiResult<CalendarSnapshot>> => {
      updates.push(request)
      return { ok: true, data: snapshot([{ ...standup, ...request.changes, etag: `"${updates.length + 1}"` } as CalendarEvent], []) }
    })
    await open({
      calendarSync: async () => ({ ok: true, data: snapshot([standup]) }),
      calendarData: async () => ({ ok: true, data: snapshot([], []) }),
      calendarUpdate,
      calendarRange: async () => ({ ok: true, data: { events: [] } })
    })
    const block = await screen.findByRole('button', { name: /^standup/ })
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: 9 * 48 + 10 })
    act(() => { fireEvent.pointerMove(window, { clientX: 150, clientY: 11 * 48 + 10 }) })
    await act(async () => { fireEvent.pointerUp(window) })
    await waitFor(() => expect(calendarUpdate).toHaveBeenCalledTimes(1))
    expect(updates[0]).toMatchObject({
      accountId: ACCOUNT, calendarId: ACCOUNT, eventId: 'standup', etag: '"1"', scope: 'one',
      changes: { allDay: false, start: instantAt(shiftIso(week, 1), 11 * 60), end: instantAt(shiftIso(week, 1), 12 * 60) }
    })
    await screen.findByText('Event moved')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })) })
    await waitFor(() => expect(calendarUpdate).toHaveBeenCalledTimes(2))
    expect(updates[1]).toMatchObject({ etag: null, changes: { start: standup.start, end: standup.end } })
  })

  it('switches views from the keyboard and opens an event', async () => {
    await open({
      calendarSync: async () => ({ ok: true, data: snapshot([event('standup', isoToday(), 9)]) }),
      calendarData: async () => ({ ok: true, data: snapshot([], []) }),
      calendarSeries: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '' } }),
      calendarRange: async () => ({ ok: true, data: { events: [] } })
    })
    await screen.findByRole('button', { name: /^standup/ })
    fireEvent.keyDown(window, { key: 'm' })
    expect(screen.getByRole('button', { name: 'Month', pressed: true })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'a' })
    fireEvent.click(await screen.findByRole('button', { name: /standup/ }))
    expect(await screen.findByRole('complementary', { name: 'Event' })).toHaveTextContent('Personal')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Event' })).not.toBeInTheDocument())
  })
})
