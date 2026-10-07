import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrate } from '@ego/local/database/migrations'
import type { SqlParam } from '@ego/local/database/types'
import { createRemoteDatabase } from '@ego/ui/platform/remote-database'
import { createDatabaseBridge, type Send } from './client'
import type { DatabaseRequest, DatabaseResults } from './protocol'

/** The worker's side of the protocol over node:sqlite, with a pause on every reply like a real postMessage. */
function sqliteSend(): { send: Send; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:')
  const answer = (request: DatabaseRequest): DatabaseResults[keyof DatabaseResults] => {
    switch (request.type) {
      case 'all': return sqlite.prepare(request.sql).all(...request.params) as Record<string, unknown>[]
      case 'run': return { changes: Number(sqlite.prepare(request.sql).run(...request.params).changes) }
      case 'exec':
        sqlite.exec(request.sql)
        return null
      default: return null
    }
  }
  const reply = (request: DatabaseRequest): Promise<unknown> => new Promise((resolve, reject) => setTimeout(() => {
    try { resolve(answer(request)) } catch (error: unknown) { reject(error) }
  }, 1))
  const send = reply as Send
  return { send, sqlite }
}

function setup(): { screens: ReturnType<typeof createRemoteDatabase>; sync: ReturnType<typeof createRemoteDatabase>; sqlite: DatabaseSync } {
  const { send, sqlite } = sqliteSend()
  const { bridge } = createDatabaseBridge(send)
  sqlite.exec('CREATE TABLE log (id INTEGER PRIMARY KEY AUTOINCREMENT, who TEXT NOT NULL)')
  return { screens: createRemoteDatabase(() => bridge), sync: createRemoteDatabase(() => bridge), sqlite }
}

const insert = (who: string): [string, SqlParam[]] => ['INSERT INTO log (who) VALUES (?)', [who]]

describe('the browser database bridge', () => {
  it('brings an empty database up to the current local schema', async () => {
    const { send } = sqliteSend()
    const { bridge } = createDatabaseBridge(send)
    const db = createRemoteDatabase(() => bridge)
    const version = await migrate(db)
    const rows = await db.all<{ user_version: number }>('PRAGMA user_version')
    expect(rows[0]?.user_version).toBe(version)
    expect((await db.all('SELECT id FROM sync_state')).length).toBeGreaterThanOrEqual(0)
  })

  it('keeps a sync transaction from landing inside one a screen opened', async () => {
    const { screens, sync, sqlite } = setup()
    let letScreenFinish!: () => void
    const gate = new Promise<void>((resolve) => { letScreenFinish = resolve })
    const screen = screens.transaction(async (tx) => {
      await tx.run(...insert('screen 1'))
      await gate
      await tx.run(...insert('screen 2'))
    })
    const syncing = sync.transaction(async (tx) => {
      await tx.run(...insert('sync'))
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    letScreenFinish()
    await Promise.all([screen, syncing])
    const order = sqlite.prepare('SELECT who FROM log ORDER BY id').all().map((row) => row.who)
    expect(order).toEqual(['screen 1', 'screen 2', 'sync'])
  })

  it('makes a statement from outside wait for the open transaction', async () => {
    const { screens, sync } = setup()
    let letScreenFinish!: () => void
    const gate = new Promise<void>((resolve) => { letScreenFinish = resolve })
    const screen = screens.transaction(async (tx) => {
      await tx.run(...insert('screen'))
      await gate
    })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const read = sync.all<{ count: number }>('SELECT COUNT(*) AS count FROM log')
    letScreenFinish()
    await screen
    expect((await read)[0]?.count).toBe(1)
  })

  it('rolls a failed transaction back and lets the next one run', async () => {
    const { screens, sync, sqlite } = setup()
    await expect(screens.transaction(async (tx) => {
      await tx.run(...insert('lost'))
      throw new Error('the screen gave up')
    })).rejects.toThrow('the screen gave up')
    await sync.run(...insert('kept'))
    expect(sqlite.prepare('SELECT who FROM log').all().map((row) => row.who)).toEqual(['kept'])
  })
})
