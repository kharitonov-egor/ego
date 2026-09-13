import { afterEach, describe, expect, it } from 'vitest'
import type { TransactionInput } from '@ego/core'
import type { LocalDatabase } from '../lib/database/types'
import { writeFeedTransaction, writeRecord } from '../lib/database/writes'
import { localTransaction, localTransactionPage } from '../lib/repositories/transactions'
import { NO_TRANSACTION_FILTERS } from '@ego/api-contracts'
import { bootstrap, createSyncCoordinator, isBootstrapped } from '../lib/sync/coordinator'
import { keepMine, useSavedVersion } from '../lib/sync/conflicts'
import {
  createTransaction, deleteTransaction, updateTransaction
} from '../lib/sync/commands'
import { allOperations, commitLocalWrite, outboxEntry, retryDelayMs } from '../lib/sync/outbox'
import { openTestLedger } from './local-db'
import { fakeApi, feedRow, transactionChange } from './fake-api'

const NOW = '2026-09-12T10:00:00.000Z'
let db: (LocalDatabase & { raw: unknown }) | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

const input = (overrides: Partial<TransactionInput> = {}): TransactionInput => ({
  kind: 'expense', accountId: 'acc-check', destinationAccountId: null, categoryId: 'cat-food',
  amountCents: 4220, date: '2026-09-12', notes: 'Groceries', ...overrides
})

async function ledger(): Promise<LocalDatabase & { raw: unknown }> {
  const database = await openTestLedger()
  await writeRecord(database, {
    entity: 'account',
    record: {
      id: 'acc-check', name: 'Checking', kind: 'checking', icon: 'wallet', color: 'blue',
      openingBalanceCents: 10000, openingDate: '2026-01-01', archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1
    }
  })
  return database
}

describe('local writes', () => {
  it('commits the record and its operation together', async () => {
    db = await ledger()
    await createTransaction(db, input(), NOW, 'tx-1')
    expect((await localTransaction(db, 'tx-1'))?.amountCents).toBe(4220)
    const outbox = await allOperations(db)
    expect(outbox).toHaveLength(1)
    expect(outbox[0]).toMatchObject({ entity: 'transaction', entityId: 'tx-1', status: 'pending' })
  })

  it('leaves nothing behind when the local commit fails', async () => {
    db = await ledger()
    const broken = commitLocalWrite(db, {
      operationId: 'op-1', entityId: 'tx-1', expectedRevision: null, createdAt: NOW,
      command: { entity: 'transaction', type: 'create', payload: input() }
    }, async () => {
      throw new Error('disk full')
    })
    await expect(broken).rejects.toThrow('disk full')
    expect(await localTransaction(db, 'tx-1')).toBeNull()
    expect(await allOperations(db)).toHaveLength(0)
  })

  it('gives an edit the revision the server is expected to assign', async () => {
    db = await ledger()
    await createTransaction(db, input(), NOW, 'tx-1')
    await updateTransaction(db, 'tx-1', 1, input({ amountCents: 5000 }), NOW)
    const stored = await localTransaction(db, 'tx-1')
    expect(stored).toMatchObject({ amountCents: 5000, revision: 2 })
  })

  it('tombstones a deletion locally so the row leaves the feed', async () => {
    db = await ledger()
    await createTransaction(db, input(), NOW, 'tx-1')
    await deleteTransaction(db, 'tx-1', 1, NOW)
    expect(await localTransaction(db, 'tx-1')).toBeNull()
    expect((await allOperations(db)).map((entry) => entry.commandType)).toEqual(['create', 'delete'])
  })

  it('spreads retry delays and caps them', () => {
    expect(retryDelayMs(0, () => 0)).toBe(500)
    expect(retryDelayMs(0, () => 1)).toBe(1000)
    expect(retryDelayMs(20, () => 1)).toBe(60000)
  })
})

describe('bootstrap', () => {
  const reference = {
    ok: true as const,
    data: {
      accounts: [{
        id: 'acc-check', name: 'Checking', kind: 'checking' as const, icon: 'wallet', color: 'blue',
        openingBalanceCents: 10000, openingDate: '2026-01-01', archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1
      }],
      categories: [],
      serverSequence: 17
    }
  }

  it('records the starting sequence only after every page is stored', async () => {
    db = await openTestLedger()
    const api = fakeApi({
      reference: [reference],
      transactions: [
        { ok: true, data: { items: [feedRow({ id: 'tx-1' })], nextCursor: 'more', hasMore: true, totalCount: 2, queryIdentity: 'q' } },
        { ok: true, data: { items: [feedRow({ id: 'tx-2', date: '2026-09-11' })], nextCursor: null, hasMore: false, totalCount: 2, queryIdentity: 'q' } }
      ]
    })
    expect(await bootstrap({ db, api, now: () => NOW })).toBeNull()
    expect(await isBootstrapped(db)).toBe(true)
    const page = await localTransactionPage(db, NO_TRANSACTION_FILTERS, null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['tx-1', 'tx-2'])
    const state = await db.all<{ server_sequence: number }>('SELECT server_sequence FROM sync_state')
    expect(state[0].server_sequence).toBe(17)
  })

  it('stays unbootstrapped when a page fails, keeping the cursor behind the data', async () => {
    db = await openTestLedger()
    const api = fakeApi({
      reference: [reference],
      transactions: [
        { ok: true, data: { items: [feedRow({ id: 'tx-1' })], nextCursor: 'more', hasMore: true, totalCount: 2, queryIdentity: 'q' } },
        { ok: false, error: { code: 'OFFLINE', message: 'No network' } }
      ]
    })
    expect(await bootstrap({ db, api, now: () => NOW })).toMatchObject({ code: 'OFFLINE' })
    expect(await isBootstrapped(db)).toBe(false)
    const state = await db.all<{ server_sequence: number }>('SELECT server_sequence FROM sync_state')
    expect(state[0].server_sequence).toBe(0)
    expect((await localTransactionPage(db, NO_TRANSACTION_FILTERS, null, 50)).items).toHaveLength(1)
  })
})

describe('delivery', () => {
  async function bootstrapped(): Promise<LocalDatabase & { raw: unknown }> {
    const database = await ledger()
    await database.run("UPDATE sync_state SET bootstrapped_at = ? WHERE id = 1", [NOW])
    return database
  }

  it('clears the outbox and keeps the server revision', async () => {
    db = await bootstrapped()
    await createTransaction(db, input(), NOW, 'tx-1')
    const api = fakeApi()
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome).toMatchObject({ state: 'synced', delivered: 1, pendingCount: 0 })
    expect(await allOperations(db)).toHaveLength(0)
    expect((await localTransaction(db, 'tx-1'))?.pending).toBe('none')
  })

  it('treats a duplicate acknowledgement as success after a lost response', async () => {
    db = await bootstrapped()
    const operation = await createTransaction(db, input(), NOW, 'tx-1')
    const api = fakeApi({
      operations: [{
        ok: true,
        data: {
          results: [{
            operationId: operation.operationId, status: 'duplicate', entity: 'transaction',
            entityId: 'tx-1', revision: 1, serverSequence: 3
          }],
          failed: null,
          serverSequence: 3
        }
      }]
    })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome.state).toBe('synced')
    expect(await allOperations(db)).toHaveLength(0)
    expect(api.sentOperations[0][0].operationId).toBe(operation.operationId)
  })

  it('keeps the operation and its ID when the network fails', async () => {
    db = await bootstrapped()
    const operation = await createTransaction(db, input(), NOW, 'tx-1')
    const api = fakeApi({ operations: [{ ok: false, error: { code: 'OFFLINE', message: 'No network' } }] })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW, random: () => 0.5 }).sync()
    expect(outcome.state).toBe('offline')
    const entry = await outboxEntry(db, operation.operationId)
    expect(entry).toMatchObject({ status: 'pending', attempts: 1 })
    expect(entry?.nextAttemptAt).not.toBeNull()
    expect((await localTransaction(db, 'tx-1'))?.pending).toBe('pending')
  })

  it('pauses delivery when the credential is rejected', async () => {
    db = await bootstrapped()
    await createTransaction(db, input(), NOW, 'tx-1')
    const api = fakeApi({ operations: [{ ok: false, error: { code: 'AUTH_REQUIRED', message: 'Reconnect' } }] })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome).toMatchObject({ state: 'paused', pendingCount: 1 })
    expect((await allOperations(db))[0]).toMatchObject({ status: 'pending', attempts: 0 })
  })

  it('leaves a rejected transaction visible and needing attention', async () => {
    db = await bootstrapped()
    const operation = await createTransaction(db, input(), NOW, 'tx-1')
    const api = fakeApi({
      operations: [{
        ok: true,
        data: {
          results: [],
          failed: { operationId: operation.operationId, error: { code: 'CONFLICT', message: 'Source account is archived' } },
          serverSequence: 1
        }
      }]
    })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome).toMatchObject({ state: 'attention', conflictCount: 1 })
    expect((await localTransaction(db, 'tx-1'))?.pending).toBe('conflict')
  })

  it('runs one synchronisation at a time', async () => {
    db = await bootstrapped()
    await createTransaction(db, input(), NOW, 'tx-1')
    const api = fakeApi()
    const coordinator = createSyncCoordinator({ db, api, now: () => NOW })
    await Promise.all([coordinator.sync(), coordinator.sync(), coordinator.sync()])
    expect(api.sentOperations).toHaveLength(1)
  })
})

describe('applying remote changes', () => {
  async function bootstrapped(): Promise<LocalDatabase & { raw: unknown }> {
    const database = await ledger()
    await database.run("UPDATE sync_state SET bootstrapped_at = ? WHERE id = 1", [NOW])
    return database
  }

  it('adds a row another device created and advances the cursor', async () => {
    db = await bootstrapped()
    const api = fakeApi({
      changes: [
        { ok: true, data: { changes: [transactionChange({ seq: 5 })], cursor: 5, hasMore: false } },
        { ok: true, data: { changes: [], cursor: 5, hasMore: false } }
      ]
    })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome.serverSequence).toBe(5)
    expect((await localTransaction(db, 'tx-1'))?.amountCents).toBe(4220)
  })

  it('removes a row another device deleted', async () => {
    db = await bootstrapped()
    const api = fakeApi({
      changes: [
        { ok: true, data: { changes: [transactionChange({ seq: 5 })], cursor: 5, hasMore: false } },
        {
          ok: true,
          data: {
            changes: [transactionChange({ seq: 6, action: 'delete', revision: 2, record: null })],
            cursor: 6,
            hasMore: false
          }
        },
        { ok: true, data: { changes: [], cursor: 6, hasMore: false } }
      ]
    })
    const coordinator = createSyncCoordinator({ db, api, now: () => NOW })
    await coordinator.sync()
    await coordinator.sync()
    expect(await localTransaction(db, 'tx-1')).toBeNull()
  })

  it('does not overwrite a row that still has a pending local edit', async () => {
    db = await bootstrapped()
    await createTransaction(db, input({ amountCents: 999 }), NOW, 'tx-1')
    const api = fakeApi({
      operations: [{ ok: false, error: { code: 'OFFLINE', message: 'No network' } }],
      changes: [{ ok: true, data: { changes: [transactionChange({ seq: 5 })], cursor: 5, hasMore: false } }]
    })
    await createSyncCoordinator({ db, api, now: () => NOW, random: () => 0.5 }).sync()
    expect((await localTransaction(db, 'tx-1'))?.amountCents).toBe(999)
  })

  it('ignores a change that is older than the stored revision', async () => {
    db = await bootstrapped()
    const api = fakeApi({
      changes: [
        { ok: true, data: { changes: [transactionChange({ seq: 5, revision: 3, record: { ...transactionChange().record!, revision: 3, amountCents: 700 } })], cursor: 5, hasMore: false } },
        { ok: true, data: { changes: [transactionChange({ seq: 6, revision: 1 })], cursor: 6, hasMore: false } },
        { ok: true, data: { changes: [], cursor: 6, hasMore: false } }
      ]
    })
    const coordinator = createSyncCoordinator({ db, api, now: () => NOW })
    await coordinator.sync()
    await coordinator.sync()
    expect((await localTransaction(db, 'tx-1'))?.amountCents).toBe(700)
  })
})

describe('conflict resolution', () => {
  const savedRecord = transactionChange({
    seq: 9, revision: 4,
    record: { ...transactionChange().record!, revision: 4, amountCents: 1234, notes: 'Edited elsewhere' }
  })

  async function conflicted(): Promise<LocalDatabase & { raw: unknown }> {
    const database = await ledger()
    await database.run('UPDATE sync_state SET bootstrapped_at = ? WHERE id = 1', [NOW])
    await createTransaction(database, input(), NOW, 'tx-1')
    await createSyncCoordinator({ db: database, api: fakeApi(), now: () => NOW }).sync()
    const edit = await updateTransaction(database, 'tx-1', 1, input({ amountCents: 8000 }), NOW)
    const api = fakeApi({
      operations: [{
        ok: true,
        data: {
          results: [],
          failed: {
            operationId: edit.operationId,
            error: { code: 'CONFLICT', message: 'That record changed on another device', current: savedRecord }
          },
          serverSequence: 9
        }
      }]
    })
    const outcome = await createSyncCoordinator({ db: database, api, now: () => NOW }).sync()
    expect(outcome).toMatchObject({ state: 'attention', conflictCount: 1 })
    return database
  }

  it('holds the local command and the saved record for review', async () => {
    db = await conflicted()
    const entry = (await allOperations(db))[0]
    expect(entry.status).toBe('conflict')
    expect(entry.serverRecord?.revision).toBe(4)
    expect((await localTransaction(db, 'tx-1'))?.pending).toBe('conflict')
  })

  it('sends Keep mine as a new command against the current revision', async () => {
    db = await conflicted()
    const replacement = await keepMine(db, (await allOperations(db))[0], 'op-keep', NOW)
    expect(replacement.expectedRevision).toBe(4)
    const requeued = await allOperations(db)
    expect(requeued).toHaveLength(1)
    expect(requeued[0]).toMatchObject({ operationId: 'op-keep', status: 'pending' })
    expect(await localTransaction(db, 'tx-1')).toMatchObject({ amountCents: 8000, revision: 5 })
  })

  it('takes the saved version and drops the local command', async () => {
    db = await conflicted()
    await useSavedVersion(db, (await allOperations(db))[0], NOW)
    expect(await allOperations(db)).toHaveLength(0)
    expect(await localTransaction(db, 'tx-1'))
      .toMatchObject({ amountCents: 1234, revision: 4, pending: 'none' })
  })
})

describe('working without a network', () => {
  it('serves stored history and accepts a new transaction while every request fails', async () => {
    const database = await ledger()
    await database.run('UPDATE sync_state SET bootstrapped_at = ? WHERE id = 1', [NOW])
    db = database
    await writeFeedTransaction(database, feedRow({ id: 'tx-old', date: '2026-09-01' }))
    const offline = { ok: false as const, error: { code: 'OFFLINE' as const, message: 'No network' } }
    const api = fakeApi({
      reference: [offline], transactions: [offline], changes: [offline], operations: [offline]
    })

    const created = await createTransaction(database, input({ amountCents: 600 }), NOW, 'tx-new')
    const page = await localTransactionPage(database, NO_TRANSACTION_FILTERS, null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['tx-new', 'tx-old'])
    expect(page.items[0].pending).toBe('pending')

    const outcome = await createSyncCoordinator({ db: database, api, now: () => NOW, random: () => 0.5 }).sync()
    expect(outcome.state).toBe('offline')
    expect(outcome.pendingCount).toBe(1)

    const survived = await outboxEntry(database, created.operationId)
    expect(survived).toMatchObject({ operationId: created.operationId, status: 'pending' })
    expect((await localTransactionPage(database, NO_TRANSACTION_FILTERS, null, 50)).items).toHaveLength(2)
  })

  it('accepts acknowledgements that come back out of order', async () => {
    const database = await ledger()
    await database.run('UPDATE sync_state SET bootstrapped_at = ? WHERE id = 1', [NOW])
    db = database
    const create = await createTransaction(database, input(), NOW, 'tx-1')
    const edit = await updateTransaction(database, 'tx-1', 1, input({ amountCents: 8000 }), NOW)
    const api = fakeApi({
      operations: [{
        ok: true,
        data: {
          results: [
            { operationId: edit.operationId, status: 'applied', entity: 'transaction', entityId: 'tx-1', revision: 2, serverSequence: 2 },
            { operationId: create.operationId, status: 'applied', entity: 'transaction', entityId: 'tx-1', revision: 1, serverSequence: 1 }
          ],
          failed: null,
          serverSequence: 2
        }
      }]
    })
    const outcome = await createSyncCoordinator({ db: database, api, now: () => NOW }).sync()
    expect(outcome.state).toBe('synced')
    expect(await allOperations(database)).toHaveLength(0)
    expect(await localTransaction(database, 'tx-1')).toMatchObject({ amountCents: 8000, revision: 2 })
  })
})
