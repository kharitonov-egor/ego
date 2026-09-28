import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type {
  AccountBalance, FeedCursor, ReferenceData, TransactionFilters
} from '@ego/api-contracts'
import { moneyApiFor, type EgoApi } from './api-client'
import { datasetIdFor, openLocalDatabase } from './database'
import type { LocalDatabase } from './database/types'
import {
  localBalances, localPurchasePage, localReceipt, localReference, localTransaction, localTransactionPage,
  type LocalPurchasePage, type LocalReceipt, type LocalFeedTransaction, type LocalTransactionPage
} from './repositories/transactions'
import { keepMine, useSavedVersion } from './sync/conflicts'
import { deleteTransaction, newId } from './sync/commands'
import { createSyncCoordinator, hasDownloaded, isBootstrapped, type SyncOutcome } from './sync/coordinator'
import { allOperations, type OutboxEntry } from './sync/outbox'
import { apiUrlFor, isSignedIn, useSettings } from './settings'

export type LocalWrite = (db: LocalDatabase, now: string) => Promise<void>

/** Which screens re-read after a write. A logged set should not rebuild the money snapshot. */
export type WriteScope = 'money' | 'gym' | 'health' | 'habits'

interface RefreshScope {
  money: boolean
  gym: boolean
  health: boolean
  habits: boolean
}

const EVERYTHING: RefreshScope = { money: true, gym: true, health: true, habits: true }

interface LedgerContextValue {
  /** Signed in, so this device keeps and syncs its own copy of the ledger. */
  enabled: boolean
  /** The local copy holds a complete download and screens can read it. */
  ready: boolean
  /**
   * That download is in the current format. Money screens read an older one while the phone
   * downloads again; the gym log only exists in the current one.
   */
  current: boolean
  syncing: boolean
  writing: boolean
  error: string | null
  status: SyncOutcome | null
  reference: ReferenceData | null
  balances: AccountBalance[]
  conflicts: OutboxEntry[]
  /** Bumps whenever local money data changes, so a screen knows to run its query again. */
  version: number
  /** The same for the gym log. */
  gymVersion: number
  /** The same for mood entries. */
  healthVersion: number
  /** The same for habits and their check-ins. */
  habitsVersion: number
  db: LocalDatabase | null
  api: EgoApi
  feed: (filters: TransactionFilters, cursor: FeedCursor | null, size: number) => Promise<LocalTransactionPage>
  transaction: (id: string) => Promise<LocalFeedTransaction | null>
  receipt: (purchaseId: string) => Promise<LocalReceipt | null>
  purchasePage: (size: number, offset?: number) => Promise<LocalPurchasePage>
  sync: () => Promise<void>
  /** Commits one local change and its outbox entry, then delivers it in the background. */
  write: (work: LocalWrite, scope?: WriteScope) => Promise<boolean>
  removeTransaction: (transaction: LocalFeedTransaction) => Promise<boolean>
  removeTransactions: (transactions: LocalFeedTransaction[]) => Promise<boolean>
  resolveKeepMine: (entry: OutboxEntry) => Promise<void>
  resolveUseSaved: (entry: OutboxEntry) => Promise<void>
}

const LedgerContext = createContext<LedgerContextValue | null>(null)

const EMPTY_PAGE: LocalTransactionPage = {
  items: [], nextCursor: null, hasMore: false, totalCount: null, queryIdentity: 'unavailable'
}

export function LedgerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { settings, loading: settingsLoading } = useSettings()
  const enabled = !settingsLoading && isSignedIn(settings)
  const apiUrl = apiUrlFor(settings)
  const [db, setDb] = useState<LocalDatabase | null>(null)
  const [ready, setReady] = useState(false)
  const [current, setCurrent] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncOutcome | null>(null)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [balances, setBalances] = useState<AccountBalance[]>([])
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([])
  const [version, setVersion] = useState(0)
  const [gymVersion, setGymVersion] = useState(0)
  const [healthVersion, setHealthVersion] = useState(0)
  const [habitsVersion, setHabitsVersion] = useState(0)
  const generation = useRef(0)
  const writingRef = useRef(false)
  const lastStatus = useRef<SyncOutcome | null>(null)

  const api = useMemo(
    () => moneyApiFor({ url: apiUrl, token: settings.deviceToken }),
    [apiUrl, settings.deviceToken])

  useEffect(() => {
    if (!enabled) {
      setDb(null)
      setReady(false)
      setCurrent(false)
      setStatus(null)
      return
    }
    let cancelled = false
    generation.current += 1
    const started = generation.current
    setReady(false)
    void (async () => {
      try {
        const opened = await openLocalDatabase(datasetIdFor(apiUrl))
        if (cancelled || started !== generation.current) {
          await opened.close()
          return
        }
        setDb(opened)
        setError(null)
      } catch (failure: unknown) {
        const detail = failure instanceof Error ? failure.message : 'The local database did not open'
        if (!cancelled) setError(detail)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, apiUrl])

  const coordinator = useMemo(() => db ? createSyncCoordinator({
    db, api, now: () => new Date().toISOString()
  }) : null, [api, db])

  const refreshLocal = useCallback(async (database: LocalDatabase, scope: RefreshScope): Promise<void> => {
    const outbox = await allOperations(database)
    setConflicts(outbox.filter((entry) => entry.status === 'conflict' || entry.status === 'failed'))
    if (scope.money) {
      const [nextReference, nextBalances] = await Promise.all([localReference(database), localBalances(database)])
      setReference(nextReference)
      setBalances(nextBalances)
      setVersion((current) => current + 1)
    }
    if (scope.gym) setGymVersion((current) => current + 1)
    if (scope.health) setHealthVersion((current) => current + 1)
    if (scope.habits) setHabitsVersion((current) => current + 1)
  }, [])

  const sync = useCallback(async (): Promise<void> => {
    if (!db || !coordinator) return
    setSyncing(true)
    try {
      const wasBootstrapped = await isBootstrapped(db)
      const outcome = await coordinator.sync()
      const previous = lastStatus.current
      lastStatus.current = outcome
      setStatus(outcome)
      const downloaded = !wasBootstrapped && await isBootstrapped(db)
      const scope: RefreshScope = {
        money: downloaded || outcome.touched.money,
        gym: downloaded || outcome.touched.gym,
        health: downloaded || outcome.touched.health,
        habits: downloaded || outcome.touched.habits
      }
      if (scope.money || scope.gym || scope.health || scope.habits || outcome.conflictCount !== previous?.conflictCount) await refreshLocal(db, scope)
      if (await hasDownloaded(db)) setReady(true)
      setCurrent(await isBootstrapped(db))
    } finally {
      setSyncing(false)
    }
  }, [coordinator, db, refreshLocal])

  useEffect(() => {
    if (!db) return
    void (async () => {
      if (await hasDownloaded(db)) {
        await refreshLocal(db, EVERYTHING)
        setReady(true)
        setCurrent(await isBootstrapped(db))
      }
      await sync()
    })()
  }, [db, refreshLocal, sync])

  useEffect(() => {
    if (!db) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync()
    })
    return () => subscription.remove()
  }, [db, sync])

  const write = useCallback(async (work: LocalWrite, scope: WriteScope = 'money'): Promise<boolean> => {
    if (!db || writingRef.current) return false
    writingRef.current = true
    setWriting(true)
    try {
      await work(db, new Date().toISOString())
      await refreshLocal(db, {
        money: scope === 'money', gym: scope === 'gym', health: scope === 'health', habits: scope === 'habits'
      })
      void sync()
      return true
    } catch {
      return false
    } finally {
      writingRef.current = false
      setWriting(false)
    }
  }, [db, refreshLocal, sync])

  const feed = useCallback(async (filters: TransactionFilters, cursor: FeedCursor | null, size: number) =>
    db ? localTransactionPage(db, filters, cursor, size) : EMPTY_PAGE, [db])
  const transaction = useCallback(async (id: string) => db ? localTransaction(db, id) : null, [db])
  const receipt = useCallback(async (purchaseId: string) => db ? localReceipt(db, purchaseId) : null, [db])
  const purchasePage = useCallback(async (size: number, offset = 0) => db
    ? localPurchasePage(db, size, offset)
    : { items: [], nextOffset: null }, [db])

  const resolve = useCallback(async (work: (database: LocalDatabase) => Promise<void>): Promise<void> => {
    if (!db) return
    await work(db)
    await refreshLocal(db, EVERYTHING)
    void sync()
  }, [db, refreshLocal, sync])

  const value = useMemo((): LedgerContextValue => ({
    enabled,
    ready: enabled && ready,
    current: enabled && ready && current,
    syncing,
    writing,
    error,
    status,
    reference,
    balances,
    conflicts,
    version,
    gymVersion,
    healthVersion,
    habitsVersion,
    db,
    api,
    feed,
    transaction,
    receipt,
    purchasePage,
    sync,
    write,
    removeTransaction: (row) => write((database, now) =>
      deleteTransaction(database, row.id, row.revision, now).then(() => undefined)),
    removeTransactions: (rows) => write((database, now) => database.transaction(async (tx) => {
      for (const row of rows) await deleteTransaction(tx, row.id, row.revision, now)
    })),
    resolveKeepMine: (entry) => resolve((database) =>
      keepMine(database, entry, newId(), new Date().toISOString()).then(() => undefined)),
    resolveUseSaved: (entry) => resolve((database) => useSavedVersion(database, entry, new Date().toISOString()))
  }), [api, balances, conflicts, current, db, enabled, error, feed, gymVersion, habitsVersion, healthVersion, purchasePage, ready, receipt, reference, resolve,
    status, sync, syncing, transaction, version, write, writing])

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
}

export function useLedger(): LedgerContextValue {
  const context = useContext(LedgerContext)
  if (!context) throw new Error('useLedger must be used inside LedgerProvider')
  return context
}

export function syncLabel(status: SyncOutcome | null): string {
  if (!status) return 'Not synced yet'
  if (status.state === 'paused') return 'Sign in again to sync'
  if (status.state === 'attention') return `${status.conflictCount} need attention`
  if (status.state === 'offline') return status.pendingCount > 0 ? `Offline, ${status.pendingCount} pending` : 'Offline'
  if (status.pendingCount > 0) return `${status.pendingCount} pending`
  return 'Synced'
}
