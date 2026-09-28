import {
  MAX_OPERATIONS_PER_REQUEST,
  type ApiError, type ChangeRecord, type OperationOutcome, type SyncEntity
} from '@ego/api-contracts'
import type { MoneyApi } from '../api-client'
import type { LocalDatabase } from '../database/types'
import { writeRecord, writeTombstone } from '../database/writes'
import {
  markConflict, markFailed, readyOperations, scheduleRetry, toOperation
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
  bootstrap_version: number
}

/**
 * Version 1 downloaded accounts, categories, and transaction pages only, so a device that
 * bootstrapped then has no budgets and no receipt items. Version 2 downloads every record.
 */
export const BOOTSTRAP_VERSION = 2

async function syncStateRow(db: LocalDatabase): Promise<SyncStateRow> {
  const rows = await db.all<SyncStateRow>(
    'SELECT server_sequence, bootstrapped_at, bootstrap_version FROM sync_state WHERE id = 1')
  return rows[0] ?? { server_sequence: 0, bootstrapped_at: null, bootstrap_version: 0 }
}

export async function isBootstrapped(db: LocalDatabase): Promise<boolean> {
  const state = await syncStateRow(db)
  return state.bootstrapped_at !== null && state.bootstrap_version >= BOOTSTRAP_VERSION
}

/** Any finished download, even an older version, is enough for screens to read offline. */
export async function hasDownloaded(db: LocalDatabase): Promise<boolean> {
  return (await syncStateRow(db)).bootstrapped_at !== null
}

async function pendingKeys(db: LocalDatabase, statuses: 'pending' | 'any' = 'pending'): Promise<Set<string>> {
  const rows = await db.all<{ entity: string; entity_id: string }>(statuses === 'pending'
    ? "SELECT entity, entity_id FROM outbox WHERE status = 'pending'"
    : 'SELECT entity, entity_id FROM outbox')
  return new Set(rows.map((row) => `${row.entity}:${row.entity_id}`))
}

/**
 * Downloads every live record in one request and writes it in one transaction. A live local row
 * the download does not contain was deleted on the server, possibly by a client that never wrote
 * to the change log, so it becomes a tombstone here. With the tables matching the server, the
 * sequence read before the download is a safe place to resume pulling changes. Rows with an
 * undelivered local change are left alone, exactly as a pulled change would leave them.
 */
export async function bootstrap(deps: SyncDeps): Promise<ApiError | null> {
  const { db, api, now } = deps
  const response = await api.bootstrap()
  if (!response.ok) return response.error
  const data = response.data
  const pending = await pendingKeys(db)
  const queued = await pendingKeys(db, 'any')
  const skip = (entity: SyncEntity, id: string): boolean => pending.has(`${entity}:${id}`)
  const live: Record<SyncEntity, Set<string>> = {
    account: new Set(data.accounts.map((record) => record.id)),
    category: new Set(data.categories.map((record) => record.id)),
    transaction: new Set(data.transactions.map((record) => record.id)),
    purchase: new Set(data.purchases.map((record) => record.id)),
    budget: new Set(data.budgets.map((record) => record.month))
  }
  const deletedAt = now()
  await db.transaction(async (tx) => {
    for (const record of data.accounts) if (!skip('account', record.id)) await writeRecord(tx, { entity: 'account', record })
    for (const record of data.categories) if (!skip('category', record.id)) await writeRecord(tx, { entity: 'category', record })
    for (const record of data.transactions) if (!skip('transaction', record.id)) await writeRecord(tx, { entity: 'transaction', record })
    for (const record of data.purchases) if (!skip('purchase', record.id)) await writeRecord(tx, { entity: 'purchase', record })
    for (const record of data.budgets) if (!skip('budget', record.month)) await writeRecord(tx, { entity: 'budget', record })
    for (const entity of Object.keys(TABLES) as SyncEntity[]) {
      const key = entity === 'budget' ? 'month' : 'id'
      const local = await tx.all<{ key: string }>(`SELECT ${key} AS key FROM ${TABLES[entity]} WHERE deleted_at IS NULL`)
      for (const row of local) {
        if (live[entity].has(row.key) || queued.has(`${entity}:${row.key}`)) continue
        await tx.run(`UPDATE ${TABLES[entity]} SET deleted_at = ? WHERE ${key} = ?`, [deletedAt, row.key])
      }
    }
    await tx.run('UPDATE sync_state SET server_sequence = ?, bootstrapped_at = ?, bootstrap_version = ? WHERE id = 1',
      [data.serverSequence, deletedAt, BOOTSTRAP_VERSION])
  })
  return null
}

async function applyOutcomes(db: LocalDatabase, outcomes: OperationOutcome[]): Promise<void> {
  if (outcomes.length === 0) return
  await db.transaction(async (tx) => {
    for (const outcome of outcomes) {
      const column = outcome.entity === 'budget' ? 'month' : 'id'
      await tx.run(
        `UPDATE ${TABLES[outcome.entity]} SET revision = ? WHERE ${column} = ? AND revision < ?`,
        [outcome.revision, outcome.entityId, outcome.revision])
      await tx.run('DELETE FROM outbox WHERE operation_id = ?', [outcome.operationId])
    }
  })
}

async function applyChange(db: LocalDatabase, change: ChangeRecord, deletedAt: string, pending: Set<string>): Promise<void> {
  if (pending.has(`${change.entity}:${change.entityId}`)) return
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
    const pending = await pendingKeys(db)
    await db.transaction(async (tx) => {
      for (const change of page.data.changes) {
        await applyChange(tx, change, change.committedAt, pending)
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
    await applyOutcomes(db, response.data.results)
    delivered += response.data.results.length
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
 * rather than delivering the same operations twice, and asks for one more run afterwards, so a
 * change saved after delivery started is not left waiting for the next foreground.
 */
export function createSyncCoordinator(deps: SyncDeps): SyncCoordinator {
  let inFlight: Promise<SyncOutcome> | null = null
  let again = false

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
      if (inFlight) {
        again = true
        return inFlight
      }
      inFlight = (async () => {
        let outcome: SyncOutcome
        do {
          again = false
          outcome = await run()
        } while (again)
        return outcome
      })().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    status: () => outcomeFor(deps.db, null, false, 0, 0)
  }
}
