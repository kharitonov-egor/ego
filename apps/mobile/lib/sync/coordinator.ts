import {
  MAX_OPERATIONS_PER_REQUEST, MAX_PAGE_SIZE, NO_TRANSACTION_FILTERS,
  type ApiError, type ChangeRecord, type FeedCursor, type OperationOutcome, type SyncEntity
} from '@ego/api-contracts'
import type { MoneyApi } from '../api-client'
import type { LocalDatabase } from '../database/types'
import { writeFeedTransaction, writeRecord, writeTombstone } from '../database/writes'
import {
  hasPendingFor, markConflict, markFailed, readyOperations, removeOperation, scheduleRetry,
  toOperation
} from './outbox'

const TABLES: Record<SyncEntity, string> = {
  account: 'accounts',
  category: 'categories',
  transaction: 'transactions',
  purchase: 'purchases',
  budget: 'budgets'
}

export interface SyncDeps {
  db: LocalDatabase
  api: MoneyApi
  now: () => string
  random?: () => number
}

export type SyncState = 'synced' | 'pending' | 'attention' | 'paused' | 'offline'

export interface SyncOutcome {
  state: SyncState
  delivered: number
  applied: number
  pendingCount: number
  conflictCount: number
  serverSequence: number
  message: string | null
}

interface SyncStateRow {
  server_sequence: number
  bootstrapped_at: string | null
}

async function syncStateRow(db: LocalDatabase): Promise<SyncStateRow> {
  const rows = await db.all<SyncStateRow>('SELECT server_sequence, bootstrapped_at FROM sync_state WHERE id = 1')
  return rows[0] ?? { server_sequence: 0, bootstrapped_at: null }
}

export async function isBootstrapped(db: LocalDatabase): Promise<boolean> {
  return (await syncStateRow(db)).bootstrapped_at !== null
}

/**
 * Downloads reference data and bounded transaction pages, then records the sequence the
 * download started from. The cursor is written last, so an interrupted bootstrap restarts
 * instead of leaving the device believing it is up to date.
 */
export async function bootstrap(deps: SyncDeps): Promise<ApiError | null> {
  const { db, api, now } = deps
  const reference = await api.reference()
  if (!reference.ok) return reference.error
  const startedAt = reference.data.serverSequence
  await db.transaction(async (tx) => {
    for (const account of reference.data.accounts) await writeRecord(tx, { entity: 'account', record: account })
    for (const category of reference.data.categories) await writeRecord(tx, { entity: 'category', record: category })
  })
  let cursor: FeedCursor | null = null
  for (;;) {
    const page = await api.transactions(NO_TRANSACTION_FILTERS, cursor, MAX_PAGE_SIZE)
    if (!page.ok) return page.error
    await db.transaction(async (tx) => {
      for (const row of page.data.items) await writeFeedTransaction(tx, row)
    })
    const last = page.data.items[page.data.items.length - 1]
    if (!page.data.hasMore || !last) break
    cursor = { date: last.date, createdAt: last.createdAt, id: last.id }
  }
  await db.transaction(async (tx) => {
    await tx.run('UPDATE sync_state SET server_sequence = ?, bootstrapped_at = ? WHERE id = 1',
      [startedAt, now()])
  })
  return null
}

async function applyOutcome(db: LocalDatabase, outcome: OperationOutcome): Promise<void> {
  await db.transaction(async (tx) => {
    const column = outcome.entity === 'budget' ? 'month' : 'id'
    await tx.run(
      `UPDATE ${TABLES[outcome.entity]} SET revision = ? WHERE ${column} = ? AND revision < ?`,
      [outcome.revision, outcome.entityId, outcome.revision])
    await tx.run('DELETE FROM outbox WHERE operation_id = ?', [outcome.operationId])
  })
}

async function applyChange(db: LocalDatabase, change: ChangeRecord, deletedAt: string): Promise<void> {
  if (await hasPendingFor(db, change.entity, change.entityId)) return
  if (change.action === 'delete' || change.record === null) {
    await writeTombstone(db, change.entity, change.entityId, change.revision, deletedAt)
    return
  }
  await writeRecord(db, change)
}

async function pullChanges(deps: SyncDeps): Promise<{ error: ApiError | null; applied: number; sequence: number }> {
  const { db, api } = deps
  let sequence = (await syncStateRow(db)).server_sequence
  let applied = 0
  for (;;) {
    const page = await api.changes(sequence, 200)
    if (!page.ok) return { error: page.error, applied, sequence }
    if (page.data.changes.length === 0) return { error: null, applied, sequence }
    await db.transaction(async (tx) => {
      for (const change of page.data.changes) {
        await applyChange(tx, change, change.committedAt)
        applied += 1
      }
      await tx.run('UPDATE sync_state SET server_sequence = ? WHERE id = 1', [page.data.cursor])
    })
    sequence = page.data.cursor
    if (!page.data.hasMore) return { error: null, applied, sequence }
  }
}

async function deliver(deps: SyncDeps): Promise<{ error: ApiError | null; delivered: number; paused: boolean }> {
  const { db, api, now, random = Math.random } = deps
  let delivered = 0
  for (;;) {
    const ready = await readyOperations(db, now(), MAX_OPERATIONS_PER_REQUEST)
    if (ready.length === 0) return { error: null, delivered, paused: false }
    const response = await api.operations(ready.map(toOperation))
    if (!response.ok) {
      if (response.error.code === 'AUTH_REQUIRED') return { error: response.error, delivered, paused: true }
      for (const entry of ready) {
        await scheduleRetry(db, entry.operationId, entry.attempts, now(), response.error.message, random)
      }
      return { error: response.error, delivered, paused: false }
    }
    for (const outcome of response.data.results) {
      await applyOutcome(db, outcome)
      delivered += 1
    }
    const failure = response.data.failed
    if (!failure) continue
    const entry = ready.find((item) => item.operationId === failure.operationId)
    if (!entry) return { error: failure.error, delivered, paused: false }
    if (failure.error.code === 'CONFLICT') {
      await markConflict(db, entry.operationId, failure.error.message, failure.error.current ?? null)
      continue
    }
    if (failure.error.code === 'AUTH_REQUIRED') return { error: failure.error, delivered, paused: true }
    if (failure.error.code === 'OFFLINE' || failure.error.code === 'SERVER_ERROR') {
      await scheduleRetry(db, entry.operationId, entry.attempts, now(), failure.error.message, random)
      return { error: failure.error, delivered, paused: false }
    }
    await markFailed(db, entry.operationId, failure.error.message)
  }
}

async function outcomeFor(
  db: LocalDatabase, error: ApiError | null, paused: boolean, delivered: number, applied: number
): Promise<SyncOutcome> {
  const counts = await db.all<{ status: string; total: number }>(
    'SELECT status, COUNT(*) AS total FROM outbox GROUP BY status')
  const of = (status: string): number => counts.find((row) => row.status === status)?.total ?? 0
  const pendingCount = of('pending')
  const conflictCount = of('conflict') + of('failed')
  const state: SyncState = paused
    ? 'paused'
    : conflictCount > 0
      ? 'attention'
      : error
        ? (error.code === 'OFFLINE' ? 'offline' : 'pending')
        : pendingCount > 0 ? 'pending' : 'synced'
  return {
    state,
    delivered,
    applied,
    pendingCount,
    conflictCount,
    serverSequence: (await syncStateRow(db)).server_sequence,
    message: error ? error.message : null
  }
}

export interface SyncCoordinator {
  sync: () => Promise<SyncOutcome>
  status: () => Promise<SyncOutcome>
}

/**
 * One synchronisation runs at a time for a dataset. A second request joins the one in flight
 * rather than delivering the same operations twice.
 */
export function createSyncCoordinator(deps: SyncDeps): SyncCoordinator {
  let inFlight: Promise<SyncOutcome> | null = null

  const run = async (): Promise<SyncOutcome> => {
    const { db, now } = deps
    if (!(await isBootstrapped(db))) {
      const error = await bootstrap(deps)
      if (error) return outcomeFor(db, error, error.code === 'AUTH_REQUIRED', 0, 0)
    }
    const delivery = await deliver(deps)
    if (delivery.paused) return outcomeFor(db, delivery.error, true, delivery.delivered, 0)
    const pull = await pullChanges(deps)
    const error = pull.error ?? delivery.error
    if (!error) await db.run('UPDATE sync_state SET last_synced_at = ? WHERE id = 1', [now()])
    return outcomeFor(db, error, false, delivery.delivered, pull.applied)
  }

  return {
    sync: () => {
      if (!inFlight) {
        inFlight = run().finally(() => {
          inFlight = null
        })
      }
      return inFlight
    },
    status: () => outcomeFor(deps.db, null, false, 0, 0)
  }
}
