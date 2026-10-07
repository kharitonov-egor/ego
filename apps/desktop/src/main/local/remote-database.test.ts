import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveMood } from '@ego/local/sync/commands'
import { localMoods } from '@ego/local/repositories/moods'
import { allOperations } from '@ego/local/sync/outbox'
import { createRemoteDatabase, type DatabaseBridge } from '@ego/ui/platform/remote-database'
import { openLedgerDatabase, type LedgerDatabase } from './database'

let folder = ''
let ledger: LedgerDatabase | null = null
let remoteDatabase = createRemoteDatabase(() => { throw new Error('No bridge yet') })

/** The preload bridge, minus Electron: each call goes straight to the main-process database. */
function bridge(db: LedgerDatabase): DatabaseBridge {
  return {
    localAll: (transaction, sql, params) => db.all(transaction, sql, params),
    localRun: (transaction, sql, params) => db.run(transaction, sql, params),
    localBegin: () => db.begin(),
    localFinish: async (transaction, commit) => db.finish(transaction, commit)
  }
}

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'ego-remote-'))
  ledger = await openLedgerDatabase(join(folder, 'ledger.db'))
  await ledger.local.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  const opened = ledger
  remoteDatabase = createRemoteDatabase(() => bridge(opened))
})

afterEach(async () => {
  await ledger?.close()
  ledger = null
  rmSync(folder, { recursive: true, force: true })
})

const bodies = async (): Promise<string[]> =>
  (await remoteDatabase.all<{ body: string }>('SELECT body FROM notes ORDER BY id')).map((row) => row.body)

describe('the renderer database over IPC', () => {
  it('runs a phone command and its outbox entry as one transaction', async () => {
    await saveMood(remoteDatabase, { date: '2026-10-01', mood: 4, note: 'Good day' }, null, '2026-10-01T20:00:00.000Z')
    expect((await localMoods(remoteDatabase)).map((mood) => [mood.date, mood.mood, mood.note])).toEqual([['2026-10-01', 4, 'Good day']])
    expect((await allOperations(remoteDatabase)).map((entry) => entry.entity)).toEqual(['mood'])
  })

  it('puts a statement sent on the outer handle into the open transaction, as one connection would', async () => {
    await expect(remoteDatabase.transaction(async (tx) => {
      await tx.run('INSERT INTO notes (body) VALUES (?)', ['inside'])
      await remoteDatabase.run('INSERT INTO notes (body) VALUES (?)', ['outer handle'])
      throw new Error('undo both')
    })).rejects.toThrow('undo both')
    expect(await bodies()).toEqual([])
  })

  it('runs a second transaction after the first instead of inside it', async () => {
    const order: string[] = []
    const first = remoteDatabase.transaction(async (tx) => {
      await tx.run('INSERT INTO notes (body) VALUES (?)', ['first'])
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('first done')
    })
    const second = remoteDatabase.transaction(async (tx) => {
      order.push('second started')
      await tx.run('INSERT INTO notes (body) VALUES (?)', ['second'])
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first done', 'second started'])
    expect(await bodies()).toEqual(['first', 'second'])
  })

  it('waits while the main process holds a transaction', async () => {
    let release!: () => void
    const held = ledger!.local.transaction(async (tx) => {
      await tx.run('INSERT INTO notes (body) VALUES (?)', ['sync'])
      await new Promise<void>((resolve) => { release = resolve })
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const read = bodies()
    release()
    await held
    expect(await read).toEqual(['sync'])
  })
})
