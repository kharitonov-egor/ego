import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { ApiError } from '@ego/api-contracts'
import { useLedger } from '../ledger-context'
import type { LocalDatabase } from '../database/types'
import {
  cachedStudy, deliverStudyMarks, markStudyItem, refreshStudy, type StudyItem
} from './store'

const STALE_AFTER_MS = 5 * 60 * 1000

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
}

const StudyContext = createContext<StudyContextValue | null>(null)

function failureOf(error: unknown): ApiError {
  return { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Study could not refresh' }
}

export function StudyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, api } = useLedger()
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState<StudyItem[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const running = useRef<Promise<void> | null>(null)
  const delivery = useRef<Promise<unknown>>(Promise.resolve())
  const fetchedAtRef = useRef<string | null>(null)
  const refreshRef = useRef<(onlyIfStale?: boolean) => Promise<void>>(async () => undefined)

  const reload = useCallback(async (database: LocalDatabase): Promise<void> => {
    const cached = await cachedStudy(database)
    fetchedAtRef.current = cached.fetchedAt
    setItems(cached.items)
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
    setLoaded(false)
    setItems([])
    setFetchedAt(null)
    setError(null)
    if (!db) return
    void reload(db)
      .then(() => refreshRef.current(true))
      .catch((failure: unknown) => setError(failureOf(failure)))
  }, [db, reload])

  const setDone = useCallback(async (id: string, done: boolean): Promise<void> => {
    if (!db) return
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => item.id === id ? { ...item, doneAt: done ? now : null, pending: true } : item))
    try {
      await markStudyItem(db, id, done, now)
      delivery.current = delivery.current.then(() => deliverStudyMarks(db, api)).catch(() => undefined)
      await delivery.current
      await reload(db)
    } catch (failure: unknown) {
      setError(failureOf(failure))
    }
  }, [api, db, reload])

  useEffect(() => {
    if (!db) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(true)
    })
    return () => subscription.remove()
  }, [db, refresh])

  const value = useMemo((): StudyContextValue => ({
    loaded, items, fetchedAt, refreshing, error, refresh, setDone
  }), [error, fetchedAt, items, loaded, refresh, refreshing, setDone])

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>
}

export function useStudy(): StudyContextValue {
  const context = useContext(StudyContext)
  if (!context) throw new Error('useStudy must be used inside StudyProvider')
  return context
}
