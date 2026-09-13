import { afterEach, describe, expect, it } from 'vitest'
import { NO_TRANSACTION_FILTERS, type PurchaseRecord, type SyncOperation } from '@ego/api-contracts'
import type { PurchaseInput } from '@ego/core'
import { applyOperation, applyOperations } from '../src/commands'
import { readBalances, readChanges, readReceiptDetail, readTransactionPage, serverSequence } from '../src/reads'
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
