import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import { isHabitInput, type HabitInput, type HabitKind } from '@ego/core'
import { isoToday } from '@ego/local/dates'
import type { LocalDatabase } from '@ego/local/database/types'
import { useLedger, type LocalWrite } from '../ledger-context'
import { localHabitEntries, localHabits, localRevision } from '@ego/local/repositories/habits'
import {
  createHabit, createHabitEntry, deleteHabit, deleteHabitEntry, newId, updateHabit
} from '@ego/local/sync/commands'
import { buildLog, type HabitLog } from '@ego/local/habits/stats'

export interface EditorTarget {
  kind: HabitKind
  /** Null adds a new habit. */
  habit: HabitRecord | null
}

interface HabitsContextValue {
  enabled: boolean
  /** Null until the local database has been read. */
  habits: HabitRecord[] | null
  log: HabitLog
  today: string
  /** The day Home shows. Follows today until another day is picked. */
  date: string
  setDate: (date: string) => void
  busy: boolean
  error: string | null
  dismissError: () => void
  editor: EditorTarget | null
  openEditor: (target: EditorTarget) => void
  closeEditor: () => void
  save: (input: HabitInput, habit: HabitRecord | null) => Promise<boolean>
  remove: (habit: HabitRecord) => Promise<boolean>
  move: (habit: HabitRecord, delta: -1 | 1) => Promise<boolean>
  /**
   * Adds a check-off. A habit done once a day, or a weekly one, toggles instead. A habit that has
   * met a larger daily target stays as it is.
   */
  tap: (habit: HabitRecord, date: string) => Promise<boolean>
  /** Removes the day's latest check-off. */
  takeBack: (habit: HabitRecord, date: string) => Promise<boolean>
  /** Restarts a habit to break's clock from this moment. */
  restart: (habit: HabitRecord) => Promise<boolean>
  removeEntry: (entryId: string) => Promise<boolean>
}

const HabitsContext = createContext<HabitsContextValue | null>(null)

export function habitInput(habit: HabitRecord, changes: Partial<HabitInput> = {}): HabitInput {
  return {
    name: habit.name, icon: habit.icon, kind: habit.kind, startDate: habit.startDate, position: habit.position,
    target: habit.target, period: habit.period, startedAt: habit.startedAt,
    ...changes
  }
}

function checkOffs(entries: readonly HabitEntryRecord[], habitId: string, date: string): HabitEntryRecord[] {
  return entries
    .filter((entry) => entry.habitId === habitId && entry.date === date && entry.kind === 'done')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

async function removeEntries(db: LocalDatabase, ids: readonly string[], now: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const revision = await localRevision(tx, 'habit_entries', id)
      if (revision !== null) await deleteHabitEntry(tx, id, revision, now)
    }
  })
}

export function HabitsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, ready, enabled, habitsVersion, write, writing } = useLedger()
  const [habits, setHabits] = useState<HabitRecord[] | null>(null)
  const [entries, setEntries] = useState<HabitEntryRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [today, setToday] = useState(isoToday)
  const [picked, setPicked] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [reloads, setReloads] = useState(0)
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const habitsRef = useRef(habits)
  habitsRef.current = habits
  /**
   * Check-offs show on screen before they are written. A read that lands while one is still
   * queued would briefly undo it, so reads wait until the queue is empty.
   */
  const pending = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!db || !ready) {
      setHabits(null)
      setEntries([])
      return
    }
    let active = true
    void Promise.all([localHabits(db), localHabitEntries(db)])
      .then(([nextHabits, nextEntries]) => {
        if (!active || pending.current > 0) return
        setHabits(nextHabits)
        setEntries(nextEntries)
      })
      .catch(() => { if (active) setError('This phone could not read its habits') })
    return () => { active = false }
  }, [db, ready, habitsVersion, reloads])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(isoToday())
    })
    return () => subscription.remove()
  }, [])

  const queued = useCallback((work: LocalWrite): Promise<boolean> => {
    const next = queue.current.then(() => write(work, 'habits'))
    queue.current = next.catch(() => undefined)
    return next
  }, [write])

  const optimistic = useCallback(async (
    apply: (current: HabitEntryRecord[]) => HabitEntryRecord[], work: LocalWrite, failure: string
  ): Promise<boolean> => {
    pending.current += 1
    setEntries((current) => {
      entriesRef.current = apply(current)
      return entriesRef.current
    })
    const saved = await queued(work).catch(() => false)
    pending.current -= 1
    if (!saved) setError(failure)
    if (pending.current === 0) setReloads((count) => count + 1)
    return saved
  }, [queued])

  const add = useCallback((habit: HabitRecord, date: string, kind: 'done' | 'slipped', failure: string): Promise<boolean> => {
    const id = newId()
    const now = new Date().toISOString()
    const input = { habitId: habit.id, date, kind, loggedAt: kind === 'slipped' ? now : null }
    return optimistic(
      (current) => [...current, { id, ...input, createdAt: now, updatedAt: now, revision: 1 }],
      async (database, at) => { await createHabitEntry(database, input, at, id) },
      failure)
  }, [optimistic])

  const removeEntry = useCallback((entryId: string): Promise<boolean> => optimistic(
    (current) => current.filter((entry) => entry.id !== entryId),
    (database, now) => removeEntries(database, [entryId], now),
    'This phone could not remove that entry'), [optimistic])

  const tap = useCallback(async (habit: HabitRecord, date: string): Promise<boolean> => {
    const existing = checkOffs(entriesRef.current, habit.id, date).map((entry) => entry.id)
    const toggles = habit.period === 'week' || habit.target === 1
    if (toggles && existing.length > 0) {
      return optimistic(
        (current) => current.filter((entry) => !existing.includes(entry.id)),
        (database, now) => removeEntries(database, existing, now),
        'This phone could not uncheck that habit')
    }
    if (!toggles && existing.length >= habit.target) return true
    return add(habit, date, 'done', 'This phone could not check off that habit')
  }, [add, optimistic])

  const takeBack = useCallback(async (habit: HabitRecord, date: string): Promise<boolean> => {
    const existing = checkOffs(entriesRef.current, habit.id, date)
    const latest = existing[existing.length - 1]
    return latest ? removeEntry(latest.id) : false
  }, [removeEntry])

  const restart = useCallback((habit: HabitRecord): Promise<boolean> =>
    add(habit, isoToday(), 'slipped', 'This phone could not restart the clock'), [add])

  const save = useCallback(async (input: HabitInput, habit: HabitRecord | null): Promise<boolean> => {
    if (!isHabitInput(input)) {
      setError('Give the habit a name and an emoji')
      return false
    }
    const saved = await queued(async (database, now) => {
      if (!habit) {
        await createHabit(database, input, now)
        return
      }
      const revision = await localRevision(database, 'habits', habit.id)
      if (revision === null) throw new Error('That habit was deleted')
      await updateHabit(database, habit.id, revision, input, now)
    })
    setError(saved ? null : 'This phone could not save that habit')
    return saved
  }, [queued])

  const remove = useCallback(async (habit: HabitRecord): Promise<boolean> => {
    const saved = await queued(async (database, now) => {
      const revision = await localRevision(database, 'habits', habit.id)
      if (revision !== null) await deleteHabit(database, habit.id, revision, now)
    })
    setError(saved ? null : 'This phone could not delete that habit')
    return saved
  }, [queued])

  /** Renumbers the whole list, so two habits that share a position still end up in order. */
  const move = useCallback(async (habit: HabitRecord, delta: -1 | 1): Promise<boolean> => {
    const list = (habitsRef.current ?? []).filter((item) => item.kind === habit.kind)
    const from = list.findIndex((item) => item.id === habit.id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= list.length) return false
    const order = [...list]
    order.splice(to, 0, ...order.splice(from, 1))
    const changed = order
      .map((item, position) => ({ item, position }))
      .filter(({ item, position }) => item.position !== position)
    const saved = await queued((database, now) => database.transaction(async (tx) => {
      for (const { item, position } of changed) {
        const revision = await localRevision(tx, 'habits', item.id)
        if (revision !== null) await updateHabit(tx, item.id, revision, habitInput(item, { position }), now)
      }
    }))
    if (!saved) setError('This phone could not reorder your habits')
    return saved
  }, [queued])

  const log = useMemo(() => buildLog(entries), [entries])
  const date = picked !== null && picked < today ? picked : today

  const value = useMemo<HabitsContextValue>(() => ({
    enabled,
    habits,
    log,
    today,
    date,
    setDate: (next) => setPicked(next >= today ? null : next),
    busy: writing,
    error,
    dismissError: () => setError(null),
    editor,
    openEditor: setEditor,
    closeEditor: () => setEditor(null),
    save,
    remove,
    move,
    tap,
    takeBack,
    restart,
    removeEntry
  }), [date, editor, enabled, error, habits, log, move, remove, removeEntry, restart, save, takeBack, tap, today, writing])

  return <HabitsContext.Provider value={value}>{children}</HabitsContext.Provider>
}

export function useHabits(): HabitsContextValue {
  const context = useContext(HabitsContext)
  if (!context) throw new Error('useHabits must be used inside HabitsProvider')
  return context
}
