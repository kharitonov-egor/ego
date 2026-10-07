// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { blankDraft } from '@ego/local/calendar/draft'
import { instantAt, visibleDays } from '@ego/local/calendar/layout'
import { BlurProvider } from '../../lib/blur'
import { EventEditor } from './EventEditor'
import { EventPanel } from './EventPanel'
import { MonthGrid } from './MonthGrid'
import { TimeGrid, type GridHandlers } from './TimeGrid'

const ACCOUNT = 'me@example.com'
const DAYS = visibleDays('week', '2026-10-05')
/** jsdom lays nothing out, so every element reports a 700 by 1152 box: 100 pixels a day, 48 an hour. */
const BOX = { left: 0, top: 0, right: 700, bottom: 1152, width: 700, height: 1152, x: 0, y: 0, toJSON: () => ({}) }

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

const PRIMARY: CalendarInfo = {
  key: `${ACCOUNT}/${ACCOUNT}`, accountId: ACCOUNT, id: ACCOUNT, name: 'Personal', description: null, timeZone: null,
  accessRole: 'owner', primary: true, selected: true, colorId: '14', color: '#039be5', defaultReminders: [{ method: 'popup', minutes: 10 }],
  meet: true, deleted: false, updatedAt: '2026-10-02T00:00:00.000Z'
}
const CALENDARS = new Map([[PRIMARY.key, PRIMARY]])

function handlers(): GridHandlers & {
  onOpen: Mock<GridHandlers['onOpen']>
  onMove: Mock<GridHandlers['onMove']>
  onCreate: Mock<GridHandlers['onCreate']>
  onOpenDay: Mock<GridHandlers['onOpenDay']>
} {
  return {
    canMove: () => true,
    onOpen: vi.fn<GridHandlers['onOpen']>(),
    onMove: vi.fn<GridHandlers['onMove']>(),
    onCreate: vi.fn<GridHandlers['onCreate']>(),
    onOpenDay: vi.fn<GridHandlers['onOpenDay']>()
  }
}

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
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

function grid(events: CalendarEvent[], on: GridHandlers): void {
  render(<BlurProvider><TimeGrid days={DAYS} today="2026-10-07" events={events} calendars={CALENDARS} selectedKey={null} saving={new Set()} handlers={on} /></BlurProvider>)
}

describe('TimeGrid', () => {
  it('opens an event on a click without moving it', () => {
    const on = handlers()
    grid([event('standup')], on)
    const block = screen.getByRole('button', { name: /^standup/ })
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: 9 * 48 + 10 })
    fireEvent.pointerUp(window)
    expect(on.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'standup' }))
    expect(on.onMove).not.toHaveBeenCalled()
  })

  it('drags an event a day later and an hour later, in 15-minute steps', () => {
    const on = handlers()
    grid([event('standup')], on)
    const block = screen.getByRole('button', { name: /^standup/ })
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: 9 * 48 + 10 })
    act(() => { fireEvent.pointerMove(window, { clientX: 150, clientY: 10 * 48 + 14 }) })
    fireEvent.pointerUp(window)
    expect(on.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'standup' }), {
      allDay: false, start: at('2026-10-06', 10), end: at('2026-10-06', 11)
    })
  })

  it('stretches an event from its bottom edge', () => {
    const on = handlers()
    grid([event('standup')], on)
    const block = screen.getByRole('button', { name: /^standup/ })
    const handle = block.querySelector('.cursor-ns-resize')
    if (!handle) throw new Error('No resize handle')
    fireEvent.pointerDown(handle, { button: 0, clientX: 50, clientY: 10 * 48 - 2 })
    act(() => { fireEvent.pointerMove(window, { clientX: 50, clientY: 11 * 48 + 20 }) })
    fireEvent.pointerUp(window)
    expect(on.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'standup' }), {
      allDay: false, start: at('2026-10-05', 9), end: at('2026-10-05', 11, 30)
    })
  })

  it('creates an hour-long event where an empty slot is clicked, or the dragged span', () => {
    const on = handlers()
    grid([], on)
    const columns = document.querySelectorAll('.border-l.border-border.absolute.inset-y-0')
    const wednesday = [...columns].find((element) => (element as HTMLElement).style.width !== '' && (element as HTMLElement).style.left === `${(2 / 7) * 100}%`)
    if (!wednesday) throw new Error('No column')
    fireEvent.pointerDown(wednesday, { button: 0, clientX: 250, clientY: 14 * 48 + 5 })
    fireEvent.pointerUp(window)
    expect(on.onCreate).toHaveBeenLastCalledWith({ allDay: false, start: at('2026-10-07', 14), end: at('2026-10-07', 15) })
    fireEvent.pointerDown(wednesday, { button: 0, clientX: 250, clientY: 14 * 48 + 5 })
    act(() => { fireEvent.pointerMove(window, { clientX: 250, clientY: 16 * 48 + 5 }) })
    fireEvent.pointerUp(window)
    expect(on.onCreate).toHaveBeenLastCalledWith({ allDay: false, start: at('2026-10-07', 14), end: at('2026-10-07', 16, 15) })
  })

  it('leaves a read-only event in place and only opens it', () => {
    const on = { ...handlers(), canMove: () => false }
    grid([event('holiday')], on)
    const block = screen.getByRole('button', { name: /^holiday/ })
    fireEvent.pointerDown(block, { button: 0, clientX: 50, clientY: 9 * 48 + 10 })
    act(() => { fireEvent.pointerMove(window, { clientX: 150, clientY: 12 * 48 }) })
    fireEvent.pointerUp(window)
    fireEvent.click(block)
    expect(on.onMove).not.toHaveBeenCalled()
    expect(on.onOpen).toHaveBeenCalledTimes(1)
  })
})

describe('MonthGrid', () => {
  it('moves an event to the day it is dropped on', () => {
    const on = handlers()
    render(<BlurProvider><MonthGrid anchor="2026-10-01" today="2026-10-07" events={[event('standup')]} calendars={CALENDARS} selectedKey={null} saving={new Set()} handlers={on} /></BlurProvider>)
    const chip = screen.getByRole('button', { name: /standup/ })
    fireEvent.pointerDown(chip, { button: 0, clientX: 50, clientY: 300 })
    act(() => { fireEvent.pointerMove(window, { clientX: 350, clientY: 300 }) })
    fireEvent.pointerUp(window)
    expect(on.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'standup' }), expect.objectContaining({ start: at('2026-10-08', 9) }))
  })
})

describe('EventPanel', () => {
  it('answers an invitation with a note and joins the call', () => {
    const onRespond = vi.fn()
    const invite = event('review', {
      response: 'needsAction', organizer: { email: 'boss@example.com', name: 'Boss', self: false },
      conference: { name: 'Google Meet', url: 'https://meet.google.com/abc', phone: null, pin: null },
      attendees: [
        { email: 'boss@example.com', name: 'Boss', response: 'accepted', self: false, organizer: true, optional: false, resource: false, comment: null },
        { email: ACCOUNT, name: null, response: 'needsAction', self: true, organizer: false, optional: false, resource: false, comment: null }
      ],
      description: 'Agenda <a href="https://docs.example.com">doc</a>'
    })
    render(<MemoryRouter><BlurProvider><EventPanel
      event={invite} calendar={PRIMARY} calendars={CALENDARS} today="2026-10-02" multipleAccounts={false} offline={false}
      loadSeries={async () => null} onClose={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onRespond={onRespond} onRecolor={vi.fn()}
    /></BlurProvider></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Edit event' })).not.toBeInTheDocument()
    expect(screen.getByText('Only the organizer can change this event.')).toBeInTheDocument()
    expect(screen.getByText('1 yes, 1 awaiting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }))
    fireEvent.change(screen.getByPlaceholderText('A note for the organizer'), { target: { value: 'Running late' } })
    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }))
    expect(onRespond).toHaveBeenCalledWith('tentative', 'Running late')
    fireEvent.click(screen.getByRole('button', { name: 'Join Google Meet' }))
    expect(window.api.openExternalUrl).toHaveBeenCalledWith('https://meet.google.com/abc')
    fireEvent.click(screen.getByRole('button', { name: 'doc' }))
    expect(window.api.openExternalUrl).toHaveBeenCalledWith('https://docs.example.com')
  })
})

describe('EventEditor', () => {
  it('saves a new weekly event with a guest and a Meet link', async () => {
    const onSave = vi.fn(async () => true)
    const initial = blankDraft(PRIMARY, { allDay: false, start: at('2026-10-05', 9), end: at('2026-10-05', 10) })
    render(<BlurProvider><EventEditor visible event={null} initial={initial} calendars={[PRIMARY]} defaultCalendar={PRIMARY} offline={false} onClose={vi.fn()} onSave={onSave} /></BlurProvider>)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Gym' } })
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '17:30' } })
    fireEvent.change(screen.getByDisplayValue('Does not repeat'), { target: { value: 'weekly' } })
    fireEvent.change(screen.getByPlaceholderText('Add guests by email'), { target: { value: 'friend@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Google Meet video conferencing' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      calendar: PRIMARY,
      after: expect.objectContaining({
        title: 'Gym', start: at('2026-10-05', 17, 30), end: at('2026-10-05', 18, 30), recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
        attendees: [{ email: 'friend@example.com', optional: false }], meet: true
      })
    }))
  })

  it('refuses an event that ends before it starts', async () => {
    const onSave = vi.fn(async () => true)
    const initial = blankDraft(PRIMARY, { allDay: false, start: at('2026-10-05', 9), end: at('2026-10-05', 10) })
    render(<BlurProvider><EventEditor visible event={null} initial={initial} calendars={[PRIMARY]} defaultCalendar={PRIMARY} offline={false} onClose={vi.fn()} onSave={onSave} /></BlurProvider>)
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '08:00' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('The event must end after it starts.')).toBeInTheDocument()
  })
})
