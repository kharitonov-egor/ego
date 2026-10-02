import { DatabaseSync } from 'node:sqlite'
import { migrate } from '../src/database/migrations'
import type { LocalDatabase, SqlParam } from '../src/database/types'

/**
 * The same LocalDatabase surface Expo SQLite provides on the phone, backed by node:sqlite so
 * the repositories, outbox, and sync coordinator run unchanged in tests.
 */
export function createLocalDatabase(): LocalDatabase & { raw: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  let queue: Promise<unknown> = Promise.resolve()
  const all = async <T>(sql: string, params: SqlParam[] = []): Promise<T[]> => sqlite.prepare(sql).all(...params) as T[]
  const run = async (sql: string, params: SqlParam[] = []): Promise<{ changes: number }> => {
    const result = sqlite.prepare(sql).run(...params)
    return { changes: Number(result.changes) }
  }
  const close = async (): Promise<void> => sqlite.close()
  const prepare: LocalDatabase['prepare'] = async (sql) => {
    const statement = sqlite.prepare(sql)
    return {
      run: async (params = []) => ({ changes: Number(statement.run(...params).changes) }),
      finalize: async () => undefined
    }
  }
  const inside: LocalDatabase = { all, run, prepare, close, transaction: (work) => work(inside) }
  return {
    raw: sqlite,
    all,
    run,
    prepare,
    close,
    transaction: <T>(work: (tx: LocalDatabase) => Promise<T>): Promise<T> => {
      const turn = queue.then(async () => {
        sqlite.exec('BEGIN')
        try {
          const outcome = await work(inside)
          sqlite.exec('COMMIT')
          return outcome
        } catch (error: unknown) {
          sqlite.exec('ROLLBACK')
          throw error
        }
      })
      queue = turn.catch(() => undefined)
      return turn
    }
  }
}

export async function openTestLedger(datasetId = 'test'): Promise<LocalDatabase & { raw: DatabaseSync }> {
  const db = createLocalDatabase()
  await migrate(db)
  await db.run('INSERT INTO sync_state (id, dataset_id) VALUES (1, ?)', [datasetId])
  return db
}
