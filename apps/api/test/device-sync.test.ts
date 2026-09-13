import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, SyncOperation } from '@ego/api-contracts'
import type { PurchaseInput, TransactionInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../mobile/lib/api-client'
import type { LocalDatabase } from '../../mobile/lib/database/types'
import {
  localBalances, localReceipt, localTransaction, localTransactionPage
} from '../../mobile/lib/repositories/transactions'
import {
  createPurchase, createTransaction, deleteTransaction, updateTransaction
} from '../../mobile/lib/sync/commands'
import { createSyncCoordinator } from '../../mobile/lib/sync/coordinator'
import { allOperations } from '../../mobile/lib/sync/outbox'
import { openTestLedger } from '../../mobile/test/local-db'
import { hashToken } from '../src/auth'
import { handle } from '../src/router'
import { readChanges, readTransactionPage } from '../src/reads'
import { NO_TRANSACTION_FILTERS } from '@ego/api-contracts'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'device-token-that-is-long-enough-0123456789'

let server: Ledger | null = null
let device: LocalDatabase | null = null

afterEach(async () => {
  server?.close()
  await device?.close()
  server = null
  device = null
})

interface Envelope {
  ok: boolean
  data?: unknown
  error?: { code: string; message: string }
}

/** The device's own HTTP client, pointed straight at the Worker's request handler. */
function apiOver(db: D1Database, calls: { count: number }): MoneyApi {
  const send = async <T>(path: string, init?: RequestInit): Promise<ApiResult<T>> => {
    calls.count += 1
    const response = await handle(new Request(`https://ego.example${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
    }), { DB: db })
    const payload = await response.json() as Envelope
    if (!payload.ok) {
      return { ok: false, error: (payload.error as ApiError | undefined) ?? { code: 'SERVER_ERROR', message: 'The request failed' } }
    }
    return { ok: true, data: payload.data as T }
  }
  return {
    reference: () => send('/v1/reference'),
    transactions: (filters, cursor, limit) => send(`/v1/transactions?${filterQuery(filters, cursor, limit)}`),
    receipt: (purchaseId) => send(`/v1/receipts/${encodeURIComponent(purchaseId)}`),
    balances: () => send('/v1/balances'),
    changes: (after, limit) => send(`/v1/changes?after=${after}&limit=${limit}`),
    operations: (operations) => send('/v1/operations', {
      method: 'POST',
      body: JSON.stringify({ operations })
    })
  }
}

async function enrolled(): Promise<Ledger> {
  const seeded = await seedLedger()
  await exec(seeded.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-1', 'Phone', ?, 'ego-money', ?)`, [await hashToken(TOKEN), NOW])
  return seeded
}

const input = (overrides: Partial<TransactionInput> = {}): TransactionInput => ({
  kind: 'expense', accountId: 'acc-check', destinationAccountId: null, categoryId: 'cat-food',
  amountCents: 4220, date: '2026-09-12', notes: 'Groceries', ...overrides
})

const receipt = (overrides: Partial<PurchaseInput> = {}): PurchaseInput => ({
  accountId: 'acc-check', categoryId: 'cat-food', merchant: 'Trader Joes', purchaseDate: '2026-09-12',
  currency: 'USD', subtotalCents: 4220, discountCents: 0, taxCents: 0, feesCents: 0, totalCents: 4220,
  items: [
    { name: 'Bananas', quantity: 2, unitPriceCents: 110, grossPriceCents: 220, discountCents: 0, lineTotalCents: 220 },
    { name: 'Coffee', quantity: 1, unitPriceCents: 4000, grossPriceCents: 4000, discountCents: 0, lineTotalCents: 4000 }
  ],
  ...overrides
})

async function pair(): Promise<{ coordinator: ReturnType<typeof createSyncCoordinator>; calls: { count: number } }> {
  server = await enrolled()
  device = await openTestLedger()
  const calls = { count: 0 }
  return {
    calls,
    coordinator: createSyncCoordinator({ db: device, api: apiOver(server.db, calls), now: () => NOW })
  }
}

async function serverCount(db: D1Database, table: string): Promise<number> {
  const result = await db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE deleted_at IS NULL`)
    .all<{ total: number }>()
  return result.results?.[0]?.total ?? 0
}

describe('device and Worker together', () => {
  it('bootstraps reference data and an empty ledger', async () => {
    const { coordinator } = await pair()
    const outcome = await coordinator.sync()
    expect(outcome.state).toBe('synced')
    const reference = await device!.all<{ id: string }>('SELECT id FROM accounts ORDER BY id')
    expect(reference.map((row) => row.id)).toEqual(['acc-check', 'acc-old', 'acc-savings'])
  })

  it('delivers an offline transaction once, even when the same operation is sent twice', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    const operation = await createTransaction(device!, input(), NOW, 'tx-1')
    await coordinator.sync()
    expect(await serverCount(server!.db, 'transactions')).toBe(1)

    const replay: SyncOperation = { ...operation }
    const response = await handle(new Request('https://ego.example/v1/operations', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [replay] })
    }), { DB: server!.db })
    const payload = await response.json() as { data: { results: Array<{ status: string }> } }
    expect(payload.data.results[0].status).toBe('duplicate')
    expect(await serverCount(server!.db, 'transactions')).toBe(1)
  })

  it('stores the same record on both sides', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createTransaction(device!, input(), NOW, 'tx-1')
    await coordinator.sync()
    const changes = await readChanges(server!.db, 0, 10)
    const change = changes.changes[0]
    expect(change.entity).toBe('transaction')
    if (change.entity !== 'transaction') return
    const stored = await localTransaction(device!, 'tx-1')
    expect(change.record).toMatchObject({
      id: stored?.id, amountCents: stored?.amountCents, date: stored?.date, notes: stored?.notes,
      revision: stored?.revision, createdAt: stored?.createdAt, updatedAt: stored?.updatedAt
    })
    expect(await allOperations(device!)).toHaveLength(0)
  })

  it('moves a transfer on both accounts and agrees with the server balances', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createTransaction(device!, input({
      kind: 'transfer', destinationAccountId: 'acc-savings', categoryId: null, amountCents: 2500
    }), NOW, 'tx-transfer')
    await coordinator.sync()
    const local = await localBalances(device!)
    const balanceOf = (accountId: string): number =>
      local.find((balance) => balance.accountId === accountId)?.balanceCents ?? 0
    expect(balanceOf('acc-check')).toBe(10000 - 2500)
    expect(balanceOf('acc-savings')).toBe(500 + 2500)
    const remote = await handle(new Request('https://ego.example/v1/balances', {
      headers: { authorization: `Bearer ${TOKEN}` }
    }), { DB: server!.db })
    const payload = await remote.json() as { data: { balances: Array<{ accountId: string; balanceCents: number }> } }
    expect([...payload.data.balances].sort((left, right) => left.accountId.localeCompare(right.accountId)))
      .toEqual([...local].sort((left, right) => left.accountId.localeCompare(right.accountId)))
  })

  it('saves a receipt and its items as one command', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createPurchase(device!, receipt(), NOW, 'p-1')
    await coordinator.sync()
    expect(await serverCount(server!.db, 'purchases')).toBe(1)
    const items = await server!.db.prepare('SELECT COUNT(*) AS total FROM receipt_items').all<{ total: number }>()
    expect(items.results?.[0]?.total).toBe(2)
    const stored = await localReceipt(device!, 'p-1')
    expect(stored?.purchase.items.map((item) => item.name)).toEqual(['Bananas', 'Coffee'])
    expect(stored?.itemsLoaded).toBe(true)
  })

  it("brings another device's edit down on the next sync", async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createTransaction(device!, input(), NOW, 'tx-1')
    await coordinator.sync()

    const desktopEdit = await handle(new Request('https://ego.example/v1/operations', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          operationId: 'desktop-1', entityId: 'tx-1', expectedRevision: 1, createdAt: NOW,
          command: { entity: 'transaction', type: 'update', payload: input({ amountCents: 9999, notes: 'From desktop' }) }
        }]
      })
    }), { DB: server!.db })
    expect(desktopEdit.status).toBe(200)

    await coordinator.sync()
    expect(await localTransaction(device!, 'tx-1')).toMatchObject({ amountCents: 9999, notes: 'From desktop', revision: 2 })
  })

  it('removes a row here after another device deletes it', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createTransaction(device!, input(), NOW, 'tx-1')
    await coordinator.sync()
    await handle(new Request('https://ego.example/v1/operations', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          operationId: 'desktop-delete', entityId: 'tx-1', expectedRevision: 1, createdAt: NOW,
          command: { entity: 'transaction', type: 'delete' }
        }]
      })
    }), { DB: server!.db })
    await coordinator.sync()
    expect(await localTransaction(device!, 'tx-1')).toBeNull()
    expect((await localTransactionPage(device!, NO_TRANSACTION_FILTERS, null, 50)).items).toHaveLength(0)
  })

  it('reports a conflict when this device edited a stale revision', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createTransaction(device!, input(), NOW, 'tx-1')
    await coordinator.sync()
    await handle(new Request('https://ego.example/v1/operations', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          operationId: 'desktop-2', entityId: 'tx-1', expectedRevision: 1, createdAt: NOW,
          command: { entity: 'transaction', type: 'update', payload: input({ amountCents: 700 }) }
        }]
      })
    }), { DB: server!.db })
    await updateTransaction(device!, 'tx-1', 1, input({ amountCents: 5000 }), NOW)
    const outcome = await coordinator.sync()
    expect(outcome.state).toBe('attention')
    const entry = (await allOperations(device!))[0]
    expect(entry.status).toBe('conflict')
    expect(entry.serverRecord).toMatchObject({ revision: 2 })
  })

  it('keeps the feed and the server page in the same order', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    for (const index of [0, 1, 2, 3, 4]) {
      await createTransaction(device!, input({
        amountCents: 100 + index,
        date: index % 2 === 0 ? '2026-09-12' : '2026-09-11'
      }), `2026-09-12T10:0${index}:00.000Z`, `tx-${index}`)
    }
    await coordinator.sync()
    const local = await localTransactionPage(device!, NO_TRANSACTION_FILTERS, null, 50)
    const remote = await readTransactionPage(server!.db, NO_TRANSACTION_FILTERS, null, 50)
    expect(local.items.map((item) => item.id)).toEqual(remote.items.map((item) => item.id))
    expect(local.totalCount).toBe(remote.totalCount)
  })

  it('records a deletion the device made while the server was unreachable', async () => {
    const { coordinator } = await pair()
    await coordinator.sync()
    await createTransaction(device!, input(), NOW, 'tx-1')
    await coordinator.sync()
    await deleteTransaction(device!, 'tx-1', 1, NOW)
    expect(await localTransaction(device!, 'tx-1')).toBeNull()
    await coordinator.sync()
    expect(await serverCount(server!.db, 'transactions')).toBe(0)
  })
})
