export type SqlParam = string | number | null

export interface SqlResult {
  changes: number
}

export interface LocalStatement {
  run: (params?: SqlParam[]) => Promise<SqlResult>
  finalize: () => Promise<void>
}

/**
 * The narrow SQL surface the repositories and the outbox use. Expo SQLite provides it on the
 * phone; tests provide the same shape over node:sqlite so this code runs unchanged.
 */
export interface LocalDatabase {
  all: <T>(sql: string, params?: SqlParam[]) => Promise<T[]>
  run: (sql: string, params?: SqlParam[]) => Promise<SqlResult>
  prepare: (sql: string) => Promise<LocalStatement>
  /** Commits or rolls back as one unit. Nested calls reuse the outer transaction. */
  transaction: <T>(work: (tx: LocalDatabase) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

/** Reuses each write statement for one bounded job, then releases every native handle. */
export async function withPreparedRuns<T>(
  db: LocalDatabase, work: (cached: LocalDatabase) => Promise<T>
): Promise<T> {
  const statements = new Map<string, Promise<LocalStatement>>()
  const prepared = (sql: string): Promise<LocalStatement> => {
    let statement = statements.get(sql)
    if (!statement) {
      statement = db.prepare(sql)
      statements.set(sql, statement)
    }
    return statement
  }
  const cached: LocalDatabase = {
    all: db.all,
    run: async (sql, params = []) => (await prepared(sql)).run(params),
    prepare: db.prepare,
    close: db.close,
    transaction: (nested) => nested(cached)
  }
  try {
    return await work(cached)
  } finally {
    const opened = await Promise.allSettled(statements.values())
    await Promise.all(opened
      .filter((result): result is PromiseFulfilledResult<LocalStatement> => result.status === 'fulfilled')
      .map((result) => result.value.finalize()))
  }
}

export function sqlParams(values: unknown[]): SqlParam[] {
  return values.map((value) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'string' || typeof value === 'number') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    return JSON.stringify(value)
  })
}
