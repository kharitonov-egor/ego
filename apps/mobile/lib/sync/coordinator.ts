import {
  MAX_OPERATIONS_PER_REQUEST, isDiaryEntity, isGymEntity, isHabitEntity, isHealthEntity, isTaskEntity,
  type ApiError, type ChangeRecord, type OperationOutcome, type SyncEntity
} from '@ego/api-contracts'
import type { MoneyApi } from '../api-client'
import type { LocalDatabase } from '../database/types'
import { withPreparedRuns } from '../database/types'
import { TABLES, keyColumn, writeRecord, writeTombstone } from '../database/writes'
import {
  markConflict, markFailed, readyOperations, scheduleRetry, toOperation
} from './outbox'

export interface MediaUploadRun {
  error: ApiError | null
  paused: boolean
  uploaded: number
  /** Queued messages whose last file just finished, now ready to deliver. */
  released: number
}

export interface SyncDeps {
  db: LocalDatabase
  api: MoneyApi
  now: () => string
  random?: () => number
  /** Sends files that queued messages are waiting on, before the messages go out. */
  uploadMedia?: () => Promise<MediaUploadRun>
}

export type SyncState = 'synced' | 'pending' | 'attention' | 'paused' | 'offline'

/** Which screens have something new to read after a run. */
export interface Touched {
  money: boolean
  gym: boolean
  health: boolean
  habits: boolean
  diary: boolean
  tasks: boolean
}

export interface SyncOutcome {
  state: SyncState
  delivered: number
  applied: number
  pendingCount: number
  conflictCount: number
  serverSequence: number
  message: string | null
  touched: Touched
}

const NOTHING_TOUCHED: Touched = { money: false, gym: false, health: false, habits: false, diary: false, tasks: false }

function touch(touched: Touched, entity: SyncEntity): void {
  if (isGymEntity(entity)) touched.gym = true
  else if (isHealthEntity(entity)) touched.health = true
  else if (isHabitEntity(entity)) touched.habits = true
  else if (isDiaryEntity(entity)) touched.diary = true
  else if (isTaskEntity(entity)) touched.tasks = true
  else touched.money = true
}

interface SyncStateRow {
  server_sequence: number
  bootstrapped_at: string | null
  bootstrap_version: number
}

/**
 * Version 1 downloaded accounts, categories, and transaction pages only, so a device that
 * bootstrapped then has no budgets and no receipt items. Version 2 downloads every money record.
 * Version 3 adds the gym log. Version 4 adds the diary: a build without it pulled diary changes
 * it could not store and moved past them, so it has to download everything again. Version 5 does
 * the same for Tasks.
 */
export const BOOTSTRAP_VERSION = 5

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
  const gymCategories = data.gymCategories ?? []
  const gymExercises = data.gymExercises ?? []
  const gymSets = data.gymSets ?? []
  const gymWorkouts = data.gymWorkouts ?? []
  const gymPlans = data.gymPlans ?? []
  const moods = data.moods ?? []
  const habits = data.habits ?? []
  const habitEntries = data.habitEntries ?? []
  const diaryMessages = data.diaryMessages ?? []
  const taskBoards = data.taskBoards ?? []
  const taskLists = data.taskLists ?? []
  const taskLabels = data.taskLabels ?? []
  const taskCards = data.taskCards ?? []
  const live: Record<SyncEntity, Set<string>> = {
    account: new Set(data.accounts.map((record) => record.id)),
    category: new Set(data.categories.map((record) => record.id)),
    transaction: new Set(data.transactions.map((record) => record.id)),
    purchase: new Set(data.purchases.map((record) => record.id)),
    budget: new Set(data.budgets.map((record) => record.month)),
    gymCategory: new Set(gymCategories.map((record) => record.id)),
    gymExercise: new Set(gymExercises.map((record) => record.id)),
    gymSet: new Set(gymSets.map((record) => record.id)),
    gymWorkout: new Set(gymWorkouts.map((record) => record.id)),
    gymPlan: new Set(gymPlans.map((record) => record.id)),
    mood: new Set(moods.map((record) => record.date)),
    habit: new Set(habits.map((record) => record.id)),
    habitEntry: new Set(habitEntries.map((record) => record.id)),
    diaryMessage: new Set(diaryMessages.map((record) => record.id)),
    taskBoard: new Set(taskBoards.map((record) => record.id)),
    taskList: new Set(taskLists.map((record) => record.id)),
    taskLabel: new Set(taskLabels.map((record) => record.id)),
    taskCard: new Set(taskCards.map((record) => record.id))
  }
  const deletedAt = now()
  await db.transaction((tx) => withPreparedRuns(tx, async (cached) => {
    for (const record of data.accounts) if (!skip('account', record.id)) await writeRecord(cached, { entity: 'account', record })
    for (const record of data.categories) if (!skip('category', record.id)) await writeRecord(cached, { entity: 'category', record })
    for (const record of data.transactions) if (!skip('transaction', record.id)) await writeRecord(cached, { entity: 'transaction', record })
    for (const record of data.purchases) if (!skip('purchase', record.id)) await writeRecord(cached, { entity: 'purchase', record })
    for (const record of data.budgets) if (!skip('budget', record.month)) await writeRecord(cached, { entity: 'budget', record })
    for (const record of gymCategories) if (!skip('gymCategory', record.id)) await writeRecord(cached, { entity: 'gymCategory', record })
    for (const record of gymExercises) if (!skip('gymExercise', record.id)) await writeRecord(cached, { entity: 'gymExercise', record })
    for (const record of gymSets) if (!skip('gymSet', record.id)) await writeRecord(cached, { entity: 'gymSet', record })
    for (const record of gymWorkouts) if (!skip('gymWorkout', record.id)) await writeRecord(cached, { entity: 'gymWorkout', record })
    for (const record of gymPlans) if (!skip('gymPlan', record.id)) await writeRecord(cached, { entity: 'gymPlan', record })
    for (const record of moods) if (!skip('mood', record.date)) await writeRecord(cached, { entity: 'mood', record })
    for (const record of habits) if (!skip('habit', record.id)) await writeRecord(cached, { entity: 'habit', record })
    for (const record of habitEntries) if (!skip('habitEntry', record.id)) await writeRecord(cached, { entity: 'habitEntry', record })
    for (const record of diaryMessages) if (!skip('diaryMessage', record.id)) await writeRecord(cached, { entity: 'diaryMessage', record })
    for (const record of taskBoards) if (!skip('taskBoard', record.id)) await writeRecord(cached, { entity: 'taskBoard', record })
    for (const record of taskLists) if (!skip('taskList', record.id)) await writeRecord(cached, { entity: 'taskList', record })
    for (const record of taskLabels) if (!skip('taskLabel', record.id)) await writeRecord(cached, { entity: 'taskLabel', record })
    for (const record of taskCards) if (!skip('taskCard', record.id)) await writeRecord(cached, { entity: 'taskCard', record })
    for (const entity of Object.keys(TABLES) as SyncEntity[]) {
      const key = keyColumn(entity)
      const local = await tx.all<{ key: string }>(`SELECT ${key} AS key FROM ${TABLES[entity]} WHERE deleted_at IS NULL`)
      for (const row of local) {
        if (live[entity].has(row.key) || queued.has(`${entity}:${row.key}`)) continue
        await cached.run(`UPDATE ${TABLES[entity]} SET deleted_at = ? WHERE ${key} = ?`, [deletedAt, row.key])
      }
    }
    await cached.run('UPDATE sync_state SET server_sequence = ?, bootstrapped_at = ?, bootstrap_version = ? WHERE id = 1',
      [data.serverSequence, deletedAt, BOOTSTRAP_VERSION])
  }))
  return null
}

async function applyOutcomes(db: LocalDatabase, outcomes: OperationOutcome[], touched: Touched): Promise<void> {
  if (outcomes.length === 0) return
  await db.transaction(async (tx) => {
    for (const outcome of outcomes) {
      touch(touched, outcome.entity)
      await tx.run(
        `UPDATE ${TABLES[outcome.entity]} SET revision = ? WHERE ${keyColumn(outcome.entity)} = ? AND revision < ?`,
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

async function pullChanges(deps: SyncDeps, touched: Touched): Promise<{ error: ApiError | null; applied: number; sequence: number }> {
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
        touch(touched, change.entity)
        applied += 1
      }
      await tx.run('UPDATE sync_state SET server_sequence = ? WHERE id = 1', [page.data.cursor])
    })
    sequence = page.data.cursor
    if (!page.data.hasMore) return { error: null, applied, sequence }
  }
}

async function deliver(deps: SyncDeps, touched: Touched): Promise<{ error: ApiError | null; delivered: number; paused: boolean }> {
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
    await applyOutcomes(db, response.data.results, touched)
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
  db: LocalDatabase, error: ApiError | null, paused: boolean, delivered: number, applied: number,
  touched: Touched = NOTHING_TOUCHED
): Promise<SyncOutcome> {
  const counts = await db.all<{ status: string; total: number }>(
    'SELECT status, COUNT(*) AS total FROM outbox GROUP BY status')
  const of = (status: string): number => counts.find((row) => row.status === status)?.total ?? 0
  const pendingCount = of('pending') + of('held')
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
    message: error ? error.message : null,
    touched: { ...touched }
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
    const touched: Touched = { ...NOTHING_TOUCHED }
    if (!(await isBootstrapped(db))) {
      const error = await bootstrap(deps)
      if (error) return outcomeFor(db, error, error.code === 'AUTH_REQUIRED', 0, 0)
      touched.money = true
      touched.gym = true
      touched.health = true
      touched.habits = true
      touched.diary = true
      touched.tasks = true
    }
    const delivery = await deliver(deps, touched)
    if (delivery.paused) return outcomeFor(db, delivery.error, true, delivery.delivered, 0, touched)
    const pull = await pullChanges(deps, touched)
    // Files go after everything else, so a long video never holds up a logged expense.
    const uploads = deps.uploadMedia ? await deps.uploadMedia() : { error: null, paused: false, uploaded: 0, released: 0 }
    if (uploads.paused) return outcomeFor(db, uploads.error, true, delivery.delivered, pull.applied, touched)
    if (uploads.uploaded > 0 || uploads.error) {
      touched.diary = true
      touched.tasks = true
    }
    const released = uploads.released > 0 ? await deliver(deps, touched) : { error: null, delivered: 0, paused: false }
    if (released.paused) return outcomeFor(db, released.error, true, delivery.delivered + released.delivered, pull.applied, touched)
    const error = pull.error ?? delivery.error ?? released.error ?? uploads.error
    if (!error) await db.run('UPDATE sync_state SET last_synced_at = ? WHERE id = 1', [now()])
    return outcomeFor(db, error, false, delivery.delivered + released.delivered, pull.applied, touched)
  }

  return {
    sync: () => {
      if (inFlight) {
        again = true
        return inFlight
      }
      inFlight = (async () => {
        let outcome: SyncOutcome
        const touched: Touched = { ...NOTHING_TOUCHED }
        do {
          again = false
          outcome = await run()
          touched.money ||= outcome.touched.money
          touched.gym ||= outcome.touched.gym
          touched.health ||= outcome.touched.health
          touched.habits ||= outcome.touched.habits
          touched.diary ||= outcome.touched.diary
          touched.tasks ||= outcome.touched.tasks
        } while (again)
        return { ...outcome, touched }
      })().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    status: () => outcomeFor(deps.db, null, false, 0, 0)
  }
}
