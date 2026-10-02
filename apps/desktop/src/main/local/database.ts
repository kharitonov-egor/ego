import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { migrate } from '@ego/local/database/migrations'
import type { LocalDatabase, SqlParam, SqlResult } from '@ego/local/database/types'

/** A renderer that crashed or reloaded mid-transaction must not hold the database forever. */
const RENDERER_TRANSACTION_LIMIT_MS = 15000
const STATEMENT_CACHE_LIMIT = 400

type Row = Record<string, unknown>

interface OpenTransaction {
  release: () => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * One SQLite connection shared by the sync coordinator here and the screens in the renderer.
 * Every statement and transaction takes a turn, so a sync never lands inside a transaction the
 * renderer opened over IPC, and the renderer never reads half of one the coordinator is writing.
 */
export interface LedgerDatabase {
  /** For code in this process. Nested calls inside a transaction run in that transaction. */
  local: LocalDatabase
  all: (transaction: number | null, sql: string, params: SqlParam[]) => Promise<Row[]>
  run: (transaction: number | null, sql: string, params: SqlParam[]) => Promise<SqlResult>
  /** Waits for a turn, opens a transaction for the renderer, and holds the turn until `finish`. */
  begin: () => Promise<number>
  finish: (transaction: number, commit: boolean) => void
  /** Rolls back whatever the renderer left open, after a reload or a crash. */
  abandonRendererTransactions: () => void
  close: () => Promise<void>
}

function turnstile(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve()
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await work()
    } finally {
      release()
    }
  }
}

export async function openLedgerDatabase(file: string): Promise<LedgerDatabase> {
  const sqlite = new DatabaseSync(file)
  sqlite.exec('PRAGMA journal_mode = WAL')
  const statements = new Map<string, StatementSync>()
  const statement = (sql: string): StatementSync => {
    let prepared = statements.get(sql)
    if (!prepared) {
      if (statements.size >= STATEMENT_CACHE_LIMIT) statements.clear()
      prepared = sqlite.prepare(sql)
      statements.set(sql, prepared)
    }
    return prepared
  }
  const readRows = <T>(sql: string, params: SqlParam[]): T[] => statement(sql).all(...params) as T[]
  const runSql = (sql: string, params: SqlParam[]): SqlResult =>
    ({ changes: Number(statement(sql).run(...params).changes) })

  const turn = turnstile()
  const holding = new AsyncLocalStorage<true>()
  const exclusive = <T>(work: () => T | Promise<T>): Promise<T> =>
    holding.getStore() ? Promise.resolve(work()) : turn(() => holding.run(true, async () => work()))

  const inside: LocalDatabase = {
    all: async (sql, params = []) => readRows(sql, params),
    run: async (sql, params = []) => runSql(sql, params),
    prepare: async (sql) => ({
      run: async (params = []) => runSql(sql, params),
      finalize: async () => undefined
    }),
    transaction: (work) => work(inside),
    close: async () => undefined
  }

  const local: LocalDatabase = {
    all: (sql, params = []) => exclusive(() => readRows(sql, params)),
    run: (sql, params = []) => exclusive(() => runSql(sql, params)),
    prepare: async (sql) => ({
      run: (params = []) => exclusive(() => runSql(sql, params)),
      finalize: async () => undefined
    }),
    transaction: (work) => {
      if (holding.getStore()) return work(inside)
      return exclusive(async () => {
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
    },
    close: async () => sqlite.close()
  }

  await migrate(local)

  let nextTransaction = 0
  const open = new Map<number, OpenTransaction>()

  const finish = (transaction: number, commit: boolean): void => {
    const entry = open.get(transaction)
    if (!entry) return
    open.delete(transaction)
    clearTimeout(entry.timer)
    try {
      if (commit) {
        try {
          sqlite.exec('COMMIT')
        } catch (error: unknown) {
          sqlite.exec('ROLLBACK')
          throw error
        }
      } else {
        sqlite.exec('ROLLBACK')
      }
    } finally {
      entry.release()
    }
  }

  const within = <T>(transaction: number, work: () => T): T => {
    if (!open.has(transaction)) throw new Error('That transaction already ended')
    return work()
  }

  return {
    local,
    all: async (transaction, sql, params) => transaction === null
      ? local.all<Row>(sql, params)
      : within(transaction, () => readRows<Row>(sql, params)),
    run: async (transaction, sql, params) => transaction === null
      ? local.run(sql, params)
      : within(transaction, () => runSql(sql, params)),
    begin: () => new Promise<number>((opened, failed) => {
      void turn(() => new Promise<void>((release) => {
        nextTransaction += 1
        const id = nextTransaction
        try {
          sqlite.exec('BEGIN')
        } catch (error: unknown) {
          release()
          failed(error)
          return
        }
        open.set(id, { release, timer: setTimeout(() => finish(id, false), RENDERER_TRANSACTION_LIMIT_MS) })
        opened(id)
      }))
    }),
    finish,
    abandonRendererTransactions: () => {
      for (const id of [...open.keys()]) finish(id, false)
    },
    close: async () => {
      for (const id of [...open.keys()]) finish(id, false)
      await turn(async () => sqlite.close())
    }
  }
}
