import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../lib/database/migrations'
import type { LocalDatabase, SqlParam } from '../lib/database/types'

/**
 * The same LocalDatabase surface Expo SQLite provides on the phone, backed by node:sqlite so
 * the repositories, outbox, and sync coordinator run unchanged in tests.
 */
export function createLocalDatabase(): LocalDatabase & { raw: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  let depth = 0
  const database: LocalDatabase & { raw: DatabaseSync } = {
    raw: sqlite,
    all: async <T>(sql: string, params: SqlParam[] = []) => sqlite.prepare(sql).all(...params) as T[],
    run: async (sql: string, params: SqlParam[] = []) => {
      const result = sqlite.prepare(sql).run(...params)
      return { changes: Number(result.changes) }
    },
    transaction: async <T>(work: (tx: LocalDatabase) => Promise<T>): Promise<T> => {
      if (depth > 0) return work(database)
      depth += 1
      sqlite.exec('BEGIN')
      try {
        const outcome = await work(database)
        sqlite.exec('COMMIT')
        return outcome
      } catch (error: unknown) {
        sqlite.exec('ROLLBACK')
        throw error
      } finally {
        depth -= 1
      }
    },
    close: async () => sqlite.close()
  }
  return database
}

export async function openTestLedger(datasetId = 'test'): Promise<LocalDatabase & { raw: DatabaseSync }> {
  const db = createLocalDatabase()
  await migrate(db)
  await db.run('INSERT INTO sync_state (id, dataset_id) VALUES (1, ?)', [datasetId])
  return db
}
