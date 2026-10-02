import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeRecord } from '@ego/local/database/writes'
import { createTransaction } from '@ego/local/sync/commands'
import { allOperations } from '@ego/local/sync/outbox'
import { openLedgerDatabase, type LedgerDatabase } from './database'

let folder = ''
let database: LedgerDatabase | null = null

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'ego-ledger-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await database?.close()
  database = null
  rmSync(folder, { recursive: true, force: true })
})

async function open(): Promise<LedgerDatabase> {
  database = await openLedgerDatabase(join(folder, 'ledger.db'))
  await database.local.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  return database
}

const bodies = async (db: LedgerDatabase): Promise<string[]> =>
  (await db.all(null, 'SELECT body FROM notes ORDER BY id', [])).map((row) => String(row.body))

describe('the main-process ledger database', () => {
  it('migrates a new file so the phone schema is in place', async () => {
    const db = await open()
    const tables = await db.all(null, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('outbox', 'sync_state', 'transactions')", [])
    expect(tables.map((row) => row.name).sort()).toEqual(['outbox', 'sync_state', 'transactions'])
  })

  it('keeps a statement from this process out of a transaction the renderer holds open', async () => {
    const db = await open()
    const transaction = await db.begin()
    await db.run(transaction, 'INSERT INTO notes (body) VALUES (?)', ['from the renderer'])

    let landed = false
    const background = db.local.run('INSERT INTO notes (body) VALUES (?)', ['from sync']).then(() => { landed = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(landed).toBe(false)

    db.finish(transaction, false)
    await background
    expect(await bodies(db)).toEqual(['from sync'])
  })

  it('commits what the renderer wrote once it finishes', async () => {
    const db = await open()
    const transaction = await db.begin()
    await db.run(transaction, 'INSERT INTO notes (body) VALUES (?)', ['kept'])
    db.finish(transaction, true)
    expect(await bodies(db)).toEqual(['kept'])
  })

  it('lets a transaction in this process call the outer handle without waiting on itself', async () => {
    const db = await open()
    await db.local.transaction(async (tx) => {
      await tx.run('INSERT INTO notes (body) VALUES (?)', ['inside'])
      await db.local.run('INSERT INTO notes (body) VALUES (?)', ['outer handle, same transaction'])
    })
    expect(await bodies(db)).toEqual(['inside', 'outer handle, same transaction'])
  })

  it('rolls back a transaction in this process that throws', async () => {
    const db = await open()
    await expect(db.local.transaction(async (tx) => {
      await tx.run('INSERT INTO notes (body) VALUES (?)', ['lost'])
      throw new Error('stop')
    })).rejects.toThrow('stop')
    expect(await bodies(db)).toEqual([])
  })

  it('rolls back and frees the database when the renderer goes quiet mid-transaction', async () => {
    vi.useFakeTimers()
    const db = await open()
    const transaction = await db.begin()
    await db.run(transaction, 'INSERT INTO notes (body) VALUES (?)', ['abandoned'])
    const waiting = db.local.all('SELECT body FROM notes')
    await vi.advanceTimersByTimeAsync(15000)
    expect(await waiting).toEqual([])
    await expect(db.run(transaction, 'INSERT INTO notes (body) VALUES (?)', ['late'])).rejects.toThrow('already ended')
  })

  it('rolls back whatever the renderer left open after a reload', async () => {
    const db = await open()
    const transaction = await db.begin()
    await db.run(transaction, 'INSERT INTO notes (body) VALUES (?)', ['before reload'])
    db.abandonRendererTransactions()
    expect(await bodies(db)).toEqual([])
  })

  it('runs the phone commands unchanged, writing the record and its outbox entry together', async () => {
    const db = await open()
    await writeRecord(db.local, {
      entity: 'account',
      record: {
        id: 'acc-check', name: 'Checking', kind: 'checking', icon: 'wallet', color: 'blue',
        openingBalanceCents: 10000, openingDate: '2026-01-01', archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1
      }
    })
    await createTransaction(db.local, {
      kind: 'expense', accountId: 'acc-check', destinationAccountId: null, categoryId: null,
      amountCents: 4220, date: '2026-09-12', notes: 'Groceries'
    }, '2026-09-12T10:00:00.000Z', 'txn-1')
    const outbox = await allOperations(db.local)
    expect(outbox.map((entry) => [entry.entity, entry.entityId])).toEqual([['transaction', 'txn-1']])
    const rows = await db.all(null, 'SELECT amount_cents FROM transactions WHERE id = ?', ['txn-1'])
    expect(rows).toEqual([{ amount_cents: 4220 }])
  })
})
