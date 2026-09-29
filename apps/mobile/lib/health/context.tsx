import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import type { ApiError, HealthConnection, HealthDay, HealthHeartDay, HealthSleep } from '@ego/api-contracts'
import type { HealthUnits } from '@ego/core'
import type { LocalDatabase } from '../database/types'
import { isoToday } from '../dates'
import { useLedger } from '../ledger-context'
import { buildHealthIndex, type HealthIndex } from './metrics'
import { cachedHealth, refreshHealth } from './store'

/** The Worker skips a Google pull made within a minute of the last one, so asking sooner gains nothing. */
const STALE_AFTER_MS = 60_000
/** A year arrives in about five slices. The cap stops a loop if the Worker keeps answering the same one. */
const MAX_HISTORY_ROUNDS = 6
const UNITS_KEY = 'ego.health.units'

interface HealthContextValue {
  /** The saved copy has been read, so empty data means Google Health really has nothing yet. */
  loaded: boolean
  connection: HealthConnection | null
  index: HealthIndex
  fetchedAt: string | null
  refreshing: boolean
  /** Still bringing in the first year, one slice per request. */
  downloadingHistory: boolean
  error: ApiError | null
  dismissError: () => void
  /** With `onlyIfStale`, a copy younger than a minute is kept as it is. */
  refresh: (onlyIfStale?: boolean) => Promise<void>
  connecting: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<boolean>
  units: HealthUnits
  setUnits: (units: HealthUnits) => void
  today: string
}

const HealthContext = createContext<HealthContextValue | null>(null)

function failureOf(error: unknown): ApiError {
  return { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'Health could not refresh' }
}

function phoneTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export function HealthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, api } = useLedger()
  const [loaded, setLoaded] = useState(false)
  const [connection, setConnection] = useState<HealthConnection | null>(null)
  const [days, setDays] = useState<HealthDay[]>([])
  const [sleeps, setSleeps] = useState<HealthSleep[]>([])
  const [heart, setHeart] = useState<HealthHeartDay[]>([])
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [downloadingHistory, setDownloadingHistory] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [units, setUnitsState] = useState<HealthUnits>('imperial')
  const [today, setToday] = useState(isoToday)
  const running = useRef<Promise<void> | null>(null)
  const fetchedAtRef = useRef<string | null>(null)
  /** Set while Google's consent page is open, so the return to Ego always syncs. */
  const awaitingConsent = useRef(false)
  const refreshRef = useRef<(onlyIfStale?: boolean) => Promise<void>>(async () => undefined)

  const reload = useCallback(async (database: LocalDatabase): Promise<void> => {
    const cached = await cachedHealth(database)
    fetchedAtRef.current = cached.fetchedAt
    setConnection(cached.connection)
    setDays(cached.days)
    setSleeps(cached.sleeps)
    setHeart(cached.heart)
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
        let reached: string | null | undefined
        for (let round = 0; round < MAX_HISTORY_ROUNDS; round += 1) {
          const result = await refreshHealth(db, api, {
            sync: true, timeZone: phoneTimeZone(), now: new Date().toISOString(), today: isoToday()
          })
          if (!result.ok) {
            setError(result.error)
            break
          }
          setError(null)
          await reload(db)
          const current = result.data
          if (!current.connected || current.historyComplete || current.historyFrom === reached) break
          reached = current.historyFrom
          setDownloadingHistory(true)
        }
      } catch (failure: unknown) {
        setError(failureOf(failure))
      } finally {
        setRefreshing(false)
        setDownloadingHistory(false)
        running.current = null
      }
    })()
    running.current = work
    return work
  }, [api, db, reload])

  refreshRef.current = refresh

  useEffect(() => {
    void SecureStore.getItemAsync(UNITS_KEY)
      .then((stored) => { if (stored === 'metric' || stored === 'imperial') setUnitsState(stored) })
      .catch(() => undefined)
  }, [])

  const setUnits = useCallback((next: HealthUnits): void => {
    setUnitsState(next)
    void SecureStore.setItemAsync(UNITS_KEY, next).catch(() => undefined)
  }, [])

  useEffect(() => {
    setLoaded(false)
    setConnection(null)
    setDays([])
    setSleeps([])
    setHeart([])
    setFetchedAt(null)
    setError(null)
    if (!db) return
    void reload(db)
      .then(() => refreshRef.current(true))
      .catch((failure: unknown) => setError(failureOf(failure)))
  }, [db, reload])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      setToday(isoToday())
      const returning = awaitingConsent.current
      awaitingConsent.current = false
      void refreshRef.current(!returning)
    })
    return () => subscription.remove()
  }, [])

  const connect = useCallback(async (): Promise<void> => {
    setConnecting(true)
    try {
      const result = await api.healthConnect()
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

  const disconnect = useCallback(async (): Promise<boolean> => {
    const result = await api.healthDisconnect()
    if (!result.ok) {
      setError(result.error)
      return false
    }
    await refreshRef.current(false)
    return true
  }, [api])

  const index = useMemo(() => buildHealthIndex(days, sleeps, heart), [days, heart, sleeps])
  const dismissError = useCallback(() => setError(null), [])

  const value = useMemo((): HealthContextValue => ({
    loaded, connection, index, fetchedAt, refreshing, downloadingHistory, error, dismissError, refresh,
    connecting, connect, disconnect, units, setUnits, today
  }), [connect, connecting, connection, disconnect, dismissError, downloadingHistory, error, fetchedAt, index,
    loaded, refresh, refreshing, setUnits, today, units])

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>
}

export function useHealth(): HealthContextValue {
  const context = useContext(HealthContext)
  if (!context) throw new Error('useHealth must be used inside HealthProvider')
  return context
}
