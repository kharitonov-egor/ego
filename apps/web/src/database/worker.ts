import sqlite3InitModule, { type Database, type PreparedStatement, type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { SqlParam } from '@ego/local/database/types'
import type { DatabaseMessage, DatabaseReply, DatabaseRequest, DatabaseResults, Row } from './protocol'

/** The page's DOM types describe `self` as a window; in this worker it only receives and posts messages. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DatabaseMessage>) => void) | null
  postMessage: (message: DatabaseReply) => void
}

const STATEMENT_CACHE_LIMIT = 400
/** The pool keeps one OPFS handle per file; a database, its journal, and a spare per dataset. */
const POOL_CAPACITY = 6
const POOL_DIRECTORY = '/ego-ledger'

let sqlite: Promise<Sqlite3Static> | null = null
let pool: Promise<SAHPoolUtil> | null = null
let db: Database | null = null
const statements = new Map<string, PreparedStatement>()

function loadSqlite(): Promise<Sqlite3Static> {
  sqlite ??= sqlite3InitModule()
  return sqlite
}

/** Another tab may still be letting go of the pool's files, so the first tries wait a moment. */
async function openPool(): Promise<SAHPoolUtil> {
  const sqlite3 = await loadSqlite()
  let failure: unknown = null
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({ directory: POOL_DIRECTORY, initialCapacity: POOL_CAPACITY })
    } catch (error: unknown) {
      failure = error
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw failure instanceof Error ? failure : new Error('The browser storage for Ego did not open')
}

function poolUtil(): Promise<SAHPoolUtil> {
  pool ??= openPool().catch((error: unknown) => {
    pool = null
    throw error
  })
  return pool
}

function prepared(sql: string): PreparedStatement {
  if (!db) throw new Error('The database is not open')
  let statement = statements.get(sql)
  if (!statement) {
    if (statements.size >= STATEMENT_CACHE_LIMIT) clearStatements()
    statement = db.prepare(sql)
    statements.set(sql, statement)
  }
  return statement
}

function clearStatements(): void {
  for (const statement of statements.values()) statement.finalize()
  statements.clear()
}

function bound(sql: string, params: SqlParam[]): PreparedStatement {
  const statement = prepared(sql)
  statement.reset(true)
  if (params.length > 0) statement.bind(params)
  return statement
}

function readRows(sql: string, params: SqlParam[]): Row[] {
  const statement = bound(sql, params)
  const rows: Row[] = []
  try {
    while (statement.step()) rows.push(statement.get({}))
  } finally {
    statement.reset(true)
  }
  return rows
}

function runStatement(sql: string, params: SqlParam[]): { changes: number } {
  const statement = bound(sql, params)
  try {
    statement.step()
  } finally {
    statement.reset(true)
  }
  return { changes: Number(db?.changes() ?? 0) }
}

function closeDatabase(): void {
  clearStatements()
  db?.close()
  db = null
}

async function open(file: string | null): Promise<null> {
  closeDatabase()
  const sqlite3 = await loadSqlite()
  if (file === null) {
    db = new sqlite3.oo1.DB(':memory:', 'c')
  } else {
    const util = await poolUtil()
    db = new util.OpfsSAHPoolDb(`/${file}`)
  }
  return null
}

async function erase(): Promise<null> {
  closeDatabase()
  const util = await poolUtil()
  await util.wipeFiles()
  return null
}

async function answer(request: DatabaseRequest): Promise<DatabaseResults[keyof DatabaseResults]> {
  switch (request.type) {
    case 'open': return open(request.file)
    case 'all': return readRows(request.sql, request.params)
    case 'run': return runStatement(request.sql, request.params)
    case 'exec':
      if (!db) throw new Error('The database is not open')
      db.exec(request.sql)
      return null
    case 'close':
      closeDatabase()
      return null
    case 'erase': return erase()
  }
}

scope.onmessage = (event: MessageEvent<DatabaseMessage>): void => {
  const { id, request } = event.data
  void answer(request).then(
    (value) => scope.postMessage({ id, ok: true, value }),
    (error: unknown) => scope.postMessage({
      id, ok: false, message: error instanceof Error ? error.message : 'The database could not run that'
    })
  )
}
