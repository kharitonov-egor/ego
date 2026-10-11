import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  closeResolveSegments, isResolveRun, isResolveRuns, mergeResolveRuns, resolveCount, resolveDurationLabel, resolveElapsed, resolveEndsAt,
  RESOLVE_MAX_SECONDS, type ResolveRun, type ResolveSegment
} from '@ego/core'
import { boardPath } from '../../screens/tasks/nav'
import { beep } from '../beep'
import { useLedger } from '../ledger'
import { SecureStore } from '../preferences'
import { useTasks } from './context'

const RUNS_KEY = 'ego.tasks.resolve.runs'
const ACTIVE_KEY = 'ego.tasks.resolve.active'
const OPEN_KEY = 'ego.tasks.resolve.open'
const LAST_KEY = 'ego.tasks.resolve.last'
const DEFAULT_SECONDS = 25 * 60
const TICK_MS = 250
/** A run stopped this soon was a misclick, so it is not kept. */
const KEEP_AFTER_MS = 10_000
/** A run that reached zero longer ago than this, while Ego was closed, finishes without a beep. */
const BEEP_WINDOW_MS = 5_000
const REFRESH_MS = 60_000

export interface ActiveResolve {
  id: string
  boardId: string
  /** The list focus mode showed at the start, which the notification opens. */
  listId: string
  startedAt: string
  plannedSeconds: number
  segments: ResolveSegment[]
  /** Set when the clock reaches zero or Stop is pressed. The summary shows until it is closed. */
  finished: ResolveRun | null
}

function isSegment(value: unknown): value is ResolveSegment {
  return typeof value === 'object' && value !== null && 'start' in value && 'end' in value &&
    typeof value.start === 'number' && (value.end === null || typeof value.end === 'number')
}

function parseActive(raw: string | null): ActiveResolve | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const run: Partial<Record<keyof ActiveResolve, unknown>> = value
    if (typeof run.id !== 'string' || typeof run.boardId !== 'string' || typeof run.listId !== 'string' ||
      typeof run.startedAt !== 'string' || typeof run.plannedSeconds !== 'number' ||
      !Array.isArray(run.segments) || !run.segments.every(isSegment)) return null
    const finished = isResolveRun(run.finished) ? run.finished : null
    if (finished === null && run.finished !== null && run.finished !== undefined) return null
    return {
      id: run.id, boardId: run.boardId, listId: run.listId, startedAt: run.startedAt, plannedSeconds: run.plannedSeconds,
      segments: run.segments, finished
    }
  } catch {
    return null
  }
}

function parseRuns(raw: string | null): ResolveRun[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return isResolveRuns(value) ? value : []
  } catch {
    return []
  }
}

function sameRuns(left: readonly ResolveRun[], right: readonly ResolveRun[]): boolean {
  return left.length === right.length && left.every((run, at) => run.id === right[at]?.id)
}

/** `stop` is the Stop button, `end` the clock reaching zero now, `late` it reaching zero while Ego was closed. */
type Ending = 'stop' | 'end' | 'late'

function runId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface ResolveValue {
  active: ActiveResolve | null
  /** Finished runs from every device, newest first. */
  runs: ResolveRun[]
  open: boolean
  setOpen: (open: boolean) => void
  /** The duration the last run was set to, offered first next time. */
  lastSeconds: number
  start: (boardId: string, listId: string, seconds: number) => void
  pause: () => void
  resume: () => void
  /** Ends the run now and keeps it, unless it ran only a few seconds. */
  stop: () => void
  /** Closes the summary of a finished run. */
  dismiss: () => void
  /** Asks the Worker for runs finished on other devices. */
  refresh: () => void
}

export interface ResolveClockValue {
  /** Seconds left on the countdown. */
  remaining: number
  /** Seconds the clock has run, pauses left out. */
  elapsed: number
  /** Cards checked off on the run's board while the clock ran. */
  cards: number
}

const ResolveContext = createContext<ResolveValue | null>(null)
/** Separate from the controls, so only the countdown re-renders on every tick. */
const ResolveClockContext = createContext<ResolveClockValue>({ remaining: 0, elapsed: 0, cards: 0 })

/**
 * Resolve mode's clock runs app-wide, like the gym rest timer, so leaving focus mode or the board
 * does not stop it and the beep sounds wherever Ego is. Cards are counted from their done times,
 * so a reload in the middle of a run loses nothing.
 */
export function ResolveProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const tasks = useTasks()
  const { api, enabled } = useLedger()
  const [active, setActive] = useState<ActiveResolve | null>(null)
  const [runs, setRuns] = useState<ResolveRun[]>([])
  const [open, setOpenState] = useState(false)
  const [lastSeconds, setLastSeconds] = useState(DEFAULT_SECONDS)
  const [loaded, setLoaded] = useState(false)
  const [now, setNow] = useState(Date.now)
  const runsRef = useRef(runs)
  const activeRef = useRef(active)
  activeRef.current = active
  const cardsRef = useRef(tasks.data?.cards ?? null)
  cardsRef.current = tasks.data?.cards ?? null
  const syncing = useRef<Promise<void> | null>(null)
  const syncAgain = useRef(false)
  const fetchedAt = useRef(0)

  const keepRuns = useCallback((next: ResolveRun[]): void => {
    runsRef.current = next
    setRuns(next)
    void SecureStore.setItemAsync(RUNS_KEY, JSON.stringify(next)).catch(() => undefined)
  }, [])

  const keepActive = useCallback((next: ActiveResolve | null): void => {
    activeRef.current = next
    setActive(next)
    const write = next ? SecureStore.setItemAsync(ACTIVE_KEY, JSON.stringify(next)) : SecureStore.deleteItemAsync(ACTIVE_KEY)
    void write.catch(() => undefined)
  }, [])

  /** Runs only ever get added, so every device's copy merges into one and the Worker gets whatever it lacks. */
  const syncOnce = useCallback(async (): Promise<void> => {
    fetchedAt.current = Date.now()
    const remote = await api.sharedSetting('resolve-runs').catch(() => null)
    if (!remote?.ok) return
    const theirs = remote.data && isResolveRuns(remote.data.value) ? remote.data.value : []
    const merged = mergeResolveRuns(runsRef.current, theirs)
    if (!sameRuns(merged, runsRef.current)) keepRuns(merged)
    if (sameRuns(merged, theirs)) return
    const saved = await api.saveSharedSetting('resolve-runs', { value: merged, updatedAt: new Date().toISOString() }).catch(() => null)
    if (saved?.ok && saved.data && isResolveRuns(saved.data.value)) {
      const stored = mergeResolveRuns(runsRef.current, saved.data.value)
      if (!sameRuns(stored, runsRef.current)) keepRuns(stored)
    }
  }, [api, keepRuns])

  const sync = useCallback((): void => {
    if (!enabled || !loaded) return
    if (syncing.current) {
      syncAgain.current = true
      return
    }
    const run = async (): Promise<void> => {
      do {
        syncAgain.current = false
        await syncOnce()
      } while (syncAgain.current)
    }
    syncing.current = run().finally(() => { syncing.current = null })
  }, [enabled, loaded, syncOnce])

  useEffect(() => {
    let alive = true
    void Promise.all([RUNS_KEY, ACTIVE_KEY, OPEN_KEY, LAST_KEY].map((key) => SecureStore.getItemAsync(key).catch(() => null)))
      .then(([savedRuns, savedActive, savedOpen, savedLast]) => {
        if (!alive) return
        const local = parseRuns(savedRuns ?? null)
        runsRef.current = local
        setRuns(local)
        const restored = parseActive(savedActive ?? null)
        activeRef.current = restored
        setActive(restored)
        setOpenState(savedOpen === 'true')
        const last = Number(savedLast)
        if (Number.isInteger(last) && last > 0 && last <= RESOLVE_MAX_SECONDS) setLastSeconds(last)
        setLoaded(true)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => { sync() }, [sync])

  useEffect(() => {
    if (!enabled) return
    const onFocus = (): void => { if (Date.now() - fetchedAt.current > REFRESH_MS) sync() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, sync])

  const finish = useCallback((at: number, ending: Ending): void => {
    const current = activeRef.current
    const cards = cardsRef.current
    if (!current || current.finished || !cards) return
    const segments = closeResolveSegments(current.segments, at)
    const elapsed = resolveElapsed(segments, at)
    if (ending === 'stop' && elapsed < KEEP_AFTER_MS) {
      keepActive(null)
      return
    }
    const run: ResolveRun = {
      id: current.id,
      boardId: current.boardId,
      startedAt: current.startedAt,
      plannedSeconds: current.plannedSeconds,
      seconds: Math.min(current.plannedSeconds, Math.round(elapsed / 1000)),
      cards: resolveCount(cards, current.boardId, segments, at)
    }
    keepActive({ ...current, segments, finished: run })
    keepRuns(mergeResolveRuns([run], runsRef.current))
    sync()
    if (ending !== 'end') return
    try {
      beep()
    } catch {
      // A missing audio device must not stop the notification.
    }
    if (!document.hasFocus()) {
      const body = `${run.cards === 1 ? '1 card' : `${run.cards} cards`} in ${resolveDurationLabel(run.seconds)}.`
      window.api.notify({ title: "Time's up", body, route: `${boardPath(run.boardId)}?focus=${encodeURIComponent(current.listId)}`, silent: true })
    }
  }, [keepActive, keepRuns, sync])

  const running = active !== null && active.finished === null && active.segments.some((segment) => segment.end === null)
  const endsAt = active && !active.finished ? resolveEndsAt(active.segments, active.plannedSeconds) : null
  const dataReady = tasks.data !== null

  useEffect(() => {
    if (endsAt === null || !dataReady) return
    const wait = endsAt - Date.now()
    if (wait <= 0) {
      finish(endsAt, wait > -BEEP_WINDOW_MS ? 'end' : 'late')
      return
    }
    const timer = window.setTimeout(() => finish(endsAt, 'end'), wait)
    return () => window.clearTimeout(timer)
  }, [dataReady, endsAt, finish])

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [running])

  const setOpen = useCallback((next: boolean): void => {
    setOpenState(next)
    void SecureStore.setItemAsync(OPEN_KEY, String(next)).catch(() => undefined)
  }, [])

  const value = useMemo((): ResolveValue => ({
    active,
    runs,
    open,
    setOpen,
    lastSeconds,
    start: (boardId, listId, seconds) => {
      const at = Date.now()
      setLastSeconds(seconds)
      void SecureStore.setItemAsync(LAST_KEY, String(seconds)).catch(() => undefined)
      keepActive({
        id: runId(), boardId, listId, startedAt: new Date(at).toISOString(), plannedSeconds: seconds,
        segments: [{ start: at, end: null }], finished: null
      })
    },
    pause: () => {
      const current = activeRef.current
      if (current && !current.finished) keepActive({ ...current, segments: closeResolveSegments(current.segments, Date.now()) })
    },
    resume: () => {
      const current = activeRef.current
      if (!current || current.finished || current.segments.some((segment) => segment.end === null)) return
      keepActive({ ...current, segments: [...current.segments, { start: Date.now(), end: null }] })
    },
    stop: () => {
      const current = activeRef.current
      if (!current || current.finished) return
      const paused = current.segments.every((segment) => segment.end !== null)
      finish(paused ? Math.max(...current.segments.map((segment) => segment.end ?? 0)) : Date.now(), 'stop')
    },
    dismiss: () => keepActive(null),
    refresh: sync
  }), [active, finish, keepActive, lastSeconds, open, runs, setOpen, sync])

  const cards = tasks.data?.cards
  const clock = useMemo((): ResolveClockValue => {
    if (!active) return { remaining: 0, elapsed: 0, cards: 0 }
    if (active.finished) return { remaining: 0, elapsed: active.finished.seconds, cards: active.finished.cards }
    const elapsed = resolveElapsed(active.segments, now) / 1000
    return {
      remaining: Math.max(0, active.plannedSeconds - elapsed),
      elapsed,
      cards: cards ? resolveCount(cards, active.boardId, active.segments, Date.now()) : 0
    }
  }, [active, cards, now])

  return <ResolveContext.Provider value={value}>
    <ResolveClockContext.Provider value={clock}>{children}</ResolveClockContext.Provider>
  </ResolveContext.Provider>
}

export function useResolve(): ResolveValue {
  const value = useContext(ResolveContext)
  if (!value) throw new Error('useResolve must be used inside ResolveProvider')
  return value
}

export function useResolveClock(): ResolveClockValue {
  return useContext(ResolveClockContext)
}
