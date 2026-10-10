import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CalendarDays, Check, LayoutGrid, ListChecks, Plus, WifiOff, X } from 'lucide-react-native'
import type { CalendarAccount, CalendarEvent, CalendarEventDraft, CalendarInfo, CalendarScope } from '@ego/api-contracts'
import { EVENT_COLORS } from '@ego/core'
import { blankDraft, draftChanges, draftFrom, isWritable, permissionsFor } from '@ego/local/calendar/draft'
import { CALENDAR_VIEWS, instantAt, rangeLabel, stepAnchor, type EventTimes } from '@ego/local/calendar/layout'
import { overlaySourceOf } from '@ego/local/calendar/overlay'
import { isoToday } from '@ego/local/dates'
import { CalendarsSheet } from '../../components/calendar/CalendarsSheet'
import { EventEditor, type EditorResult } from '../../components/calendar/EventEditor'
import { EventSheet } from '../../components/calendar/EventSheet'
import { MonthGrid } from '../../components/calendar/MonthGrid'
import { Schedule } from '../../components/calendar/Schedule'
import { TimeGrid, type GridHandlers } from '../../components/calendar/TimeGrid'
import { ColorDot, ScopeSheet, UndoBar } from '../../components/calendar/ui'
import { HeaderIcon } from '../../components/gym/ui'
import { BottomSheet } from '../../components/money/Common'
import { CalendarDialog } from '../../components/money/DatePicker'
import { color } from '../../components/money/tokens'
import { Button } from '../../components/ui/button'
import { Text as UiText } from '../../components/ui/text'
import { useCalendar } from '../../lib/calendar/context'
import { isSignedIn, useSettings } from '../../lib/settings'

const CONNECT_ERRORS: Record<string, string> = {
  cancelled: 'Google Calendar was not connected. Nothing changed.',
  expired: 'That Google link expired or was already used. Try again.',
  no_access: 'Google did not grant calendar access. Connect again and allow it.',
  failed: 'Google did not finish connecting. Try again.'
}

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

function Message({ title, detail, action, busy = false, onAction }: { title: string; detail: string; action?: string; busy?: boolean; onAction?: () => void }): React.ReactElement {
  return <View className="flex-1 items-center justify-center px-8">
    <CalendarDays color="#737373" size={36} />
    <Text className="mt-3 text-center text-[20px] font-semibold text-foreground">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
    {action && onAction && <Button className="mt-5" disabled={busy} onPress={onAction}><UiText>{busy ? 'Opening Google...' : action}</UiText></Button>}
  </View>
}

export default function CalendarScreen(): React.ReactElement {
  const calendar = useCalendar()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { settings } = useSettings()
  const params = useLocalSearchParams<{ connected?: string; error?: string }>()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [question, setQuestion] = useState<ScopeQuestion | null>(null)
  const [sheet, setSheet] = useState<'views' | 'calendars' | 'jump' | 'colors' | null>(null)
  const [leaving, setLeaving] = useState<CalendarAccount | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { view, anchor, today, days, events, calendarByKey } = calendar
  const selected = events.find((event) => event.key === selectedKey) ?? null

  useEffect(() => {
    if (params.connected) void calendar.refresh(false)
    if (params.error) setNotice(CONNECT_ERRORS[params.error] ?? CONNECT_ERRORS.failed)
  }, [params.connected, params.error])

  const defaultCalendar = useMemo(() => {
    const writable = calendar.calendars.filter(isWritable)
    return writable.find((item) => item.primary) ?? writable[0] ?? null
  }, [calendar.calendars])

  const ask = useCallback((event: CalendarEvent, title: string, scopes: readonly CalendarScope[], run: (scope: CalendarScope) => void): void => {
    if (!event.recurringEventId) run('one')
    else setQuestion({ title, scopes, run })
  }, [])

  const openCreate = useCallback((times: EventTimes): void => {
    if (!defaultCalendar || calendar.offline) return
    setEditor({ event: null, initial: blankDraft(defaultCalendar, times), calendar: defaultCalendar })
  }, [calendar.offline, defaultCalendar])

  const openEdit = useCallback(async (event: CalendarEvent): Promise<void> => {
    const series = event.recurringEventId ? await calendar.series(event) : null
    setSelectedKey(null)
    setEditor({ event, initial: draftFrom(event, series), calendar: calendarByKey.get(`${event.accountId}/${event.calendarId}`) ?? null })
  }, [calendar, calendarByKey])

  const handlers = useMemo((): GridHandlers => ({
    canMove: (event) => !calendar.offline && !overlaySourceOf(event) &&
      permissionsFor(event, calendarByKey.get(`${event.accountId}/${event.calendarId}`)).edit,
    onOpen: (event) => setSelectedKey(event.key),
    onMove: (event, times) => ask(event, 'Move recurring event', ['one', 'following', 'all'], (scope) => void calendar.move(event, times, scope)),
    onCreate: openCreate,
    onOpenDay: (day) => {
      calendar.setView('day')
      calendar.setAnchor(day)
    },
    onSwipe: (direction) => calendar.setAnchor(stepAnchor(view, anchor, direction))
  }), [anchor, ask, calendar, calendarByKey, openCreate, view])

  const save = useCallback(async (result: EditorResult): Promise<boolean> => {
    const event = editor?.event
    if (!event) return calendar.create(result.calendar, result.after)
    const target = result.calendar.id !== event.calendarId ? result.calendar : null
    if (!event.recurringEventId) return calendar.update(event, result.before, result.after, 'one', target)
    const changes = draftChanges(result.before, result.after)
    const scopes: CalendarScope[] = target ? ['all'] : changes.recurrence ? ['following', 'all'] : ['one', 'following', 'all']
    return new Promise<boolean>((resolve) => setQuestion({
      title: 'Edit recurring event',
      scopes,
      run: (scope) => void calendar.update(event, result.before, result.after, scope, target).then(resolve),
      cancel: () => resolve(false)
    }))
  }, [calendar, editor])

  const openSource = (event: CalendarEvent): void => {
    const source = overlaySourceOf(event)
    setSelectedKey(null)
    if (source === 'tasks') router.push({ pathname: '/tasks/card/[id]', params: { id: event.id } })
    else if (source === 'study') router.push('/tasks/home')
    else if (source === 'gym') router.push('/gym')
  }

  const header = <Stack.Screen options={{
    title: rangeLabel(view, anchor),
    headerTitle: () => <Pressable accessibilityRole="button" accessibilityLabel="Jump to a day" onPress={() => setSheet('jump')} hitSlop={6}>
      <Text numberOfLines={1} className="text-[17px] font-bold text-foreground">{rangeLabel(view, anchor)}</Text>
    </Pressable>,
    headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color={color.text} size={21} /></HeaderIcon>,
    headerRight: () => <View className="flex-row items-center">
      {(calendar.refreshing || calendar.loadingRange) && <ActivityIndicator color={color.textMuted} size="small" style={{ marginRight: 6 }} />}
      <HeaderIcon label="Today" onPress={() => calendar.setAnchor(isoToday())}>
        <View className="h-7 min-w-7 items-center justify-center rounded-md border-2 border-surface-300 px-0.5"><Text className="text-[12px] font-bold text-surface-200">{new Date().getDate()}</Text></View>
      </HeaderIcon>
      <HeaderIcon label="Change view" onPress={() => setSheet('views')}>
        <Text className="w-7 text-center text-[15px] font-bold text-surface-200">{CALENDAR_VIEWS.find((item) => item.view === view)?.short}</Text>
      </HeaderIcon>
      <HeaderIcon label="Calendars" onPress={() => setSheet('calendars')}><ListChecks color={color.textSecondary} size={21} /></HeaderIcon>
    </View>
  }} />

  if (!isSignedIn(settings)) return <><Stack.Screen options={{ title: 'Calendar' }} /><Message title="Sign in first" detail="Sign in with Google on the start screen, then come back to connect Calendar." /></>
  if (!calendar.loaded) return <>{header}<View className="flex-1 items-center justify-center"><ActivityIndicator color="#fafafa" /></View></>
  if (calendar.accounts.length === 0) {
    return <>
      <Stack.Screen options={{ title: 'Calendar', headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color={color.text} size={21} /></HeaderIcon> }} />
      <Message
        title="Connect Google Calendar"
        detail={notice ?? calendar.error?.message ?? 'Ego shows every calendar in your Google account, and changes you make here go straight back to Google.'}
        action="Connect Google Calendar"
        busy={calendar.connecting}
        onAction={() => void calendar.connect(false)}
      />
    </>
  }

  const selectedCalendar = selected ? calendarByKey.get(`${selected.accountId}/${selected.calendarId}`) : undefined
  const banner = notice ?? calendar.error?.message ?? null

  return <>
    {header}
    <View className="flex-1 bg-background">
      {calendar.offline && <View className="flex-row items-center gap-2 bg-surface-900 px-4 py-2">
        <WifiOff color="#fbbf24" size={15} /><Text className="text-[14px] text-attention">Offline. Calendar is view-only.</Text>
      </View>}
      {banner && <Pressable onPress={() => { setNotice(null); calendar.dismissError() }} className="flex-row items-start gap-2 bg-surface-900 px-4 py-2.5">
        <Text className="flex-1 text-[14px] leading-5 text-attention">{banner}</Text><X color="#a3a3a3" size={16} />
      </Pressable>}
      {view === 'month'
        ? <MonthGrid anchor={anchor} today={today} events={events} calendars={calendarByKey} onOpenDay={handlers.onOpenDay} />
        : view === 'schedule'
          ? <Schedule days={days} today={today} events={events} calendars={calendarByKey} onOpen={handlers.onOpen} bottomInset={insets.bottom} />
          : <TimeGrid days={days} today={today} events={events} calendars={calendarByKey} saving={calendar.saving} handlers={handlers} />}
      {!calendar.offline && defaultCalendar && <Pressable
        accessibilityRole="button"
        accessibilityLabel="New event"
        onPress={() => {
          const start = anchor === today ? Math.min(23 * 60, (new Date().getHours() + 1) * 60) : 9 * 60
          openCreate({ allDay: false, start: instantAt(anchor, start), end: instantAt(anchor, start + 60) })
        }}
        className="absolute right-5 h-14 w-14 items-center justify-center rounded-2xl bg-white active:bg-white/85"
        style={{ bottom: insets.bottom + 20 }}
      ><Plus color="#0a0a0a" size={26} /></Pressable>}
      <UndoBar undo={calendar.undo} bottom={insets.bottom + 90} onDismiss={calendar.dismissUndo} />
    </View>

    {selected && <EventSheet
      event={selected}
      calendar={selectedCalendar}
      calendars={calendarByKey}
      today={today}
      multipleAccounts={calendar.accounts.length > 1}
      offline={calendar.offline}
      loadSeries={calendar.series}
      onClose={() => setSelectedKey(null)}
      onEdit={() => void openEdit(selected)}
      onDelete={() => ask(selected, 'Delete recurring event', ['one', 'following', 'all'], (scope) => {
        setSelectedKey(null)
        void calendar.remove(selected, scope)
      })}
      onRespond={(answer, comment) => ask(selected, 'RSVP to recurring event', ['one', 'all'],
        (scope) => void calendar.respond(selected, answer, comment, scope === 'all' ? 'all' : 'one'))}
      onColor={() => setSheet('colors')}
      onOpenSource={openSource}
    />}
    {editor && <EventEditor
      event={editor.event}
      initial={editor.initial}
      calendars={calendar.calendars}
      defaultCalendar={editor.calendar}
      offline={calendar.offline}
      onClose={() => setEditor(null)}
      onSave={save}
    />}
    <ScopeSheet
      visible={question !== null}
      title={question?.title ?? ''}
      scopes={question?.scopes ?? []}
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
    <BottomSheet visible={sheet === 'views'} title="View" onClose={() => setSheet(null)} dismissOnBackdrop>
      {CALENDAR_VIEWS.map((item) => <Pressable key={item.view} onPress={() => { calendar.setView(item.view); setSheet(null) }}
        className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900">
        <Text className="flex-1 text-[17px] text-foreground">{item.label}</Text>
        {item.view === view && <Check color="#fafafa" size={18} />}
      </Pressable>)}
    </BottomSheet>
    <BottomSheet visible={sheet === 'colors' && selected !== null} title="Event color" onClose={() => setSheet(null)} dismissOnBackdrop>
      {selected && [{ id: null, name: 'Calendar color', hex: selectedCalendar?.color ?? '#039be5' }, ...Object.entries(EVENT_COLORS).map(([id, named]) => ({ id, name: named.name, hex: named.hex }))]
        .map((item) => <Pressable key={item.name} onPress={() => {
          setSheet(null)
          ask(selected, 'Change color', ['one', 'following', 'all'], (scope) => void calendar.recolor(selected, item.id, scope))
        }} className="min-h-12 flex-row items-center gap-3 border-b border-surface-900 active:bg-surface-900">
          <ColorDot color={item.hex} size={18} />
          <Text className="flex-1 text-[17px] text-foreground">{item.name}</Text>
          {selected.colorId === item.id && <Check color="#fafafa" size={18} />}
        </Pressable>)}
    </BottomSheet>
    <CalendarsSheet
      visible={sheet === 'calendars'}
      accounts={calendar.accounts}
      calendars={calendar.calendars}
      overlay={calendar.overlay}
      refreshing={calendar.refreshing}
      fetchedAt={calendar.fetchedAt}
      connecting={calendar.connecting}
      onClose={() => setSheet(null)}
      onToggle={(item, on) => void calendar.changeCalendar(item, { selected: on })}
      onColor={(item, colorId) => void calendar.changeCalendar(item, { colorId })}
      onOverlay={calendar.setOverlay}
      onRefresh={() => void calendar.refresh(false)}
      onConnect={(another) => {
        setSheet(null)
        void calendar.connect(another)
      }}
      onDisconnect={(account) => {
        setSheet(null)
        setLeaving(account)
      }}
    />
    <CalendarDialog visible={sheet === 'jump'} value={anchor} onCancel={() => setSheet(null)} onConfirm={(day) => {
      setSheet(null)
      calendar.setAnchor(day)
    }} />
    <BottomSheet visible={leaving !== null} title={`Disconnect ${leaving?.id ?? ''}?`} onClose={() => setLeaving(null)} dismissOnBackdrop>
      <Text className="text-[16px] leading-6 text-muted-foreground">Its calendars leave Ego on every device. Nothing changes in Google Calendar.</Text>
      <View className="mt-5 flex-row gap-3">
        <Button variant="outline" size="lg" className="flex-1" onPress={() => setLeaving(null)}><UiText>Cancel</UiText></Button>
        <Button variant="destructive" size="lg" className="flex-1" onPress={() => {
          const account = leaving
          setLeaving(null)
          if (account) void calendar.disconnect(account.id)
        }}><UiText>Disconnect</UiText></Button>
      </View>
    </BottomSheet>
  </>
}
