import { afterEach, describe, expect, it } from 'vitest'
import { NO_TRANSACTION_FILTERS, type PurchaseRecord, type SyncOperation } from '@ego/api-contracts'
import type { HabitEntryInput, HabitInput, MoodInput, PurchaseInput } from '@ego/core'
import { applyOperation, applyOperations } from '../src/commands'
import {
  readBalances, readBootstrap, readChanges, readReceiptDetail, readTransactionPage, serverSequence
} from '../src/reads'
import {
  NOW, addTransaction, exec, expense, operation, seedLedger, transactionInput, type Ledger
} from './helpers'

let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

const feed = (db: D1Database) => readTransactionPage(db, NO_TRANSACTION_FILTERS, null, 50)

const purchaseInput = (overrides: Partial<PurchaseInput> = {}): PurchaseInput => ({
  accountId: 'acc-check', categoryId: 'cat-food', merchant: 'Trader Joes', purchaseDate: '2026-09-12',
  currency: 'USD', subtotalCents: 4220, discountCents: 0, taxCents: 0, feesCents: 0, totalCents: 4220,
  items: [
    { name: 'Bananas', quantity: 2, unitPriceCents: 110, grossPriceCents: 220, discountCents: 0, lineTotalCents: 220 },
    { name: 'Coffee', quantity: 1, unitPriceCents: 4000, grossPriceCents: 4000, discountCents: 0, lineTotalCents: 4000 }
  ],
  ...overrides
})

async function count(db: D1Database, table: string): Promise<number> {
  const result = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).all<{ total: number }>()
  return result.results?.[0]?.total ?? 0
}

describe('operation delivery', () => {
  it('creates a transaction and records one change', async () => {
    ledger = await seedLedger()
    const result = await applyOperation(ledger.db, operation(), NOW)
    expect(result).toMatchObject({ ok: true, data: { status: 'applied', revision: 1, entityId: 'tx-new' } })
    const page = await feed(ledger.db)
    expect(page.items.map((item) => item.id)).toEqual(['tx-new'])
    const changes = await readChanges(ledger.db, 0, 50)
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({ entity: 'transaction', action: 'upsert', revision: 1 })
  })

  it('creates one transaction when the same operation arrives twice', async () => {
    ledger = await seedLedger()
    const first = await applyOperation(ledger.db, operation(), NOW)
    const second = await applyOperation(ledger.db, operation(), '2026-09-12T10:05:00.000Z')
    expect(first).toMatchObject({ ok: true, data: { status: 'applied' } })
    expect(second).toMatchObject({ ok: true, data: { status: 'duplicate', revision: 1 } })
    expect(await count(ledger.db, 'transactions')).toBe(1)
    expect(await count(ledger.db, 'changes')).toBe(1)
  })

  it('refuses an operation ID reused with a different payload', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation(), NOW)
    const changed = operation({
      command: { entity: 'transaction', type: 'create', payload: transactionInput({ amountCents: 999 }) }
    })
    expect(await applyOperation(ledger.db, changed, NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await count(ledger.db, 'transactions')).toBe(1)
  })

  it('rejects a stale revision and returns the current version', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation(), NOW)
    const update = (operationId: string, amountCents: number, expectedRevision: number): SyncOperation =>
      operation({
        operationId,
        expectedRevision,
        command: { entity: 'transaction', type: 'update', payload: transactionInput({ amountCents }) }
      })
    expect(await applyOperation(ledger.db, update('op-2', 5000, 1), NOW))
      .toMatchObject({ ok: true, data: { status: 'applied', revision: 2 } })
    const stale = await applyOperation(ledger.db, update('op-3', 6000, 1), NOW)
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.error.code).toBe('CONFLICT')
    expect(stale.error.current).toMatchObject({ entity: 'transaction', revision: 2 })
    const page = await feed(ledger.db)
    expect(page.items[0].amountCents).toBe(5000)
    expect(await count(ledger.db, 'changes')).toBe(2)
    expect(await count(ledger.db, 'operations')).toBe(2)
  })

  it('tombstones a delete so another device learns about it', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation(), NOW)
    const before = await serverSequence(ledger.db)
    const removed = await applyOperation(ledger.db, operation({
      operationId: 'op-delete', expectedRevision: 1, command: { entity: 'transaction', type: 'delete' }
    }), NOW)
    expect(removed).toMatchObject({ ok: true, data: { status: 'applied', revision: 2 } })
    expect((await feed(ledger.db)).items).toHaveLength(0)
    const changes = await readChanges(ledger.db, before, 50)
    expect(changes.changes).toHaveLength(1)
    expect(changes.changes[0]).toMatchObject({ action: 'delete', entityId: 'tx-new', record: null })
  })

  it('moves money on both sides of a transfer', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation({
      entityId: 'tx-transfer',
      command: {
        entity: 'transaction',
        type: 'create',
        payload: transactionInput({
          kind: 'transfer', destinationAccountId: 'acc-savings', categoryId: null, amountCents: 2500
        })
      }
    }), NOW)
    const { balances } = await readBalances(ledger.db)
    const balanceOf = (id: string): number =>
      balances.find((balance) => balance.accountId === id)?.balanceCents ?? 0
    expect(balanceOf('acc-check')).toBe(10000 - 2500)
    expect(balanceOf('acc-savings')).toBe(500 + 2500)
  })

  it('refuses a transaction that references an archived account', async () => {
    ledger = await seedLedger()
    const result = await applyOperation(ledger.db, operation({
      command: { entity: 'transaction', type: 'create', payload: transactionInput({ accountId: 'acc-old' }) }
    }), NOW)
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await count(ledger.db, 'transactions')).toBe(0)
    expect(await count(ledger.db, 'operations')).toBe(0)
  })

  it('stops delivery at the first failure and keeps the earlier results', async () => {
    ledger = await seedLedger()
    const response = await applyOperations(ledger.db, [
      operation(),
      operation({
        operationId: 'op-bad',
        entityId: 'tx-bad',
        command: { entity: 'transaction', type: 'create', payload: transactionInput({ accountId: 'acc-old' }) }
      }),
      operation({ operationId: 'op-3', entityId: 'tx-third' })
    ], NOW)
    expect(response.results).toHaveLength(1)
    expect(response.failed?.operationId).toBe('op-bad')
    expect(await count(ledger.db, 'transactions')).toBe(1)
  })
})

describe('receipts', () => {
  it('saves a receipt and its transaction as one command', async () => {
    ledger = await seedLedger()
    const result = await applyOperation(ledger.db, operation({
      entityId: 'p-1',
      command: { entity: 'purchase', type: 'create', payload: purchaseInput() }
    }), NOW)
    expect(result).toMatchObject({ ok: true, data: { entity: 'purchase', revision: 1 } })
    expect(await count(ledger.db, 'transactions')).toBe(1)
    expect(await count(ledger.db, 'receipt_items')).toBe(2)
    const detail = await readReceiptDetail(ledger.db, 'p-1')
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.data.purchase.totalCents).toBe(4220)
    const changes = await readChanges(ledger.db, 0, 50)
    expect(changes.changes.map((change) => change.entity)).toEqual(['transaction', 'purchase'])
  })

  it('leaves no partial receipt behind when the account is archived', async () => {
    ledger = await seedLedger()
    const result = await applyOperation(ledger.db, operation({
      entityId: 'p-1',
      command: { entity: 'purchase', type: 'create', payload: purchaseInput({ accountId: 'acc-old' }) }
    }), NOW)
    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await count(ledger.db, 'transactions')).toBe(0)
    expect(await count(ledger.db, 'purchases')).toBe(0)
    expect(await count(ledger.db, 'receipt_items')).toBe(0)
  })

  it('replaces receipt items on update and keeps the total matching', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation({
      entityId: 'p-1', command: { entity: 'purchase', type: 'create', payload: purchaseInput() }
    }), NOW)
    const updated = await applyOperation(ledger.db, operation({
      operationId: 'op-update', entityId: 'p-1', expectedRevision: 1,
      command: {
        entity: 'purchase',
        type: 'update',
        payload: purchaseInput({
          subtotalCents: 300, totalCents: 300,
          items: [{ name: 'Tea', quantity: 1, unitPriceCents: 300, grossPriceCents: 300, discountCents: 0, lineTotalCents: 300 }]
        })
      }
    }), NOW)
    expect(updated).toMatchObject({ ok: true, data: { revision: 2 } })
    expect(await count(ledger.db, 'receipt_items')).toBe(1)
    const page = await feed(ledger.db)
    expect(page.items[0].amountCents).toBe(300)
  })

  it('rolls back an update that lost the revision race', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation({
      entityId: 'p-1', command: { entity: 'purchase', type: 'create', payload: purchaseInput() }
    }), NOW)
    const stale = await applyOperation(ledger.db, operation({
      operationId: 'op-stale', entityId: 'p-1', expectedRevision: 7,
      command: {
        entity: 'purchase',
        type: 'update',
        payload: purchaseInput({
          subtotalCents: 300, totalCents: 300,
          items: [{ name: 'Tea', quantity: 1, unitPriceCents: 300, grossPriceCents: 300, discountCents: 0, lineTotalCents: 300 }]
        })
      }
    }), NOW)
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await count(ledger.db, 'receipt_items')).toBe(2)
    const detail = await readReceiptDetail(ledger.db, 'p-1')
    const purchase: PurchaseRecord | null = detail.ok ? detail.data.purchase : null
    expect(purchase?.totalCents).toBe(4220)
    expect(await count(ledger.db, 'operations')).toBe(1)
  })

  it('removes the receipt with its transaction', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation({
      entityId: 'p-1', command: { entity: 'purchase', type: 'create', payload: purchaseInput() }
    }), NOW)
    const removed = await applyOperation(ledger.db, operation({
      operationId: 'op-delete', entityId: 'p-1', expectedRevision: 1,
      command: { entity: 'purchase', type: 'delete' }
    }), NOW)
    expect(removed.ok).toBe(true)
    expect((await feed(ledger.db)).items).toHaveLength(0)
    expect((await readReceiptDetail(ledger.db, 'p-1')).ok).toBe(false)
  })
})

describe('budgets', () => {
  const budgetPayload = (amountCents: number) => ({
    month: '2026-09',
    plannedIncomeCents: 300000,
    allocations: [{ categoryId: 'cat-food', amountCents }]
  })

  it('saves and then updates a month', async () => {
    ledger = await seedLedger()
    const saved = await applyOperation(ledger.db, operation({
      entityId: '2026-09', command: { entity: 'budget', type: 'save', payload: budgetPayload(50000) }
    }), NOW)
    expect(saved).toMatchObject({ ok: true, data: { entity: 'budget', revision: 1 } })
    const updated = await applyOperation(ledger.db, operation({
      operationId: 'op-2', entityId: '2026-09', expectedRevision: 1,
      command: { entity: 'budget', type: 'save', payload: budgetPayload(60000) }
    }), NOW)
    expect(updated).toMatchObject({ ok: true, data: { revision: 2 } })
    expect(await count(ledger.db, 'budget_allocations')).toBe(1)
  })

  it('leaves allocations untouched when the revision is stale', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation({
      entityId: '2026-09', command: { entity: 'budget', type: 'save', payload: budgetPayload(50000) }
    }), NOW)
    const stale = await applyOperation(ledger.db, operation({
      operationId: 'op-stale', entityId: '2026-09', expectedRevision: 9,
      command: { entity: 'budget', type: 'save', payload: budgetPayload(90000) }
    }), NOW)
    expect(stale).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    const allocations = await ledger.db
      .prepare('SELECT amount_cents FROM budget_allocations')
      .all<{ amount_cents: number }>()
    expect(allocations.results).toEqual([{ amount_cents: 50000 }])
  })
})

describe('mood entries', () => {
  const save = (operationId: string, expectedRevision: number | null, mood: MoodInput['mood'], note = ''): SyncOperation =>
    operation({
      operationId, entityId: '2026-09-28', expectedRevision,
      command: { entity: 'mood', type: 'save', payload: { date: '2026-09-28', mood, note } }
    })

  it('saves a day, updates it, and downloads it in the bootstrap', async () => {
    ledger = await seedLedger()
    expect(await applyOperation(ledger.db, save('op-1', null, 3, '  Tired  '), NOW))
      .toMatchObject({ ok: true, data: { entity: 'mood', entityId: '2026-09-28', revision: 1 } })
    expect(await applyOperation(ledger.db, save('op-2', 1, 5, 'Better after the gym'), NOW))
      .toMatchObject({ ok: true, data: { revision: 2 } })
    const changes = await readChanges(ledger.db, 0, 50)
    expect(changes.changes.map((change) => change.entity)).toEqual(['mood', 'mood'])
    expect(changes.changes[0].record).toMatchObject({ mood: 3, note: 'Tired' })
    const downloaded = await readBootstrap(ledger.db)
    expect(downloaded.moods).toEqual([expect.objectContaining({
      id: 'mood-2026-09-28', date: '2026-09-28', mood: 5, note: 'Better after the gym', revision: 2
    })])
  })

  it('refuses a new entry for a day that already has one', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, save('op-1', null, 4), NOW)
    const second = await applyOperation(ledger.db, save('op-2', null, 1), NOW)
    expect(second).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    if (second.ok) return
    expect(second.error.current).toMatchObject({ entity: 'mood', revision: 1, record: { mood: 4 } })
  })

  it('clears a day and revives the same row when it is saved again', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, save('op-1', null, 2), NOW)
    const cleared = await applyOperation(ledger.db, operation({
      operationId: 'op-clear', entityId: '2026-09-28', expectedRevision: 1,
      command: { entity: 'mood', type: 'delete' }
    }), NOW)
    expect(cleared).toMatchObject({ ok: true, data: { revision: 2 } })
    expect((await readBootstrap(ledger.db)).moods).toHaveLength(0)
    expect(await applyOperation(ledger.db, save('op-3', null, 4), NOW))
      .toMatchObject({ ok: true, data: { revision: 3 } })
    expect(await count(ledger.db, 'mood_entries')).toBe(1)
    expect((await readBootstrap(ledger.db)).moods[0]).toMatchObject({ mood: 4, revision: 3 })
  })

  it('refuses a payload whose date differs from the entity ID', async () => {
    ledger = await seedLedger()
    const mismatched = operation({
      entityId: '2026-09-28',
      command: { entity: 'mood', type: 'save', payload: { date: '2026-09-27', mood: 3, note: '' } }
    })
    expect(await applyOperation(ledger.db, mismatched, NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })
})

describe('habits', () => {
  const habit = (overrides: Partial<HabitInput> = {}): HabitInput => ({
    name: '  Read  ', icon: '📚', kind: 'build', startDate: '2026-09-01', position: 0, ...overrides
  })
  const createHabit = (id: string, input: HabitInput, operationId = `op-${id}`): SyncOperation => operation({
    operationId, entityId: id, command: { entity: 'habit', type: 'create', payload: input }
  })
  const createEntry = (id: string, input: HabitEntryInput): SyncOperation => operation({
    operationId: `op-${id}`, entityId: id, command: { entity: 'habitEntry', type: 'create', payload: input }
  })

  it('creates, renames, and downloads a habit with its check-offs', async () => {
    ledger = await seedLedger()
    expect(await applyOperation(ledger.db, createHabit('hb-read', habit()), NOW))
      .toMatchObject({ ok: true, data: { entity: 'habit', entityId: 'hb-read', revision: 1 } })
    expect(await applyOperation(ledger.db, createEntry('he-1', { habitId: 'hb-read', date: '2026-09-12', kind: 'done' }), NOW))
      .toMatchObject({ ok: true, data: { entity: 'habitEntry', revision: 1 } })
    expect(await applyOperation(ledger.db, operation({
      operationId: 'op-rename', entityId: 'hb-read', expectedRevision: 1,
      command: { entity: 'habit', type: 'update', payload: habit({ name: 'Read 20 pages', position: 3 }) }
    }), NOW)).toMatchObject({ ok: true, data: { revision: 2 } })
    const changes = await readChanges(ledger.db, 0, 50)
    expect(changes.changes.map((change) => change.entity)).toEqual(['habit', 'habitEntry', 'habit'])
    expect(changes.changes[0].record).toMatchObject({ name: 'Read', startDate: '2026-09-01' })
    const downloaded = await readBootstrap(ledger.db)
    expect(downloaded.habits).toEqual([expect.objectContaining({ id: 'hb-read', name: 'Read 20 pages', position: 3, revision: 2 })])
    expect(downloaded.habitEntries).toEqual([expect.objectContaining({ id: 'he-1', habitId: 'hb-read', date: '2026-09-12', kind: 'done' })])
  })

  it('refuses an entry that does not fit the habit, and one for a deleted habit', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, createHabit('hb-read', habit()), NOW)
    await applyOperation(ledger.db, createHabit('hb-smoke', habit({ name: 'Smoking', kind: 'break' })), NOW)
    expect(await applyOperation(ledger.db, createEntry('he-1', { habitId: 'hb-read', date: '2026-09-12', kind: 'slipped' }), NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await applyOperation(ledger.db, createEntry('he-2', { habitId: 'hb-smoke', date: '2026-09-12', kind: 'done' }), NOW))
      .toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await applyOperation(ledger.db, createEntry('he-3', { habitId: 'hb-smoke', date: '2026-09-12', kind: 'resisted' }), NOW))
      .toMatchObject({ ok: true })
    expect(await applyOperation(ledger.db, operation({
      operationId: 'op-delete', entityId: 'hb-smoke', expectedRevision: 1, command: { entity: 'habit', type: 'delete' }
    }), NOW)).toMatchObject({ ok: true, data: { revision: 2 } })
    expect(await applyOperation(ledger.db, createEntry('he-4', { habitId: 'hb-smoke', date: '2026-09-12', kind: 'slipped' }), NOW))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect((await readBootstrap(ledger.db)).habits.map((item) => item.id)).toEqual(['hb-read'])
  })

  it('keeps a habit on the side it started on', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, createHabit('hb-read', habit()), NOW)
    expect(await applyOperation(ledger.db, operation({
      operationId: 'op-flip', entityId: 'hb-read', expectedRevision: 1,
      command: { entity: 'habit', type: 'update', payload: habit({ kind: 'break' }) }
    }), NOW)).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
  })

  it('unchecks a day by deleting its entry', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, createHabit('hb-read', habit()), NOW)
    await applyOperation(ledger.db, createEntry('he-1', { habitId: 'hb-read', date: '2026-09-12', kind: 'done' }), NOW)
    expect(await applyOperation(ledger.db, operation({
      operationId: 'op-uncheck', entityId: 'he-1', expectedRevision: 1, command: { entity: 'habitEntry', type: 'delete' }
    }), NOW)).toMatchObject({ ok: true, data: { revision: 2 } })
    expect((await readBootstrap(ledger.db)).habitEntries).toHaveLength(0)
    expect(await count(ledger.db, 'habit_entries')).toBe(1)
  })
})

describe('change pages', () => {
  it('returns committed changes after a sequence in order', async () => {
    ledger = await seedLedger()
    await addTransaction(ledger, expense('tx-legacy', '2026-09-01', 100))
    for (const index of [1, 2, 3]) {
      await applyOperation(ledger.db, operation({
        operationId: `op-${index}`, entityId: `tx-${index}`
      }), NOW)
    }
    const first = await readChanges(ledger.db, 0, 2)
    expect(first.changes.map((change) => change.entityId)).toEqual(['tx-1', 'tx-2'])
    expect(first.hasMore).toBe(true)
    const second = await readChanges(ledger.db, first.cursor, 2)
    expect(second.changes.map((change) => change.entityId)).toEqual(['tx-3'])
    expect(second.hasMore).toBe(false)
  })

  it('carries the committed record so a device can apply it without another read', async () => {
    ledger = await seedLedger()
    await applyOperation(ledger.db, operation(), NOW)
    const changes = await readChanges(ledger.db, 0, 50)
    const change = changes.changes[0]
    expect(change.entity).toBe('transaction')
    if (change.entity !== 'transaction') return
    expect(change.record).toMatchObject({ id: 'tx-new', amountCents: 4220, revision: 1, notes: 'Groceries' })
  })
})

describe('legacy writes', () => {
  it('ignores rows written outside the Worker when reporting changes', async () => {
    ledger = await seedLedger()
    await addTransaction(ledger, expense('tx-desktop', '2026-09-01', 100))
    await exec(ledger.db, "DELETE FROM transactions WHERE id = 'tx-desktop'")
    expect((await readChanges(ledger.db, 0, 50)).changes).toHaveLength(0)
  })
})
