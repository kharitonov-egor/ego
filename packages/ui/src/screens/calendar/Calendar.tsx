import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CalendarDays, ChevronLeft, ChevronRight, Menu, WifiOff, X } from 'lucide-react'
import type { CalendarAccount, CalendarEvent, CalendarEventDraft, CalendarInfo, CalendarScope } from '@ego/api-contracts'
import { blankDraft, draftChanges, draftFrom, isWritable, permissionsFor } from '@ego/local/calendar/draft'
import { CALENDAR_VIEWS, instantAt, rangeLabel, stepAnchor, type CalendarView, type EventTimes } from '@ego/local/calendar/layout'
import { overlaySourceOf } from '@ego/local/calendar/overlay'
import { isoToday } from '@ego/local/dates'
import { CalendarSidebar } from '../../components/calendar/CalendarSidebar'
import { EventEditor, type EditorResult } from '../../components/calendar/EventEditor'
import { EventPanel } from '../../components/calendar/EventPanel'
import { MonthGrid } from '../../components/calendar/MonthGrid'
import { Schedule } from '../../components/calendar/Schedule'
import { TimeGrid, type GridHandlers } from '../../components/calendar/TimeGrid'
import { ScopeDialog, UndoToast } from '../../components/calendar/ui'
import { CenteredMessage } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Spinner } from '../../components/ui/spinner'
import { CalendarProvider, useCalendar } from '../../lib/calendar/context'
import { useLedger } from '../../lib/ledger'

const CONNECT_ERRORS: Record<string, string> = {
  cancelled: 'Google Calendar was not connected. Nothing changed.',
  expired: 'That Google link expired or was already used. Try again.',
  no_access: 'Google did not grant calendar access. Connect again and allow it.',
  failed: 'Google did not finish connecting. Try again.'
}

const VIEW_KEYS: Record<string, CalendarView> = { d: 'day', x: '3day', w: 'week', m: 'month', a: 'schedule' }

interface ScopeQuestion {
  title: string
  scopes: readonly CalendarScope[]
  run: (scope: CalendarScope) => void
  cancel?: () => void
}

interface EditorState {
  event: CalendarEvent | null
  initial: CalendarEventDraft
  calendar: CalendarInfo | null
}

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function CalendarPage(): React.ReactElement {
  const calendar = useCalendar()
  const [params, setParams] = useSearchParams()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [question, setQuestion] = useState<ScopeQuestion | null>(null)
  const [leaving, setLeaving] = useState<CalendarAccount | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 1100)
  const { view, anchor, today, days, events, calendarByKey } = calendar
  const selected = events.find((event) => event.key === selectedKey) ?? null

  useEffect(() => {
    const connected = params.get('connected')
    const failure = params.get('error')
    if (!connected && !failure) return
    if (connected) void calendar.refresh(false)
    if (failure) setNotice(CONNECT_ERRORS[failure] ?? CONNECT_ERRORS.failed)
    setParams({}, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (selectedKey && !selected && !calendar.saving.has(selectedKey)) setSelectedKey(null)
  }, [selected, selectedKey, calendar.saving])

  const defaultCalendar = useMemo(() => {
    const writable = calendar.calendars.filter(isWritable)
    return writable.find((item) => item.primary) ?? writable[0] ?? null
  }, [calendar.calendars])

  /** Repeating events ask which occurrences first, the way Google does. */
  const ask = useCallback((event: CalendarEvent, title: string, scopes: readonly CalendarScope[], run: (scope: CalendarScope) => void): void => {
    if (!event.recurringEventId) run('one')
    else setQuestion({ title, scopes, run })
  }, [])

  const openCreate = useCallback((times: EventTimes): void => {
    if (!defaultCalendar) return
    setEditor({ event: null, initial: blankDraft(defaultCalendar, times), calendar: defaultCalendar })
  }, [defaultCalendar])

  const openEdit = useCallback(async (event: CalendarEvent): Promise<void> => {
    const series = event.recurringEventId ? await calendar.series(event) : null
    setEditor({ event, initial: draftFrom(event, series), calendar: calendarByKey.get(`${event.accountId}/${event.calendarId}`) ?? null })
  }, [calendar, calendarByKey])

  const remove = useCallback((event: CalendarEvent): void => {
    ask(event, 'Delete recurring event', ['one', 'following', 'all'], (scope) => {
      setSelectedKey(null)
      void calendar.remove(event, scope)
    })
  }, [ask, calendar])

  const handlers = useMemo((): GridHandlers => ({
    canMove: (event) => !calendar.offline && !overlaySourceOf(event) &&
      permissionsFor(event, calendarByKey.get(`${event.accountId}/${event.calendarId}`)).edit,
    onOpen: (event) => setSelectedKey(event.key),
    onMove: (event, times) => ask(event, 'Move recurring event', ['one', 'following', 'all'], (scope) => void calendar.move(event, times, scope)),
    onCreate: (times) => { if (!calendar.offline) openCreate(times) },
    onOpenDay: (day) => {
      calendar.setView('day')
      calendar.setAnchor(day)
    }
  }), [ask, calendar, calendarByKey, openCreate])

  const save = useCallback(async (result: EditorResult): Promise<boolean> => {
    const event = editor?.event
    if (!event) return calendar.create(result.calendar, result.after)
    const target = result.calendar.id !== event.calendarId ? result.calendar : null
    const changes = draftChanges(result.before, result.after)
    const scopes: CalendarScope[] = target ? ['all'] : changes.recurrence ? ['following', 'all'] : ['one', 'following', 'all']
    if (!event.recurringEventId) return calendar.update(event, result.before, result.after, 'one', target)
    return new Promise<boolean>((resolve) => {
      setQuestion({
        title: 'Edit recurring event',
        scopes,
        run: (scope) => void calendar.update(event, result.before, result.after, scope, target).then(resolve),
        cancel: () => resolve(false)
      })
    })
  }, [calendar, editor])

  useEffect(() => {
    const onKey = (key: KeyboardEvent): void => {
      if (key.defaultPrevented || typing(key.target) || document.querySelector('[role="dialog"], [role="menu"]')) return
      if ((key.ctrlKey || key.metaKey) && key.key.toLowerCase() === 'z') {
        if (!calendar.undo) return
        key.preventDefault()
        const undo = calendar.undo
        calendar.dismissUndo()
        void undo.run()
        return
      }
      if (key.ctrlKey || key.metaKey || key.altKey) return
      const lower = key.key.toLowerCase()
      if (VIEW_KEYS[lower]) calendar.setView(VIEW_KEYS[lower])
      else if (lower === 't') calendar.setAnchor(isoToday())
      else if (lower === 'j' || lower === 'n' || key.key === 'ArrowRight') calendar.setAnchor(stepAnchor(view, anchor, 1))
      else if (lower === 'k' || lower === 'p' || key.key === 'ArrowLeft') calendar.setAnchor(stepAnchor(view, anchor, -1))
      else if (lower === 'c') {
        const now = new Date()
        const start = anchor === today ? Math.min(23 * 60, (now.getHours() + 1) * 60) : 9 * 60
        openCreate({ allDay: false, start: instantAt(anchor, start), end: instantAt(anchor, start + 60) })
      } else if (lower === 'e' && selected && handlers.canMove(selected)) void openEdit(selected)
      else if ((key.key === 'Delete' || key.key === 'Backspace') && selected && handlers.canMove(selected)) remove(selected)
      else if (key.key === 'Escape' && selected) setSelectedKey(null)
      else return
      key.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, calendar, handlers, openCreate, openEdit, remove, selected, today, view])

  if (!calendar.loaded) return <div className="flex h-full items-center justify-center"><Spinner /></div>
  if (calendar.accounts.length === 0) {
    return <CenteredMessage
      Icon={CalendarDays}
      title="Connect Google Calendar"
      detail="Ego shows every calendar in your Google account, and changes you make here go straight back to Google."
      action={calendar.connecting ? 'Opening Google...' : 'Connect Google Calendar'}
      onAction={() => void calendar.connect(false)}
    >
      {(notice || calendar.error) && <p className="mt-4 max-w-md text-[14px] text-attention">{notice ?? calendar.error?.message}</p>}
    </CenteredMessage>
  }

  const selectedCalendar = selected ? calendarByKey.get(`${selected.accountId}/${selected.calendarId}`) : undefined
  const banner = notice ?? calendar.error?.message ?? null

  return <div className="flex h-full min-h-0">
    {sidebar && <CalendarSidebar
      anchor={anchor}
      today={today}
      days={view === 'month' || view === 'schedule' ? [] : days}
      accounts={calendar.accounts}
      calendars={calendar.calendars}
      overlay={calendar.overlay}
      refreshing={calendar.refreshing}
      fetchedAt={calendar.fetchedAt}
      connecting={calendar.connecting}
      onPick={(day) => calendar.setAnchor(day)}
      onCreate={() => openCreate({ allDay: false, start: instantAt(anchor, 9 * 60), end: instantAt(anchor, 10 * 60) })}
      onToggle={(item, on) => void calendar.changeCalendar(item, { selected: on })}
      onColor={(item, colorId) => void calendar.changeCalendar(item, { colorId })}
      onOverlay={calendar.setOverlay}
      onRefresh={() => void calendar.refresh(false)}
      onConnect={(another) => void calendar.connect(another)}
      onDisconnect={setLeaving}
    />}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-14 shrink-0 select-none items-center gap-2 border-b border-border px-4">
        <IconButton label={sidebar ? 'Hide calendars' : 'Show calendars'} onClick={() => setSidebar(!sidebar)}><Menu size={19} /></IconButton>
        <Button size="sm" variant="outline" onClick={() => calendar.setAnchor(isoToday())}>Today</Button>
        <IconButton label="Previous" onClick={() => calendar.setAnchor(stepAnchor(view, anchor, -1))}><ChevronLeft size={20} /></IconButton>
        <IconButton label="Next" onClick={() => calendar.setAnchor(stepAnchor(view, anchor, 1))}><ChevronRight size={20} /></IconButton>
        <h1 className="ml-1 truncate text-[20px] font-semibold">{rangeLabel(view, anchor)}</h1>
        {(calendar.loadingRange || calendar.refreshing) && <Spinner size={16} className="ml-1" />}
        {calendar.offline && <span className="ml-2 flex items-center gap-1.5 rounded-full bg-surface-900 px-3 py-1 text-[13px] text-attention"><WifiOff size={14} />Offline, view only</span>}
        <SegmentedControl
          className="ml-auto w-[420px] shrink-0"
          options={CALENDAR_VIEWS.map((item) => ({ value: item.view, label: item.label }))}
          value={view}
          onValueChange={calendar.setView}
        />
      </header>
      {banner && <div className="flex items-start gap-3 border-b border-border bg-surface-900 px-5 py-2.5 text-[14px] text-attention">
        <span className="min-w-0 flex-1">{banner}</span>
        <button type="button" aria-label="Dismiss" onClick={() => { setNotice(null); calendar.dismissError() }} className="text-surface-400 hover:text-foreground"><X size={16} /></button>
      </div>}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {view === 'month'
            ? <MonthGrid anchor={anchor} today={today} events={events} calendars={calendarByKey} selectedKey={selectedKey} saving={calendar.saving} handlers={handlers} />
            : view === 'schedule'
              ? <Schedule days={days} today={today} events={events} calendars={calendarByKey} selectedKey={selectedKey} onOpen={handlers.onOpen} />
              : <TimeGrid days={days} today={today} events={events} calendars={calendarByKey} selectedKey={selectedKey} saving={calendar.saving} handlers={handlers} />}
        </div>
        {selected && <EventPanel
          event={selected}
          calendar={selectedCalendar}
          calendars={calendarByKey}
          today={today}
          multipleAccounts={calendar.accounts.length > 1}
          offline={calendar.offline}
          loadSeries={calendar.series}
          onClose={() => setSelectedKey(null)}
          onEdit={() => void openEdit(selected)}
          onDelete={() => remove(selected)}
          onRespond={(answer, comment) => ask(selected, 'RSVP to recurring event', ['one', 'all'],
            (scope) => void calendar.respond(selected, answer, comment, scope === 'all' ? 'all' : 'one'))}
          onRecolor={(colorId) => ask(selected, 'Change color', ['one', 'following', 'all'], (scope) => void calendar.recolor(selected, colorId, scope))}
        />}
      </div>
    </div>

    {editor && <EventEditor
      visible
      event={editor.event}
      initial={editor.initial}
      calendars={calendar.calendars}
      defaultCalendar={editor.calendar}
      offline={calendar.offline}
      onClose={() => setEditor(null)}
      onSave={save}
    />}
    <ScopeDialog
      visible={question !== null}
      title={question?.title ?? ''}
      scopes={question?.scopes}
      onCancel={() => {
        question?.cancel?.()
        setQuestion(null)
      }}
      onPick={(scope) => {
        const run = question?.run
        setQuestion(null)
        run?.(scope)
      }}
    />
    <ConfirmDialog
      visible={leaving !== null}
      title={`Disconnect ${leaving?.id ?? ''}?`}
      detail="Its calendars leave Ego on every device. Nothing changes in Google Calendar."
      confirmLabel="Disconnect"
      destructive
      onCancel={() => setLeaving(null)}
      onConfirm={() => {
        const account = leaving
        setLeaving(null)
        if (account) void calendar.disconnect(account.id)
      }}
    />
    <UndoToast undo={calendar.undo} onDismiss={calendar.dismissUndo} />
  </div>
}

/** Google Calendar, every account's calendars, in the phone's black and white with Google's colors. */
export default function CalendarScreen(): React.ReactElement {
  const ledger = useLedger()
  if (!ledger.enabled) return <CenteredMessage Icon={CalendarDays} title="Sign in first" detail="Sign in with Google on the start screen, then come back to connect Calendar." />
  return <CalendarProvider><CalendarPage /></CalendarProvider>
}
