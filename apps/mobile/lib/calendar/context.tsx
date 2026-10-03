import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type {
  ApiError, ApiResult, CalendarAccount, CalendarAnswer, CalendarEvent, CalendarEventDraft, CalendarInfo, CalendarScope,
  CalendarSeries, CalendarSnapshot
} from '@ego/api-contracts'
import { deviceTimeZone, draftChanges, draftFrom, pendingEvent } from '@ego/local/calendar/draft'
import { instantAt, visibleDays, type CalendarView, type EventTimes, isCalendarView } from '@ego/local/calendar/layout'
import { OVERLAY_CALENDARS, overlayEvents } from '@ego/local/calendar/overlay'
import { applyCalendarAnswer, cachedCalendarMeta, cachedEvents, refreshCalendar, type CalendarMeta } from '@ego/local/calendar/store'
import { isoToday, shiftIso } from '@ego/local/dates'
import { useLedger } from '../ledger-context'

/** The Worker skips a Google pull made within 15 seconds of the last one. */
const STALE_AFTER_MS = 15_000
/** While Calendar is open and Ego is in front, it checks Google about once a minute. */
const POLL_MS = 60_000
export const UNDO_MS = 6000
const OVERLAY_KEY = 'ego.calendar.overlay'
const VIEW_KEY = 'ego.calendar.view'
const OFFLINE: ApiError = { code: 'OFFLINE', message: 'You are offline. Calendar is view-only until the connection is back.' }
const EMPTY_META: CalendarMeta = { accounts: [], calendars: [], serverTime: null, fetchedAt: null }

export interface UndoAction {
  id: number
  label: string
  run: () => Promise<void>
}

interface CalendarContextValue {
  loaded: boolean
  accounts: CalendarAccount[]
  /** Google's calendars, every account, ticked or not. */
  calendars: CalendarInfo[]
  /** Google's and, with the overlay on, Ego's own, by key. */
  calendarByKey: Map<string, CalendarInfo>
  view: CalendarView
  setView: (view: CalendarView) => void
  anchor: string
  setAnchor: (day: string) => void
  today: string
  days: string[]
  /** The ticked calendars' events on the visible days, with changes still on their way shown as made. */
  events: CalendarEvent[]
  /** Days outside the stored window are being read from Google. */
  loadingRange: boolean
  overlay: boolean
  setOverlay: (on: boolean) => void
  refreshing: boolean
  fetchedAt: string | null
  offline: boolean
  error: ApiError | null
  dismissError: () => void
  /** Keys of events with a change on its way to Google. */
  saving: ReadonlySet<string>
  undo: UndoAction | null
  dismissUndo: () => void
  refresh: (onlyIfStale?: boolean) => Promise<void>
  connecting: boolean
  connect: (another: boolean) => Promise<void>
  disconnect: (accountId: string) => Promise<boolean>
  move: (event: CalendarEvent, times: EventTimes, scope: CalendarScope) => Promise<boolean>
  create: (calendar: CalendarInfo, draft: CalendarEventDraft) => Promise<boolean>
  update: (event: CalendarEvent, before: CalendarEventDraft, after: CalendarEventDraft, scope: CalendarScope, target: CalendarInfo | null) => Promise<boolean>
  remove: (event: CalendarEvent, scope: CalendarScope) => Promise<boolean>
  respond: (event: CalendarEvent, answer: CalendarAnswer, comment: string | null, scope: 'one' | 'all') => Promise<boolean>
  recolor: (event: CalendarEvent, colorId: string | null, scope: CalendarScope) => Promise<boolean>
  changeCalendar: (calendar: CalendarInfo, change: { selected?: boolean; colorId?: string }) => Promise<boolean>
  series: (event: CalendarEvent) => Promise<CalendarSeries | null>
}

const CalendarContext = createContext<CalendarContextValue | null>(null)

function failureOf(error: unknown): ApiError {
  return { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Calendar could not refresh' }
}

/** The days every connected account keeps, so anything outside is read from Google instead. */
function storedWindow(accounts: readonly CalendarAccount[]): { from: string; to: string } | null {
  const connected = accounts.filter((account) => account.connected && account.windowFrom && account.windowTo)
  if (connected.length === 0) return null
  return {
    from: connected.reduce((latest, account) => (account.windowFrom ?? '') > latest ? account.windowFrom ?? latest : latest, ''),
    to: connected.reduce((earliest, account) => (account.windowTo ?? '9999') < earliest ? account.windowTo ?? earliest : earliest, '9999-12-31')
  }
}

export function CalendarProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, api } = useLedger()
  const [loaded, setLoaded] = useState(false)
  const [meta, setMeta] = useState<CalendarMeta>(EMPTY_META)
  const [stored, setStored] = useState<CalendarEvent[]>([])
  const [live, setLive] = useState<{ key: string; events: CalendarEvent[] } | null>(null)
  const [loadingRange, setLoadingRange] = useState(false)
  const [ownItems, setOwnItems] = useState<CalendarEvent[]>([])
  const [overrides, setOverrides] = useState<ReadonlyMap<string, CalendarEvent | null>>(new Map())
  const [view, setViewState] = useState<CalendarView>('week')
  const [anchor, setAnchor] = useState(isoToday)
  const [today, setToday] = useState(isoToday)
  const [overlay, setOverlayState] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [offline, setOffline] = useState(false)
  const [undo, setUndo] = useState<UndoAction | null>(null)
  const [connecting, setConnecting] = useState(false)
  const running = useRef<Promise<void> | null>(null)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const awaitingConsent = useRef(false)
  const undoIds = useRef(0)

  const days = useMemo(() => visibleDays(view, anchor), [view, anchor])
  const first = days[0]
  const last = days[days.length - 1]

  const readRange = useCallback(async (): Promise<void> => {
    if (!db) return
    const [events, own] = await Promise.all([
      cachedEvents(db, instantAt(first, 0), instantAt(shiftIso(last, 1), 0)),
      overlay ? overlayEvents(db, first, last) : Promise.resolve([])
    ])
    setStored(events)
    setOwnItems(own)
  }, [db, first, last, overlay])

  const reload = useCallback(async (): Promise<void> => {
    if (!db) return
    setMeta(await cachedCalendarMeta(db))
    await readRange()
    setLoaded(true)
  }, [db, readRange])

  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const refresh = useCallback(async (onlyIfStale = false): Promise<void> => {
    if (!db) return
    if (running.current) return running.current
    const last = metaRef.current.fetchedAt ? Date.parse(metaRef.current.fetchedAt) : 0
    if (onlyIfStale && Date.now() - last < STALE_AFTER_MS) return
    const work = (async () => {
      setRefreshing(true)
      try {
        const result = await refreshCalendar(db, api, { sync: true, now: new Date().toISOString() })
        if (!result.ok) {
          if (result.error.code === 'OFFLINE') setOffline(true)
          else setError(result.error)
          return
        }
        setOffline(false)
        setError(null)
        await reloadRef.current()
      } catch (failure: unknown) {
        setError(failureOf(failure))
      } finally {
        setRefreshing(false)
        running.current = null
      }
    })()
    running.current = work
    return work
  }, [api, db])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    void SecureStore.getItemAsync(OVERLAY_KEY).then((stored) => setOverlayState(stored === '1')).catch(() => undefined)
    void SecureStore.getItemAsync(VIEW_KEY).then((stored) => { if (isCalendarView(stored)) setViewState(stored) }).catch(() => undefined)
  }, [])

  useEffect(() => {
    setLoaded(false)
    setMeta(EMPTY_META)
    setStored([])
    if (!db) return
    void reloadRef.current()
      .then(() => refreshRef.current(true))
      .catch((failure: unknown) => setError(failureOf(failure)))
  }, [db])

  useEffect(() => {
    void readRange().catch((failure: unknown) => setError(failureOf(failure)))
  }, [readRange])

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const start = (): void => {
      if (timer) return
      timer = setInterval(() => {
        setToday(isoToday())
        void refreshRef.current(true)
      }, POLL_MS)
    }
    const stop = (): void => {
      if (timer) clearInterval(timer)
      timer = null
    }
    start()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stop()
        return
      }
      start()
      setToday(isoToday())
      const returning = awaitingConsent.current
      awaitingConsent.current = false
      void refreshRef.current(!returning)
    })
    return () => {
      stop()
      subscription.remove()
    }
  }, [])

  // Weeks outside the window the Worker keeps come straight from Google and are kept only in memory.
  const window_ = storedWindow(meta.accounts)
  const outside = window_ !== null && (first < window_.from || last > window_.to)
  const liveKey = `${first}|${last}`
  useEffect(() => {
    if (!outside || offline || live?.key === liveKey) return
    let active = true
    setLoadingRange(true)
    void api.calendarRange(first, last).then((result) => {
      if (!active) return
      if (result.ok) setLive({ key: liveKey, events: result.data.events })
      else if (result.error.code !== 'OFFLINE') setError(result.error)
    }).finally(() => { if (active) setLoadingRange(false) })
    return () => { active = false }
  }, [api, first, last, live?.key, liveKey, offline, outside])

  const calendarByKey = useMemo(() => {
    const map = new Map<string, CalendarInfo>(meta.calendars.map((calendar) => [calendar.key, calendar]))
    if (overlay) for (const calendar of OVERLAY_CALENDARS) map.set(calendar.key, calendar)
    return map
  }, [meta.calendars, overlay])

  const events = useMemo(() => {
    const inWindow = (event: CalendarEvent): boolean => {
      if (!window_) return true
      const day = event.allDay ? event.start : event.start.slice(0, 10)
      return day >= window_.from && day <= window_.to
    }
    const fromGoogle = outside && live?.key === liveKey
      ? [...stored.filter(inWindow), ...live.events.filter((event) => !inWindow(event))]
      : stored
    const merged = new Map<string, CalendarEvent>()
    for (const event of [...fromGoogle, ...ownItems]) merged.set(event.key, event)
    for (const [key, value] of overrides) {
      if (value) merged.set(key, value)
      else merged.delete(key)
    }
    return [...merged.values()].filter((event) => calendarByKey.get(`${event.accountId}/${event.calendarId}`)?.selected === true)
  }, [calendarByKey, live, liveKey, outside, overrides, ownItems, stored, window_])

  const saving = useMemo(() => new Set(overrides.keys()), [overrides])

  const offer = useCallback((label: string, run: () => Promise<void>): void => {
    undoIds.current += 1
    setUndo({ id: undoIds.current, label, run })
  }, [])

  /**
   * Shows the change at once, sends it, and folds Google's answer into the copy. A refusal puts
   * the event back as it was and says why.
   */
  const write = useCallback(async (
    optimistic: ReadonlyArray<[string, CalendarEvent | null]>, call: (since: string | null) => Promise<ApiResult<CalendarSnapshot>>
  ): Promise<boolean> => {
    if (!db) return false
    if (offline) {
      setError(OFFLINE)
      return false
    }
    setOverrides((current) => new Map([...current, ...optimistic]))
    const clear = (): void => setOverrides((current) => {
      const next = new Map(current)
      for (const [key] of optimistic) next.delete(key)
      return next
    })
    try {
      const result = await call(metaRef.current.serverTime)
      if (!result.ok) {
        if (result.error.code === 'OFFLINE') setOffline(true)
        setError(result.error.code === 'OFFLINE' ? OFFLINE : result.error)
        if (result.error.code === 'CONFLICT' || result.error.code === 'NOT_FOUND') await refreshRef.current(false)
        clear()
        return false
      }
      await applyCalendarAnswer(db, result.data, new Date().toISOString())
      await reloadRef.current()
      clear()
      return true
    } catch (failure: unknown) {
      setError(failureOf(failure))
      clear()
      return false
    }
  }, [db, offline])

  const ref = (event: CalendarEvent) => ({ accountId: event.accountId, calendarId: event.calendarId, eventId: event.id })

  const move = useCallback(async (event: CalendarEvent, times: EventTimes, scope: CalendarScope): Promise<boolean> => {
    const moved = { ...event, ...times }
    const timeZone = event.timeZone ?? deviceTimeZone()
    const ok = await write([[event.key, moved]], (since) => api.calendarUpdate({
      since, ...ref(event), etag: event.etag, scope, targetCalendarId: null, changes: { ...times, timeZone }
    }))
    // Moving a whole series renames its occurrences, so only a single event can be put back.
    if (ok && scope === 'one') {
      offer('Event moved', async () => {
        await write([[event.key, event]], (since) => api.calendarUpdate({
          since, ...ref(event), etag: null, scope, targetCalendarId: null,
          changes: { allDay: event.allDay, start: event.start, end: event.end, timeZone }
        }))
      })
    }
    return ok
  }, [api, offer, write])

  const create = useCallback(async (calendar: CalendarInfo, draft: CalendarEventDraft): Promise<boolean> => {
    const placeholder = pendingEvent(calendar, draft)
    return write([[placeholder.key, placeholder]], (since) => api.calendarCreate({ since, accountId: calendar.accountId, calendarId: calendar.id, draft }))
  }, [api, write])

  const update = useCallback(async (
    event: CalendarEvent, before: CalendarEventDraft, after: CalendarEventDraft, scope: CalendarScope, target: CalendarInfo | null
  ): Promise<boolean> => {
    const changes = draftChanges(before, after)
    const moving = target !== null && target.id !== event.calendarId
    if (Object.keys(changes).length === 0 && !moving) return true
    const shown: CalendarEvent = {
      ...event, title: after.title, location: after.location, description: after.description, allDay: after.allDay,
      start: after.start, end: after.end, colorId: after.colorId
    }
    return write([[event.key, moving ? null : shown]], (since) => api.calendarUpdate({
      since, ...ref(event), etag: event.etag, scope, changes, targetCalendarId: moving ? target.id : null
    }))
  }, [api, write])

  const remove = useCallback(async (event: CalendarEvent, scope: CalendarScope): Promise<boolean> => {
    const ok = await write([[event.key, null]], (since) => api.calendarDelete({ since, ...ref(event), scope }))
    const restoreId = scope === 'all' && event.recurringEventId ? event.recurringEventId : scope === 'following' ? null : event.id
    if (ok && restoreId) {
      offer('Event deleted', async () => {
        await write([[event.key, event]], (since) => api.calendarRestore({ since, accountId: event.accountId, calendarId: event.calendarId, eventId: restoreId }))
      })
    }
    return ok
  }, [api, offer, write])

  const respond = useCallback(async (event: CalendarEvent, answer: CalendarAnswer, comment: string | null, scope: 'one' | 'all'): Promise<boolean> =>
    write([[event.key, { ...event, response: answer }]], (since) => api.calendarRsvp({ since, ...ref(event), answer, comment, scope })), [api, write])

  const recolor = useCallback(async (event: CalendarEvent, colorId: string | null, scope: CalendarScope): Promise<boolean> => {
    const before = draftFrom(event)
    return update(event, before, { ...before, colorId }, scope, null)
  }, [update])

  const changeCalendar = useCallback(async (calendar: CalendarInfo, change: { selected?: boolean; colorId?: string }): Promise<boolean> => {
    if (!db) return false
    if (offline) {
      setError(OFFLINE)
      return false
    }
    const shown = { ...calendar, ...(change.selected !== undefined ? { selected: change.selected } : {}) }
    setMeta((current) => ({ ...current, calendars: current.calendars.map((item) => item.key === calendar.key ? shown : item) }))
    const result = await api.calendarList({
      since: metaRef.current.serverTime, accountId: calendar.accountId, calendarId: calendar.id,
      selected: change.selected ?? null, colorId: change.colorId ?? null
    })
    if (!result.ok) {
      setError(result.error)
      await reloadRef.current()
      return false
    }
    await applyCalendarAnswer(db, result.data, new Date().toISOString())
    await reloadRef.current()
    return true
  }, [api, db, offline])

  const series = useCallback(async (event: CalendarEvent): Promise<CalendarSeries | null> => {
    if (!event.recurringEventId || offline) return null
    const result = await api.calendarSeries({ accountId: event.accountId, calendarId: event.calendarId, eventId: event.recurringEventId })
    return result.ok ? result.data : null
  }, [api, offline])

  const connect = useCallback(async (another: boolean): Promise<void> => {
    setConnecting(true)
    try {
      const result = await api.calendarConnect(another)
      if (!result.ok) {
        setError(result.error)
        return
      }
      awaitingConsent.current = true
      await Linking.openURL(result.data.authorizationUrl)
    } catch {
      awaitingConsent.current = false
      setError({ code: 'SERVER_ERROR', message: 'The phone could not open a browser for Google.' })
    } finally {
      setConnecting(false)
    }
  }, [api])

  const disconnect = useCallback(async (accountId: string): Promise<boolean> => {
    const result = await api.calendarDisconnect(accountId)
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await refreshRef.current(false)
    return true
  }, [api])

  const setView = useCallback((next: CalendarView): void => {
    setViewState(next)
    void SecureStore.setItemAsync(VIEW_KEY, next).catch(() => undefined)
  }, [])

  const setOverlay = useCallback((on: boolean): void => {
    setOverlayState(on)
    void SecureStore.setItemAsync(OVERLAY_KEY, on ? '1' : '0').catch(() => undefined)
  }, [])

  const dismissError = useCallback(() => setError(null), [])
  const dismissUndo = useCallback(() => setUndo(null), [])

  const value = useMemo((): CalendarContextValue => ({
    loaded, accounts: meta.accounts, calendars: meta.calendars, calendarByKey, view, setView, anchor, setAnchor, today, days,
    events, loadingRange, overlay, setOverlay, refreshing, fetchedAt: meta.fetchedAt, offline, error, dismissError, saving,
    undo, dismissUndo, refresh, connecting, connect, disconnect, move, create, update, remove, respond, recolor,
    changeCalendar, series
  }), [anchor, calendarByKey, changeCalendar, connect, connecting, create, days, disconnect, dismissError, dismissUndo, error,
    events, loaded, loadingRange, meta, move, offline, overlay, recolor, refresh, refreshing, remove, respond, saving, series,
    setOverlay, setView, today, undo, update, view])

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>
}

export function useCalendar(): CalendarContextValue {
  const context = useContext(CalendarContext)
  if (!context) throw new Error('useCalendar must be used inside CalendarProvider')
  return context
}
