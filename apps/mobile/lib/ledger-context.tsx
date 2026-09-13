import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type {
  AccountBalance, FeedCursor, ReferenceData, TransactionFilters
} from '@ego/api-contracts'
import type { PurchaseInput, TransactionInput } from '@ego/core'
import { moneyApiFor } from './api-client'
import { datasetIdFor, openLocalDatabase } from './database'
import type { LocalDatabase } from './database/types'
import {
  localBalances, localReceipt, localReference, localTransaction, localTransactionPage,
  type LocalReceipt, type LocalFeedTransaction, type LocalTransactionPage
} from './repositories/transactions'
import { keepMine, useSavedVersion } from './sync/conflicts'
import {
  createPurchase, createTransaction, deletePurchase, deleteTransaction, newId, updatePurchase,
  updateTransaction
} from './sync/commands'
import { createSyncCoordinator, type SyncOutcome } from './sync/coordinator'
import { allOperations, type OutboxEntry } from './sync/outbox'
import { usesLocalLedger, useSettings } from './settings'

interface LedgerContextValue {
  enabled: boolean
  ready: boolean
  error: string | null
  status: SyncOutcome | null
  reference: ReferenceData | null
  balances: AccountBalance[]
  conflicts: OutboxEntry[]
  /** Bumps whenever local data changes, so a screen knows to run its query again. */
  version: number
  feed: (filters: TransactionFilters, cursor: FeedCursor | null, size: number) => Promise<LocalTransactionPage>
  transaction: (id: string) => Promise<LocalFeedTransaction | null>
  receipt: (purchaseId: string) => Promise<LocalReceipt | null>
  sync: () => Promise<void>
  saveTransaction: (input: TransactionInput, existing?: LocalFeedTransaction) => Promise<boolean>
  removeTransaction: (transaction: LocalFeedTransaction) => Promise<boolean>
  removeTransactions: (transactions: LocalFeedTransaction[]) => Promise<boolean>
  saveReceipt: (input: PurchaseInput, purchaseId?: string, revision?: number) => Promise<boolean>
  removeReceipt: (purchaseId: string, revision: number) => Promise<boolean>
  resolveKeepMine: (entry: OutboxEntry) => Promise<void>
  resolveUseSaved: (entry: OutboxEntry) => Promise<void>
}

const LedgerContext = createContext<LedgerContextValue | null>(null)

const EMPTY_PAGE: LocalTransactionPage = {
  items: [], nextCursor: null, hasMore: false, totalCount: 0, queryIdentity: 'unavailable'
}

export function LedgerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { settings, loading: settingsLoading } = useSettings()
  const enabled = !settingsLoading && usesLocalLedger(settings)
  const [db, setDb] = useState<LocalDatabase | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<SyncOutcome | null>(null)
  const [reference, setReference] = useState<ReferenceData | null>(null)
  const [balances, setBalances] = useState<AccountBalance[]>([])
  const [conflicts, setConflicts] = useState<OutboxEntry[]>([])
  const [version, setVersion] = useState(0)
  const generation = useRef(0)

  const api = useMemo(
    () => moneyApiFor({ url: settings.moneyApiUrl, token: settings.moneyDeviceToken }),
    [settings.moneyApiUrl, settings.moneyDeviceToken])

  useEffect(() => {
    if (!enabled) {
      setDb(null)
      setReady(false)
      return
    }
    let cancelled = false
    generation.current += 1
    const started = generation.current
    setReady(false)
    void (async () => {
      try {
        const opened = await openLocalDatabase(datasetIdFor(settings.moneyApiUrl))
        if (cancelled || started !== generation.current) {
          await opened.close()
          return
        }
        setDb(opened)
        setError(null)
      } catch {
        if (!cancelled) setError('The device could not open its local ledger')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, settings.moneyApiUrl])

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
    const outcome = await coordinator.sync()
    setStatus(outcome)
    await refreshLocal(db)
    setReady(true)
  }, [coordinator, db, refreshLocal])

  useEffect(() => {
    if (!db) return
    void (async () => {
      await refreshLocal(db)
      setReady(true)
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

  const afterWrite = useCallback(async (): Promise<boolean> => {
    if (!db) return false
    await refreshLocal(db)
    void sync()
    return true
  }, [db, refreshLocal, sync])

  const value: LedgerContextValue = {
    enabled,
    ready: enabled && ready,
    error,
    status,
    reference,
    balances,
    conflicts,
    version,
    feed: async (filters, cursor, size) => db ? localTransactionPage(db, filters, cursor, size) : EMPTY_PAGE,
    transaction: async (id) => db ? localTransaction(db, id) : null,
    receipt: async (purchaseId) => db ? localReceipt(db, purchaseId) : null,
    sync,
    saveTransaction: async (input, existing) => {
      if (!db) return false
      const now = new Date().toISOString()
      if (existing) await updateTransaction(db, existing.id, existing.revision, input, now)
      else await createTransaction(db, input, now, newId())
      return afterWrite()
    },
    removeTransaction: async (transaction) => {
      if (!db) return false
      await deleteTransaction(db, transaction.id, transaction.revision, new Date().toISOString())
      return afterWrite()
    },
    removeTransactions: async (transactions) => {
      if (!db) return false
      const now = new Date().toISOString()
      for (const transaction of transactions) {
        await deleteTransaction(db, transaction.id, transaction.revision, now)
      }
      return afterWrite()
    },
    saveReceipt: async (input, purchaseId, revision) => {
      if (!db) return false
      const now = new Date().toISOString()
      if (purchaseId && revision !== undefined) await updatePurchase(db, purchaseId, revision, input, now)
      else await createPurchase(db, input, now, newId())
      return afterWrite()
    },
    removeReceipt: async (purchaseId, revision) => {
      if (!db) return false
      await deletePurchase(db, purchaseId, revision, new Date().toISOString())
      return afterWrite()
    },
    resolveKeepMine: async (entry) => {
      if (!db) return
      await keepMine(db, entry, newId(), new Date().toISOString())
      await afterWrite()
    },
    resolveUseSaved: async (entry) => {
      if (!db) return
      await useSavedVersion(db, entry, new Date().toISOString())
      await afterWrite()
    }
  }

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
}

export function useLedger(): LedgerContextValue {
  const context = useContext(LedgerContext)
  if (!context) throw new Error('useLedger must be used inside LedgerProvider')
  return context
}

export function syncLabel(status: SyncOutcome | null): string {
  if (!status) return 'Not synced yet'
  if (status.state === 'paused') return 'Reconnect this device'
  if (status.state === 'attention') return `${status.conflictCount} need attention`
  if (status.state === 'offline') return status.pendingCount > 0 ? `Offline, ${status.pendingCount} pending` : 'Offline'
  if (status.pendingCount > 0) return `${status.pendingCount} pending`
  return 'Synced'
}
