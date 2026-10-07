import type { SqlParam } from '@ego/local/database/types'

export type Row = Record<string, unknown>

export type DatabaseRequest =
  /** `file` null keeps the database in memory, for a tab-only sign-in. */
  | { type: 'open'; file: string | null }
  | { type: 'all'; sql: string; params: SqlParam[] }
  | { type: 'run'; sql: string; params: SqlParam[] }
  | { type: 'exec'; sql: string }
  | { type: 'close' }
  /** Closes and deletes every file this origin's database pool holds. */
  | { type: 'erase' }

export interface DatabaseResults {
  open: null
  all: Row[]
  run: { changes: number }
  exec: null
  close: null
  erase: null
}

export type DatabaseMessage = { id: number; request: DatabaseRequest }

export type DatabaseReply =
  | { id: number; ok: true; value: DatabaseResults[keyof DatabaseResults] }
  | { id: number; ok: false; message: string }
