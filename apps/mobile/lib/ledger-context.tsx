import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type {
  AccountBalance, FeedCursor, ReferenceData, TransactionFilters
} from '@ego/api-contracts'
import { moneyApiFor, type EgoApi } from './api-client'
import { datasetIdFor, openLocalDatabase } from './database'
import type { LocalDatabase } from './database/types'
import {
  localBalances, localReceipt, localReference, localTransaction, localTransactionPage,
  type LocalReceipt, type LocalFeedTransaction, type LocalTransactionPage
} from './repositories/transactions'
import { keepMine, useSavedVersion } from './sync/conflicts'
import { deleteTransaction, newId } from './sync/commands'
import { createSyncCoordinator, hasDownloaded, isBootstrapped, type SyncOutcome } from './sync/coordinator'
import { allOperations, type OutboxEntry } from './sync/outbox'
import { apiUrlFor, isSignedIn, useSettings } from './settings'

export type LocalWrite = (db: LocalDatabase, now: string) => Promise<void>

interface LedgerContextValue {
  /** Signed in, so this device keeps and syncs its own copy of the ledger. */
  enabled: boolean
  /** The local copy holds a complete download and screens can read it. */
  ready: boolean
  syncing: boolean
  writing: boolean
  error: string | null
  status: SyncOutcome | null
  reference: ReferenceData | null
  balances: AccountBalance[]
  conflicts: OutboxEntry[]
  /** Bumps whenever local data changes, so a screen knows to run its query again. */
  version: number
  db: LocalDatabase | null
  api: EgoApi
  feed: (filters: TransactionFilters, cursor: FeedCursor | null, size: number) => Promise<LocalTransactionPage>
  transaction: (id: string) => Promise<LocalFeedTransaction | null>
  receipt: (purchaseId: string) => Promise<LocalReceipt | null>
  sync: () => Promise<void>
  /** Commits one local change and its outbox entry, then delivers it in the background. */
  write: (work: LocalWrite) => Promise<boolean>
  removeTransaction: (transaction: LocalFeedTransaction) => Promise<boolean>
  removeTransactions: (transactions: LocalFeedTransaction[]) => Promise<boolean>
  resolveKeepMine: (entry: OutboxEntry) => Promise<void>
  resolveUseSaved: (entry: OutboxEntry) => Promise<void>
}

const LedgerContext = createContext<LedgerContextValue | null>(null)

const EMPTY_PAGE: LocalTransactionPage = {
  items: [], nextCursor: null, hasMore: false, totalCount: 0, queryIdentity: 'unavailable'
}

export function LedgerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { settings, loading: settingsLoading } = useSettings()
  const enabled = !settingsLoading && isSignedIn(settings)
  const apiUrl = apiUrlFor(settings)
  const [db, setDb] = useState<LocalDatabase | null>(null)
  const [ready, setReady] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncOutcome | null>(null)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [balances, setBalances] = useState<AccountBalance[]>([])
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([])
  const [version, setVersion] = useState(0)
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

  const refreshLocal = useCallback(async (database: LocalDatabase): Promise<void> => {
    const [nextReference, nextBalances, outbox] = await Promise.all([
      localReference(database), localBalances(database), allOperations(database)
    ])
    setReference(nextReference)
    setBalances(nextBalances)
    setConflicts(outbox.filter((entry) => entry.status === 'conflict' || entry.status === 'failed'))
    setVersion((current) => current + 1)
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
      const complete = await isBootstrapped(db)
      const changed = (!wasBootstrapped && complete) || outcome.delivered > 0 || outcome.applied > 0 ||
        outcome.conflictCount !== previous?.conflictCount
      if (changed) await refreshLocal(db)
      if (await hasDownloaded(db)) setReady(true)
    } finally {
      setSyncing(false)
    }
  }, [coordinator, db, refreshLocal])

  useEffect(() => {
    if (!db) return
    void (async () => {
      if (await hasDownloaded(db)) {
        await refreshLocal(db)
        setReady(true)
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

  const write = useCallback(async (work: LocalWrite): Promise<boolean> => {
    if (!db || writingRef.current) return false
    writingRef.current = true
    setWriting(true)
    try {
      await work(db, new Date().toISOString())
      await refreshLocal(db)
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

  const resolve = useCallback(async (work: (database: LocalDatabase) => Promise<void>): Promise<void> => {
    if (!db) return
    await work(db)
    await refreshLocal(db)
    void sync()
  }, [db, refreshLocal, sync])

  const value = useMemo((): LedgerContextValue => ({
    enabled,
    ready: enabled && ready,
    syncing,
    writing,
    error,
    status,
    reference,
    balances,
    conflicts,
    version,
    db,
    api,
    feed,
    transaction,
    receipt,
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
  }), [api, balances, conflicts, db, enabled, error, feed, ready, receipt, reference, resolve, status,
    sync, syncing, transaction, version, write, writing])

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
