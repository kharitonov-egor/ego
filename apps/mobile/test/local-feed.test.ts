import { afterEach, describe, expect, it } from 'vitest'
import { NO_TRANSACTION_FILTERS, decodeCursor, type TransactionFilters } from '@ego/api-contracts'
import { calculateAccountBalance, type MoneyTransaction } from '@ego/core'
import { writeFeedTransaction, writeRecord, writeTombstone } from '../lib/database/writes'
import type { LocalDatabase } from '../lib/database/types'
import {
  localBalances, localPurchasePage, localReceipt, localReference, localSummary, localTransaction, localTransactionPage
} from '../lib/repositories/transactions'
import {
  localBalanceAt, localBudgetBreaches, localTransactionBounds, localTransactionsInRange
} from '../lib/repositories/snapshot'
import { createTransaction } from '../lib/sync/commands'
import { openTestLedger } from './local-db'
import { feedRow } from './fake-api'

let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

const filters = (overrides: Partial<TransactionFilters> = {}): TransactionFilters =>
  ({ ...NO_TRANSACTION_FILTERS, ...overrides })

async function seedAccounts(database: LocalDatabase): Promise<void> {
  await writeRecord(database, {
    entity: 'account',
    record: {
      id: 'acc-check', name: 'Checking', kind: 'checking', icon: 'wallet', color: 'blue',
      openingBalanceCents: 10000, openingDate: '2026-01-01', archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1
    }
  })
  await writeRecord(database, {
    entity: 'account',
    record: {
      id: 'acc-savings', name: 'Savings', kind: 'savings', icon: 'bank', color: 'green',
      openingBalanceCents: 500, openingDate: '2026-01-01', archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1
    }
  })
  await writeRecord(database, {
    entity: 'category',
    record: {
      id: 'cat-food', name: 'Food', kind: 'expense', icon: 'cart', color: 'orange', archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1
    }
  })
}

async function seedFeed(database: LocalDatabase, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await writeFeedTransaction(database, feedRow({
      id: `tx-${String(index).padStart(4, '0')}`,
      amountCents: 100 + index
    }))
  }
}

describe('local feed', () => {
  it('pages the stored history with the same keyset the API uses', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await seedFeed(db, 121)
    const seen: string[] = []
    let cursor = null
    let pages = 0
    do {
      const page = await localTransactionPage(db, filters(), cursor, 50)
      seen.push(...page.items.map((item) => item.id))
      expect(page.totalCount).toBe(pages === 0 ? 121 : null)
      pages += 1
      cursor = page.nextCursor === null
        ? null
        : (() => {
          const decoded = decodeCursor(page.nextCursor, filters())
          return decoded.ok ? decoded.data : null
        })()
    } while (cursor)
    expect(pages).toBe(3)
    expect(new Set(seen).size).toBe(121)
    expect(seen[0]).toBe('tx-0120')
  })

  it('answers a filter change without any remote call', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await writeFeedTransaction(db, feedRow({ id: 'tx-1', notes: 'Coffee beans' }))
    await writeFeedTransaction(db, feedRow({ id: 'tx-2', notes: 'Bus fare', date: '2026-08-01' }))
    expect((await localTransactionPage(db, filters({ search: 'coffee' }), null, 50)).items.map((item) => item.id))
      .toEqual(['tx-1'])
    expect((await localTransactionPage(db, filters({ from: '2026-09-01' }), null, 50)).items.map((item) => item.id))
      .toEqual(['tx-1'])
  })

  it('keeps a receipt row addressable by its own purchase ID', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await writeFeedTransaction(db, feedRow({ id: 'tx-1', merchant: 'Trader Joes', purchaseId: 'p-1' }))
    const stored = await localTransaction(db, 'tx-1')
    expect(stored?.purchaseId).toBe('p-1')
    expect(stored?.hasReceipt).toBe(true)
  })

  it('pages purchase headers and loads items only for the opened receipt', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    for (let index = 0; index < 3; index += 1) {
      const id = `tx-${index}`
      const purchaseId = `purchase-${index}`
      await writeFeedTransaction(db, feedRow({ id, purchaseId, merchant: `Shop ${index}` }))
      await writeRecord(db, {
        entity: 'purchase',
        record: {
          id: purchaseId,
          transactionId: id,
          merchant: `Shop ${index}`,
          purchaseDate: `2026-09-${10 + index}`,
          currency: 'USD',
          subtotalCents: 100,
          discountCents: 0,
          taxCents: 0,
          feesCents: 0,
          totalCents: 100,
          createdAt: `2026-09-${10 + index}T10:00:00.000Z`,
          updatedAt: `2026-09-${10 + index}T10:00:00.000Z`,
          revision: 1,
          items: [{
            id: `item-${index}`,
            purchaseId,
            position: 0,
            name: `Item ${index}`,
            quantity: 1,
            unitPriceCents: 100,
            grossPriceCents: 100,
            discountCents: 0,
            lineTotalCents: 100
          }]
        }
      })
    }

    const first = await localPurchasePage(db, 2)
    expect(first.items.map((item) => [item.id, item.itemCount])).toEqual([
      ['purchase-2', 1], ['purchase-1', 1]
    ])
    expect(first.nextOffset).toBe(2)
    const second = await localPurchasePage(db, 2, first.nextOffset ?? 0)
    expect(second.items.map((item) => item.id)).toEqual(['purchase-0'])
    expect((await localReceipt(db, 'purchase-2'))?.purchase.items[0]?.name).toBe('Item 2')
  })

  it('hides a tombstoned row from the feed and the count', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await seedFeed(db, 3)
    await writeTombstone(db, 'transaction', 'tx-0001', 2, '2026-09-12T11:00:00.000Z')
    const page = await localTransactionPage(db, filters(), null, 50)
    expect(page.totalCount).toBe(2)
    expect(page.items.map((item) => item.id)).toEqual(['tx-0002', 'tx-0000'])
  })

  it('marks rows that are still waiting for the server', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await createTransaction(db, {
      kind: 'expense', accountId: 'acc-check', destinationAccountId: null, categoryId: 'cat-food',
      amountCents: 600, date: '2026-09-12', notes: 'Coffee'
    }, '2026-09-12T10:00:00.000Z', 'tx-pending')
    const page = await localTransactionPage(db, filters(), null, 50)
    expect(page.items.map((item) => [item.id, item.pending])).toEqual([['tx-pending', 'pending']])
  })

  it('computes balances over the whole ledger, matching the core rules', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    const transactions: MoneyTransaction[] = [
      { ...feedRow({ id: 'tx-1', amountCents: 4220 }) },
      { ...feedRow({ id: 'tx-2', kind: 'income', amountCents: 250000 }) },
      {
        ...feedRow({
          id: 'tx-3', kind: 'transfer', amountCents: 5000, destinationAccountId: 'acc-savings',
          categoryId: null
        })
      }
    ]
    for (const transaction of transactions) {
      await writeFeedTransaction(db, feedRow({ ...transaction, accountName: 'Checking' }))
    }
    const balances = await localBalances(db)
    const expected = [
      { accountId: 'acc-check', openingBalanceCents: 10000 },
      { accountId: 'acc-savings', openingBalanceCents: 500 }
    ].map((account) => ({
      accountId: account.accountId,
      balanceCents: calculateAccountBalance(
        { id: account.accountId, openingBalanceCents: account.openingBalanceCents }, transactions)
    }))
    expect(balances).toEqual(expected)
  })

  it('bounds Overview reads to its dates and computes a past balance in SQL', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await writeFeedTransaction(db, feedRow({ id: 'tx-1', date: '2026-09-01', amountCents: 1000 }))
    await writeFeedTransaction(db, feedRow({ id: 'tx-2', date: '2026-09-02', kind: 'income', amountCents: 5000 }))
    await writeFeedTransaction(db, feedRow({
      id: 'tx-3', date: '2026-09-03', kind: 'transfer', amountCents: 2000,
      destinationAccountId: 'acc-savings', categoryId: null
    }))

    expect(await localTransactionBounds(db)).toEqual({ earliest: '2026-09-01', latest: '2026-09-03' })
    expect((await localTransactionsInRange(db, '2026-09-02', '2026-09-02')).map((item) => item.id))
      .toEqual(['tx-2'])
    expect(await localBalanceAt(db, '2026-09-02')).toBe(14500)
  })

  it('leaves transfers out of the period net', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await writeFeedTransaction(db, feedRow({ id: 'tx-1', amountCents: 4220 }))
    await writeFeedTransaction(db, feedRow({ id: 'tx-2', kind: 'income', amountCents: 250000 }))
    await writeFeedTransaction(db, feedRow({
      id: 'tx-3', kind: 'transfer', amountCents: 5000, destinationAccountId: 'acc-savings', categoryId: null
    }))
    const summary = await localSummary(db, '2026-09-01', '2026-09-30')
    expect(summary).toMatchObject({ incomeCents: 250000, expenseCents: 4220, netCents: 245780, transferCents: 5000 })
  })

  it('finds budget breaches without building a money snapshot', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await writeFeedTransaction(db, feedRow({ id: 'tx-1', amountCents: 12000 }))
    await writeRecord(db, {
      entity: 'budget',
      record: {
        id: 'budget-1',
        month: '2026-09',
        plannedIncomeCents: 100000,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        revision: 1,
        allocations: [{ id: 'allocation-1', budgetId: 'budget-1', categoryId: 'cat-food', amountCents: 10000 }]
      }
    })
    const breaches = await localBudgetBreaches(db)
    expect(breaches).toMatchObject([{
      month: '2026-09',
      category: { categoryId: 'cat-food', allocatedCents: 10000, spentCents: 12000, state: 'over' }
    }])
  })

  it('reads reference data including the stored server sequence', async () => {
    db = await openTestLedger()
    await seedAccounts(db)
    await db.run('UPDATE sync_state SET server_sequence = 42 WHERE id = 1')
    const reference = await localReference(db)
    expect(reference.accounts.map((account) => account.id)).toEqual(['acc-check', 'acc-savings'])
    expect(reference.categories.map((category) => category.id)).toEqual(['cat-food'])
    expect(reference.serverSequence).toBe(42)
  })
})
