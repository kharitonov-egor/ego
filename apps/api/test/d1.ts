import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

type Param = string | number | null

interface PreparedLike {
  bind: (...params: unknown[]) => PreparedLike
  all: <T>() => Promise<{ results: T[]; meta: { changes: number } }>
  run: () => Promise<{ results: never[]; meta: { changes: number } }>
  first: <T>() => Promise<T | null>
}

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))

function toParam(value: unknown): Param {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  return String(value)
}

/**
 * A D1-shaped adapter over node:sqlite so the Worker's SQL runs unchanged in tests,
 * including the transactional behaviour of batch().
 */
export function createTestDatabase(): { db: D1Database; close: () => void } {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }

  const prepared = (sql: string, bound: Param[]): PreparedLike => ({
    bind: (...params: unknown[]) => prepared(sql, params.map(toParam)),
    all: async <T>() => {
      const statement = sqlite.prepare(sql)
      if (/^\s*select/i.test(sql)) {
        return { results: statement.all(...bound) as T[], meta: { changes: 0 } }
      }
      const result = statement.run(...bound)
      return { results: [] as T[], meta: { changes: Number(result.changes) } }
    },
    run: async () => {
      const result = sqlite.prepare(sql).run(...bound)
      return { results: [], meta: { changes: Number(result.changes) } }
    },
    first: async <T>() => (sqlite.prepare(sql).all(...bound) as T[])[0] ?? null
  })

  const batch = async (statements: PreparedLike[]) => {
    sqlite.exec('BEGIN')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      sqlite.exec('COMMIT')
      return results
    } catch (error: unknown) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  }

  const database = {
    prepare: (sql: string) => prepared(sql, []),
    batch,
    exec: async (sql: string) => {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    }
  }
  return { db: database as unknown as D1Database, close: () => sqlite.close() }
}
