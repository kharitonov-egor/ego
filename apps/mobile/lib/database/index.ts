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

function adapt(native: NativeDatabase): LocalDatabase {
  let depth = 0
  const database: LocalDatabase = {
    all: <T>(sql: string, params: SqlParam[] = []) => native.getAllAsync<T>(sql, params),
    run: async (sql: string, params: SqlParam[] = []) => {
      const result = await native.runAsync(sql, params)
      return { changes: result.changes }
    },
    transaction: async <T>(work: (tx: LocalDatabase) => Promise<T>): Promise<T> => {
      if (depth > 0) return work(database)
      depth += 1
      try {
        let outcome: T | undefined
        await native.withTransactionAsync(async () => {
          outcome = await work(database)
        })
        return outcome as T
      } finally {
        depth -= 1
      }
    },
    close: () => native.closeAsync()
  }
  return database
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
