import { migrate } from './migrations'
import type { LocalDatabase, SqlParam } from './types'

export * from './types'
export { migrate, LOCAL_MIGRATIONS } from './migrations'

/**
 * Storage is namespaced by the connection it belongs to. Pointing the app at another dataset
 * opens another file instead of mixing two ledgers.
 */
export function datasetIdFor(apiUrl: string): string {
  const normalized = apiUrl.trim().replace(/\/+$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function databaseFileFor(datasetId: string): string {
  return `ego-money-${datasetId}.db`
}

interface NativeDatabase {
  getAllAsync: <T>(sql: string, params: SqlParam[]) => Promise<T[]>
  runAsync: (sql: string, params: SqlParam[]) => Promise<{ changes: number }>
  withTransactionAsync: (work: () => Promise<void>) => Promise<void>
  execAsync: (sql: string) => Promise<void>
  closeAsync: () => Promise<void>
}

/**
 * expo-sqlite is native code, so it only exists in a development or production build. Loading it
 * on demand keeps a build without it running on the previous storage mode instead of crashing.
 */
async function openNative(name: string): Promise<NativeDatabase> {
  const module: unknown = await import('expo-sqlite')
  const open = (module as { openDatabaseAsync?: (file: string) => Promise<NativeDatabase> }).openDatabaseAsync
  if (typeof open !== 'function') throw new Error('This build does not include SQLite storage')
  return open(name)
}

/**
 * Expo runs every statement on one connection, so a transaction opened while another is still
 * running would join it and roll back with it. Top-level transactions therefore wait their turn.
 * Work inside one gets a handle whose nested transactions run in place.
 */
function adapt(native: NativeDatabase): LocalDatabase {
  let queue: Promise<unknown> = Promise.resolve()
  const all = <T>(sql: string, params: SqlParam[] = []): Promise<T[]> => native.getAllAsync<T>(sql, params)
  const run = async (sql: string, params: SqlParam[] = []): Promise<{ changes: number }> => {
    const result = await native.runAsync(sql, params)
    return { changes: result.changes }
  }
  const close = (): Promise<void> => native.closeAsync()
  const inside: LocalDatabase = { all, run, close, transaction: (work) => work(inside) }
  return {
    all,
    run,
    close,
    transaction: <T>(work: (tx: LocalDatabase) => Promise<T>): Promise<T> => {
      const turn = queue.then(async () => {
        let outcome: T | undefined
        await native.withTransactionAsync(async () => {
          outcome = await work(inside)
        })
        return outcome as T
      })
      queue = turn.catch(() => undefined)
      return turn
    }
  }
}

export async function openLocalDatabase(datasetId: string): Promise<LocalDatabase> {
  const native = await openNative(databaseFileFor(datasetId))
  await native.execAsync('PRAGMA journal_mode = WAL')
  const database = adapt(native)
  await migrate(database)
  await database.run(
    'INSERT INTO sync_state (id, dataset_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET dataset_id = excluded.dataset_id',
    [datasetId])
  return database
}
