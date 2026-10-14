import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { ApiError } from '@ego/api-contracts'
import type { StudyEntryInput } from '@ego/core'
import { useLedger, type LocalWrite } from '../ledger-context'
import type { LocalDatabase } from '@ego/local/database/types'
import {
  addStudyEntry, cachedStudy, deliverStudyMarks, editStudyEntry, markStudyEntry, markStudyItem, refreshStudy,
  removeStudyEntry, type StudyItem
} from '@ego/local/study/store'
import { newId } from '@ego/local/sync/commands'

const STALE_AFTER_MS = 5 * 60 * 1000
const HIDE_OVERDUE_KEY = 'ego.study.hideOverdue'
const WRITE_ATTEMPTS = 4
const WRITE_RETRY_MS = 250

interface StudyContextValue {
  /** The saved copy has been read, so an empty list means Canvas really has nothing. */
  loaded: boolean
  items: StudyItem[]
  fetchedAt: string | null
  refreshing: boolean
  /** The last refresh failed. The saved copy stays on screen. */
  error: ApiError | null
  /** With `onlyIfStale`, a copy younger than five minutes is kept as it is. */
  refresh: (onlyIfStale?: boolean) => Promise<void>
  setDone: (id: string, done: boolean) => Promise<void>
  /** Adds an assignment, exam, or deadline when `id` is null, and edits that one otherwise. */
  saveEntry: (id: string | null, input: StudyEntryInput) => Promise<boolean>
  deleteEntry: (id: string) => Promise<boolean>
  hideOverdue: boolean
  setHideOverdue: (hide: boolean) => void
}

const StudyContext = createContext<StudyContextValue | null>(null)

function failureOf(error: unknown): ApiError {
  return { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Study could not refresh' }
}

export function StudyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, api, studyVersion, write } = useLedger()
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<StudyItem[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [hideOverdue, setHideOverdueState] = useState(false)
  const running = useRef<Promise<void> | null>(null)
  const delivery = useRef<Promise<unknown>>(Promise.resolve())
  const fetchedAtRef = useRef<string | null>(null)
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const itemsRef = useRef<StudyItem[]>([])
  itemsRef.current = items
  /** Check marks on added items still waiting for their write, kept over any re-read until it lands. */
  const marking = useRef(new Map<string, string | null>())
  const refreshRef = useRef<(onlyIfStale?: boolean) => Promise<void>>(async () => undefined)

  const reload = useCallback(async (database: LocalDatabase): Promise<void> => {
    const cached = await cachedStudy(database)
    fetchedAtRef.current = cached.fetchedAt
    const waiting = marking.current
    setItems(waiting.size === 0 ? cached.items : cached.items.map((item) => waiting.has(item.id)
      ? { ...item, doneAt: waiting.get(item.id) ?? null, pending: true }
      : item))
    setFetchedAt(cached.fetchedAt)
    setLoaded(true)
  }, [])

  const refresh = useCallback(async (onlyIfStale = false): Promise<void> => {
    if (!db) return
    if (running.current) return running.current
    const last = fetchedAtRef.current ? Date.parse(fetchedAtRef.current) : 0
    if (onlyIfStale && Date.now() - last < STALE_AFTER_MS) return
    const work = (async () => {
      setRefreshing(true)
      try {
        const result = await refreshStudy(db, api)
        setError(result.ok ? null : result.error)
        await reload(db)
      } catch (failure: unknown) {
        setError(failureOf(failure))
      } finally {
        setRefreshing(false)
        running.current = null
      }
    })()
    running.current = work
    return work
  }, [api, db, reload])

  refreshRef.current = refresh

  useEffect(() => {
    void SecureStore.getItemAsync(HIDE_OVERDUE_KEY)
      .then((stored) => setHideOverdueState(stored === '1'))
      .catch(() => undefined)
  }, [])

  const setHideOverdue = useCallback((hide: boolean): void => {
    setHideOverdueState(hide)
    void SecureStore.setItemAsync(HIDE_OVERDUE_KEY, hide ? '1' : '0').catch(() => undefined)
  }, [])

  useEffect(() => {
    setLoaded(false)
    setItems([])
    setFetchedAt(null)
    setError(null)
    if (!db) return
    void reload(db)
      .then(() => refreshRef.current(true))
      .catch((failure: unknown) => setError(failureOf(failure)))
  }, [db, reload])

  useEffect(() => {
    if (!db) return
    void reload(db).catch((failure: unknown) => setError(failureOf(failure)))
  }, [db, reload, studyVersion])

  /**
   * The ledger turns away a write while any other app's write runs, so Study's writes wait their
   * turn and try a few more times before giving up.
   */
  const queued = useCallback((work: LocalWrite): Promise<boolean> => {
    const attempt = async (): Promise<boolean> => {
      for (let tries = 1; tries < WRITE_ATTEMPTS; tries += 1) {
        if (await write(work, 'study')) return true
        await new Promise((resolve) => setTimeout(resolve, WRITE_RETRY_MS))
      }
      return write(work, 'study')
    }
    const next = writes.current.then(attempt)
    writes.current = next.catch(() => undefined)
    return next
  }, [write])

  const saveEntry = useCallback((id: string | null, input: StudyEntryInput): Promise<boolean> => {
    if (id !== null) return queued((database, now) => editStudyEntry(database, id, input, now))
    const added = newId()
    return queued((database, now) => addStudyEntry(database, added, input, now))
  }, [queued])

  const deleteEntry = useCallback(async (id: string): Promise<boolean> => {
    setItems((current) => current.filter((item) => item.id !== id))
    const deleted = await queued((database, now) => removeStudyEntry(database, id, now))
    if (!deleted && db) {
      setError({ code: 'SERVER_ERROR', message: 'This phone could not delete that' })
      await reload(db)
    }
    return deleted
  }, [db, queued, reload])

  const setDone = useCallback(async (id: string, done: boolean): Promise<void> => {
    if (!db) return
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => item.id === id ? { ...item, doneAt: done ? now : null, pending: true } : item))
    if (itemsRef.current.find((item) => item.id === id)?.entry) {
      marking.current.set(id, done ? now : null)
      const saved = await queued((database, at) => markStudyEntry(database, id, done, at))
      if (marking.current.get(id) === (done ? now : null)) marking.current.delete(id)
      if (!saved) {
        setError({ code: 'SERVER_ERROR', message: 'This phone could not save that check mark' })
        await reload(db)
      }
      return
    }
    try {
      await markStudyItem(db, id, done, now)
      delivery.current = delivery.current.then(() => deliverStudyMarks(db, api)).catch(() => undefined)
      await delivery.current
      await reload(db)
    } catch (failure: unknown) {
      setError(failureOf(failure))
    }
  }, [api, db, queued, reload])

  useEffect(() => {
    if (!db) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(true)
    })
    return () => subscription.remove()
  }, [db, refresh])

  const value = useMemo((): StudyContextValue => ({
    loaded, items, fetchedAt, refreshing, error, refresh, setDone, saveEntry, deleteEntry, hideOverdue, setHideOverdue
  }), [deleteEntry, error, fetchedAt, hideOverdue, items, loaded, refresh, refreshing, saveEntry, setDone, setHideOverdue])

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>
}

export function useStudy(): StudyContextValue {
  const context = useContext(StudyContext)
  if (!context) throw new Error('useStudy must be used inside StudyProvider')
  return context
}
