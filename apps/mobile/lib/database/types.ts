export type SqlParam = string | number | null

export interface SqlResult {
  changes: number
}

/**
 * The narrow SQL surface the repositories and the outbox use. Expo SQLite provides it on the
 * phone; tests provide the same shape over node:sqlite so this code runs unchanged.
 */
export interface LocalDatabase {
  all: <T>(sql: string, params?: SqlParam[]) => Promise<T[]>
  run: (sql: string, params?: SqlParam[]) => Promise<SqlResult>
  /** Commits or rolls back as one unit. Nested calls reuse the outer transaction. */
  transaction: <T>(work: (tx: LocalDatabase) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

export function sqlParams(values: unknown[]): SqlParam[] {
  return values.map((value) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'string' || typeof value === 'number') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    return JSON.stringify(value)
  })
}
