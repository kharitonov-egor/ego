import { afterEach, describe, expect, it } from 'vitest'
import { NO_TRANSACTION_FILTERS, decodeCursor, type TransactionFilters } from '@ego/api-contracts'
import { calculateAccountBalance } from '@ego/core'
import {
  pageSizeFrom, readBalances, readSummary, readTransactionDetail, readTransactionPage
} from '../src/reads'
import { addTransaction, exec, expense, seedLedger, type Ledger } from './helpers'

let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

const filters = (overrides: Partial<TransactionFilters> = {}): TransactionFilters =>
  ({ ...NO_TRANSACTION_FILTERS, ...overrides })

async function ledgerOf(count: number, date = '2026-09-12'): Promise<Ledger> {
  const seeded = await seedLedger()
  for (let index = 0; index < count; index += 1) {
    await addTransaction(seeded, expense(`tx-${String(index).padStart(4, '0')}`, date, 100 + index))
  }
  return seeded
}

describe('transaction pages', () => {
  it('walks every row exactly once across keyset pages with tied dates', async () => {
    ledger = await ledgerOf(121)
    const seen: string[] = []
    let cursor = null
    let pages = 0
    do {
      const page = await readTransactionPage(ledger.db, filters(), cursor, 50)
      seen.push(...page.items.map((item) => item.id))
      expect(page.totalCount).toBe(121)
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

  it('reports no further page when the last row lands on a page boundary', async () => {
    ledger = await ledgerOf(50)
    const page = await readTransactionPage(ledger.db, filters(), null, 50)
    expect(page.items).toHaveLength(50)
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('returns an empty page for a ledger with no matching rows', async () => {
    ledger = await ledgerOf(3)
    const page = await readTransactionPage(ledger.db, filters({ search: 'nothing here' }), null, 50)
    expect(page).toMatchObject({ items: [], hasMore: false, nextCursor: null, totalCount: 0 })
  })

  it('caps the page size a caller may request', () => {
    expect(pageSizeFrom('500')).toBe(100)
    expect(pageSizeFrom(null)).toBe(50)
    expect(pageSizeFrom('0')).toBe(50)
    expect(pageSizeFrom('nonsense')).toBe(50)
  })

  it('orders by date, then creation time, then ID', async () => {
    ledger = await seedLedger()
    await addTransaction(ledger, expense('b', '2026-09-11', 100))
    await addTransaction(ledger, expense('a', '2026-09-12', 100, { createdAt: '2026-09-12T08:00:00.000Z' }))
    await addTransaction(ledger, expense('c', '2026-09-12', 100, { createdAt: '2026-09-12T09:00:00.000Z' }))
    await addTransaction(ledger, expense('d', '2026-09-12', 100, { createdAt: '2026-09-12T09:00:00.000Z' }))
    const page = await readTransactionPage(ledger.db, filters(), null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['d', 'c', 'a', 'b'])
  })

  it('leaves tombstoned rows out of the feed and the count', async () => {
    ledger = await ledgerOf(3)
    await exec(ledger.db, "UPDATE transactions SET deleted_at = ? WHERE id = 'tx-0001'", ['2026-09-12T11:00:00.000Z'])
    const page = await readTransactionPage(ledger.db, filters(), null, 50)
    expect(page.totalCount).toBe(2)
    expect(page.items.map((item) => item.id)).toEqual(['tx-0002', 'tx-0000'])
  })
})

describe('search and filters', () => {
  async function searchable(): Promise<Ledger> {
    const seeded = await seedLedger()
    await addTransaction(seeded, expense('tx-receipt', '2026-09-12', 4220, { notes: 'Weekly shop' }))
    await addTransaction(seeded, expense('tx-transfer', '2026-09-11', 2000, {
      kind: 'transfer', destinationAccountId: 'acc-savings', categoryId: null, notes: 'Move'
    }))
    await addTransaction(seeded, expense('tx-literal', '2026-09-10', 500, { notes: '50% off day' }))
    await exec(seeded.db, `INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
      subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at, revision)
      VALUES ('p-1', 'tx-receipt', 'Trader Joes', '2026-09-12', 'USD', 4220, 0, 0, 0, 4220,
      '2026-09-12T09:00:00.000Z', '2026-09-12T09:00:00.000Z', 1)`)
    return seeded
  }

  it('matches receipt merchants', async () => {
    ledger = await searchable()
    const page = await readTransactionPage(ledger.db, filters({ search: 'trader' }), null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['tx-receipt'])
    expect(page.items[0].merchant).toBe('Trader Joes')
    expect(page.items[0].hasReceipt).toBe(true)
  })

  it('matches the destination account name of a transfer', async () => {
    ledger = await searchable()
    const page = await readTransactionPage(ledger.db, filters({ search: 'savings' }), null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['tx-transfer'])
  })

  it('treats a percent sign in the search text as a literal character', async () => {
    ledger = await searchable()
    const page = await readTransactionPage(ledger.db, filters({ search: '50%' }), null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['tx-literal'])
  })

  it('includes a transfer when either of its accounts is filtered', async () => {
    ledger = await searchable()
    const page = await readTransactionPage(ledger.db, filters({ accountIds: ['acc-savings'] }), null, 50)
    expect(page.items.map((item) => item.id)).toEqual(['tx-transfer'])
  })

  it('applies the date range to rows and the count together', async () => {
    ledger = await searchable()
    const page = await readTransactionPage(ledger.db, filters({ from: '2026-09-11', to: '2026-09-12' }), null, 50)
    expect(page.items).toHaveLength(2)
    expect(page.totalCount).toBe(2)
  })
})

describe('aggregates', () => {
  it('matches the core balance calculation, including transfers and archived accounts', async () => {
    ledger = await seedLedger()
    await addTransaction(ledger, expense('tx-1', '2026-09-01', 4220))
    await addTransaction(ledger, expense('tx-2', '2026-09-02', 250000, {
      kind: 'income', categoryId: 'cat-salary'
    }))
    await addTransaction(ledger, expense('tx-3', '2026-09-03', 5000, {
      kind: 'transfer', destinationAccountId: 'acc-savings', categoryId: null
    }))
    await addTransaction(ledger, expense('tx-4', '2025-12-01', 700, { accountId: 'acc-old' }))
    const { balances } = await readBalances(ledger.db)
    const expected = [
      { accountId: 'acc-check', openingBalanceCents: 10000 },
      { accountId: 'acc-savings', openingBalanceCents: 500 },
      { accountId: 'acc-old', openingBalanceCents: 0 }
    ].map((account) => ({
      accountId: account.accountId,
      balanceCents: calculateAccountBalance({ id: account.accountId, openingBalanceCents: account.openingBalanceCents }, ledger!.transactions)
    }))
    expect([...balances].sort((left, right) => left.accountId.localeCompare(right.accountId)))
      .toEqual([...expected].sort((left, right) => left.accountId.localeCompare(right.accountId)))
  })

  it('never lets a loaded page change a balance', async () => {
    ledger = await ledgerOf(60)
    const before = await readBalances(ledger.db)
    await readTransactionPage(ledger.db, filters(), null, 50)
    expect(await readBalances(ledger.db)).toEqual(before)
  })

  it('keeps transfers out of the period net', async () => {
    ledger = await seedLedger()
    await addTransaction(ledger, expense('tx-1', '2026-09-01', 4220))
    await addTransaction(ledger, expense('tx-2', '2026-09-02', 250000, { kind: 'income', categoryId: 'cat-salary' }))
    await addTransaction(ledger, expense('tx-3', '2026-09-03', 5000, {
      kind: 'transfer', destinationAccountId: 'acc-savings', categoryId: null
    }))
    await addTransaction(ledger, expense('tx-old', '2026-08-30', 999))
    const summary = await readSummary(ledger.db, '2026-09-01', '2026-09-30')
    expect(summary).toMatchObject({
      incomeCents: 250000, expenseCents: 4220, netCents: 245780, transferCents: 5000
    })
  })
})

describe('transaction detail', () => {
  it('returns the receipt linkage with the transaction', async () => {
    ledger = await seedLedger()
    await addTransaction(ledger, expense('tx-receipt', '2026-09-12', 4220))
    await exec(ledger.db, `INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
      subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at, revision)
      VALUES ('p-1', 'tx-receipt', 'Trader Joes', '2026-09-12', 'USD', 4220, 0, 0, 0, 4220,
      '2026-09-12T09:00:00.000Z', '2026-09-12T09:00:00.000Z', 1)`)
    await exec(ledger.db, `INSERT INTO receipt_items (id, purchase_id, position, name, quantity,
      unit_price_cents, gross_price_cents, discount_cents, line_total_cents)
      VALUES ('i-1', 'p-1', 0, 'Bananas', 1, 4220, 4220, 0, 4220)`)
    const detail = await readTransactionDetail(ledger.db, 'tx-receipt')
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.data.transaction.accountName).toBe('Checking')
    expect(detail.data.purchase?.items.map((item) => item.name)).toEqual(['Bananas'])
  })

  it('reports a missing transaction instead of an empty record', async () => {
    ledger = await seedLedger()
    const detail = await readTransactionDetail(ledger.db, 'tx-missing')
    expect(detail).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })
})
