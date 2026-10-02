import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { AccountBalance, FeedCursor, ReferenceData, TransactionFilters } from '@ego/api-contracts'
import type { LocalDatabase } from '@ego/local/database/types'
import {
  localBalances, localPurchasePage, localReceipt, localReference, localTransaction, localTransactionPage,
  type LocalFeedTransaction, type LocalPurchasePage, type LocalReceipt, type LocalTransactionPage
} from '@ego/local/repositories/transactions'
import { keepMine, useSavedVersion } from '@ego/local/sync/conflicts'
import { deleteTransaction, newId } from '@ego/local/sync/commands'
import type { SyncOutcome, Touched } from '@ego/local/sync/coordinator'
import { allOperations, type OutboxEntry } from '@ego/local/sync/outbox'
import type { LedgerState, RemoteApi, SignedInAccount } from '../../shared/local'
import { remoteApi, remoteDatabase } from './remote'

export type LocalWrite = (db: LocalDatabase, now: string) => Promise<void>

/** Which screens re-read after a write. A logged set should not rebuild the money screens. */
export type WriteScope = 'money' | 'gym' | 'health' | 'habits' | 'diary' | 'tasks' | 'sheets'

const EVERYTHING: Touched = {
  money: true, gym: true, health: true, habits: true, diary: true, tasks: true, sheets: true
}

/** Alt-tabbing back is frequent on a desktop; a sync per return would mostly find nothing. */
const FOCUS_SYNC_GAP_MS = 60 * 1000

const SIGNED_OUT: LedgerState = {
  signedIn: false, apiUrl: '', account: null, ready: false, current: false, syncing: false, status: null, error: null, syncError: null
}

interface LedgerContextValue {
  /** Signed in, so this computer keeps and syncs its own copy of the ledger. */
  enabled: boolean
  /** The first answer from the main process has arrived. */
  loaded: boolean
  /** The local copy holds a complete download and screens can read it. */
  ready: boolean
  /** That download is in the current format. */
  current: boolean
  syncing: boolean
  writing: boolean
  /** The database did not open; nothing can be read until it does. */
  error: string | null
  /** The last sync stopped on something other than the network. Local data still works. */
  syncError: string | null
  status: SyncOutcome | null
  apiUrl: string
  account: SignedInAccount | null
  reference: ReferenceData | null
  balances: AccountBalance[]
  conflicts: OutboxEntry[]
  /** Bumps whenever local money data changes, so a screen knows to run its query again. */
  version: number
  gymVersion: number
  healthVersion: number
  habitsVersion: number
  diaryVersion: number
  tasksVersion: number
  sheetsVersion: number
  db: LocalDatabase | null
  api: RemoteApi
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

function only(scope: WriteScope): Touched {
  return {
    money: scope === 'money', gym: scope === 'gym', health: scope === 'health', habits: scope === 'habits',
    diary: scope === 'diary', tasks: scope === 'tasks', sheets: scope === 'sheets'
  }
}

export function LedgerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<LedgerState>(SIGNED_OUT)
  const [loaded, setLoaded] = useState(false)
  const [writing, setWriting] = useState(false)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [balances, setBalances] = useState<AccountBalance[]>([])
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([])
  const [version, setVersion] = useState(0)
  const [gymVersion, setGymVersion] = useState(0)
  const [healthVersion, setHealthVersion] = useState(0)
  const [habitsVersion, setHabitsVersion] = useState(0)
  const [diaryVersion, setDiaryVersion] = useState(0)
  const [tasksVersion, setTasksVersion] = useState(0)
  const [sheetsVersion, setSheetsVersion] = useState(0)
  const writingRef = useRef(false)
  const lastSync = useRef(0)
  /** Set until a full re-read has run against a ready database: at launch and after sign-in or a server change. */
  const needsFullRefresh = useRef(true)
  const db = state.signedIn && !state.error ? remoteDatabase : null

  const refreshLocal = useCallback(async (scope: Touched): Promise<void> => {
    const outbox = await allOperations(remoteDatabase)
    setConflicts(outbox.filter((entry) => entry.status === 'conflict' || entry.status === 'failed'))
    if (scope.money) {
      const [nextReference, nextBalances] = await Promise.all([localReference(remoteDatabase), localBalances(remoteDatabase)])
      setReference(nextReference)
      setBalances(nextBalances)
      setVersion((current) => current + 1)
    }
    if (scope.gym) setGymVersion((current) => current + 1)
    if (scope.health) setHealthVersion((current) => current + 1)
    if (scope.habits) setHabitsVersion((current) => current + 1)
    if (scope.diary) setDiaryVersion((current) => current + 1)
    if (scope.tasks) setTasksVersion((current) => current + 1)
    if (scope.sheets) setSheetsVersion((current) => current + 1)
  }, [])

  const sync = useCallback(async (): Promise<void> => {
    lastSync.current = Date.now()
    await window.api.ledgerSync()
  }, [])

  useEffect(() => {
    let active = true
    const refreshWhenReady = (state: LedgerState, touched: Touched | null): void => {
      if (!state.signedIn || state.error) {
        setReference(null)
        setBalances([])
        setConflicts([])
        return
      }
      if (!state.ready) return
      if (needsFullRefresh.current) {
        needsFullRefresh.current = false
        void refreshLocal(EVERYTHING).catch(() => { needsFullRefresh.current = true })
      } else if (touched) {
        void refreshLocal(touched).catch(() => undefined)
      }
    }
    const unsubscribe = window.api.onLedgerEvent((event) => {
      if (!active) return
      if (event.reopened) needsFullRefresh.current = true
      setState(event.state)
      refreshWhenReady(event.state, event.touched)
    })
    void window.api.ledgerState().then((initial) => {
      if (!active) return
      setState(initial)
      setLoaded(true)
      refreshWhenReady(initial, null)
      if (initial.signedIn) void sync()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [refreshLocal, sync])

  useEffect(() => {
    if (!state.signedIn) return
    const onFocus = (): void => {
      if (Date.now() - lastSync.current >= FOCUS_SYNC_GAP_MS) void sync()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [state.signedIn, sync])

  const write = useCallback(async (work: LocalWrite, scope: WriteScope = 'money'): Promise<boolean> => {
    if (!db || writingRef.current) return false
    writingRef.current = true
    setWriting(true)
    try {
      await work(db, new Date().toISOString())
      await refreshLocal(only(scope))
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
    await refreshLocal(EVERYTHING)
    void sync()
  }, [db, refreshLocal, sync])

  const value = useMemo((): LedgerContextValue => ({
    enabled: state.signedIn,
    loaded,
    ready: state.signedIn && state.ready,
    current: state.signedIn && state.ready && state.current,
    syncing: state.syncing,
    writing,
    error: state.error,
    syncError: state.syncError,
    status: state.status,
    apiUrl: state.apiUrl,
    account: state.account,
    reference,
    balances,
    conflicts,
    version,
    gymVersion,
    healthVersion,
    habitsVersion,
    diaryVersion,
    tasksVersion,
    sheetsVersion,
    db,
    api: remoteApi,
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
  }), [balances, conflicts, db, diaryVersion, feed, gymVersion, habitsVersion, healthVersion, loaded, purchasePage,
    receipt, reference, resolve, sheetsVersion, state, sync, tasksVersion, transaction, version, write, writing])

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
