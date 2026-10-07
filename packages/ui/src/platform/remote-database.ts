import type { LocalDatabase, SqlParam, SqlResult } from '@ego/local/database/types'
import type { IpcApi } from './types'

export type DatabaseBridge = Pick<IpcApi, 'localAll' | 'localRun' | 'localBegin' | 'localFinish'>

/**
 * The ledger file lives in the main process. This sends each statement there over IPC, so the
 * phone's repositories and commands run in the renderer unchanged.
 *
 * A transaction holds the database's turn in the main process until it commits. Statements sent
 * through the outer handle meanwhile join it, as they would on the phone's single connection, and
 * a second top-level transaction waits for the first.
 */
export function createRemoteDatabase(bridge: () => DatabaseBridge): LocalDatabase {
  let open: number | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const all = async <T>(sql: string, params: SqlParam[] = []): Promise<T[]> =>
    await bridge().localAll(open, sql, params) as T[]
  const run = (sql: string, params: SqlParam[] = []): Promise<SqlResult> => bridge().localRun(open, sql, params)
  const prepare: LocalDatabase['prepare'] = async (sql) => ({
    run: (params = []) => run(sql, params),
    finalize: async () => undefined
  })
  const close = async (): Promise<void> => undefined
  const inside: LocalDatabase = { all, run, prepare, close, transaction: (work) => work(inside) }
  return {
    all,
    run,
    prepare,
    close,
    transaction: <T>(work: (tx: LocalDatabase) => Promise<T>): Promise<T> => {
      const turn = queue.then(async () => {
        open = await bridge().localBegin()
        const id = open
        try {
          const outcome = await work(inside)
          open = null
          await bridge().localFinish(id, true)
          return outcome
        } catch (error: unknown) {
          open = null
          await bridge().localFinish(id, false).catch(() => undefined)
          throw error
        }
      })
      queue = turn.catch(() => undefined)
      return turn
    }
  }
}
