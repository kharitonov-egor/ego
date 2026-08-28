import { describe, expect, it } from 'vitest'
import {
  calculateAccountBalance,
  createPurchaseStatements,
  deletePurchaseStatements,
  isAccountInput,
  isCategoryInput,
  isMoneySnapshot,
  isPurchaseInput,
  isReceiptDraft,
  isBudgetInput,
  isTransactionInput,
  MONEY_SCHEMA_QUERIES,
  budgetBreaches,
  budgetBreachMessage,
  deleteBudgetStatements,
  parseCachedSnapshot,
  saveBudgetStatements,
  summarizeBudget,
  receiptReconciliationWarnings,
  updatePurchaseStatements,
  type MoneySnapshot,
  type MoneyTransaction
} from '../src/money'

const baseTransaction = {
  categoryId: null,
  date: '2026-08-27',
  notes: '',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z'
}

describe('money input validation', () => {
  it('accepts signed opening balances', () => {
    expect(isAccountInput({
      name: 'Credit card', kind: 'credit-card', icon: 'CreditCard', color: '#ef4444',
      openingBalanceCents: -12500, openingDate: '2026-08-27'
    })).toBe(true)
  })

  it('rejects invalid category types', () => {
    expect(isCategoryInput({ name: 'Food', kind: 'transfer', icon: 'Utensils', color: '#fff' })).toBe(false)
  })

  it('rejects transfers to the source account', () => {
    expect(isTransactionInput({
      kind: 'transfer', accountId: 'one', destinationAccountId: 'one', categoryId: null,
      amountCents: 100, date: '2026-08-27', notes: ''
    })).toBe(false)
  })

  it('rejects zero amounts and missing expense categories', () => {
    expect(isTransactionInput({
      kind: 'expense', accountId: 'one', destinationAccountId: null, categoryId: null,
      amountCents: 0, date: '2026-08-27', notes: ''
    })).toBe(false)
  })

  it('rejects impossible calendar dates', () => {
    expect(isAccountInput({
      name: 'Cash', kind: 'cash', icon: 'Banknote', color: '#fff',
      openingBalanceCents: 0, openingDate: '2026-02-30'
    })).toBe(false)
  })
})

describe('balance calculation', () => {
  it('applies income, expenses, and both sides of transfers', () => {
    const transactions: MoneyTransaction[] = [
      { ...baseTransaction, id: 'income', kind: 'income', accountId: 'a', categoryId: 'income', destinationAccountId: null, amountCents: 5000 },
      { ...baseTransaction, id: 'expense', kind: 'expense', accountId: 'a', categoryId: 'food', destinationAccountId: null, amountCents: 1200 },
      { ...baseTransaction, id: 'out', kind: 'transfer', accountId: 'a', destinationAccountId: 'b', amountCents: 2000 },
      { ...baseTransaction, id: 'in', kind: 'transfer', accountId: 'b', destinationAccountId: 'a', amountCents: 300 }
    ]
    expect(calculateAccountBalance({ id: 'a', openingBalanceCents: 10000 }, transactions)).toBe(12100)
    expect(calculateAccountBalance({ id: 'b', openingBalanceCents: 0 }, transactions)).toBe(1700)
  })
})

describe('snapshot validation', () => {
  it('rejects a damaged cache', () => {
    expect(isMoneySnapshot({ accounts: [{}], categories: [], transactions: [], purchases: [], budgets: [], syncedAt: 'now' })).toBe(false)
  })

  it('accepts an empty D1 snapshot', () => {
    expect(isMoneySnapshot({ accounts: [], categories: [], transactions: [], purchases: [], budgets: [], syncedAt: '2026-08-27T00:00:00.000Z' })).toBe(true)
  })
})

describe('offline cache', () => {
  const cached = { accounts: [], categories: [], transactions: [], syncedAt: '2026-08-27T00:00:00.000Z' }

  it('upgrades a cache written before purchases and budgets existed', () => {
    expect(parseCachedSnapshot(JSON.stringify(cached))).toEqual({ ...cached, purchases: [], budgets: [] })
  })

  it('keeps the purchases a newer cache already has', () => {
    const purchase = {
      id: 'purchase', transactionId: 'transaction', merchant: 'Corner Market',
      purchaseDate: '2026-08-27', currency: 'USD', subtotalCents: 250, discountCents: 0,
      taxCents: 0, feesCents: 0, totalCents: 250,
      createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
      items: [{
        id: 'item', purchaseId: 'purchase', position: 0, name: 'Carrots', quantity: 1.25,
        unitPriceCents: 200, grossPriceCents: 250, discountCents: 0, lineTotalCents: 250
      }]
    }
    const snapshot = { ...cached, purchases: [purchase], budgets: [] }
    expect(parseCachedSnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it.each([null, '', 'not json', '{"accounts":[{}],"categories":[],"transactions":[],"purchases":[],"budgets":[],"syncedAt":"now"}'])(
    'returns null for %s', (raw) => {
      expect(parseCachedSnapshot(raw)).toBeNull()
    }
  )
})

const receipt = {
  merchant: 'Corner Market', purchaseDate: '2026-08-27', currency: 'USD',
  subtotalCents: 650, discountCents: 50, taxCents: 36, feesCents: 0, totalCents: 636,
  items: [
    { name: 'Carrots', quantity: 1.25, unitPriceCents: 200, grossPriceCents: 250, discountCents: 0, lineTotalCents: 250 },
    { name: 'Pepsi Cola', quantity: 2, unitPriceCents: 200, grossPriceCents: 400, discountCents: 50, lineTotalCents: 350 }
  ]
}

describe('receipt validation', () => {
  it('accepts weighted goods, repeated quantities, discounts, and missing unit prices', () => {
    expect(isReceiptDraft(receipt)).toBe(true)
    expect(isReceiptDraft({ ...receipt, items: [{ ...receipt.items[0], unitPriceCents: null }] })).toBe(true)
  })

  it('requires USD, a real date, items, and a positive total', () => {
    expect(isReceiptDraft({ ...receipt, currency: 'EUR' })).toBe(false)
    expect(isReceiptDraft({ ...receipt, purchaseDate: '2026-02-30' })).toBe(false)
    expect(isReceiptDraft({ ...receipt, items: [] })).toBe(false)
    expect(isReceiptDraft({ ...receipt, totalCents: 0 })).toBe(false)
  })

  it('requires an account and category before saving', () => {
    expect(isPurchaseInput({ ...receipt, accountId: 'checking', categoryId: 'groceries' })).toBe(true)
    expect(isPurchaseInput({ ...receipt, accountId: '', categoryId: 'groceries' })).toBe(false)
  })

  it('reports arithmetic differences without invalidating the draft', () => {
    const mismatched = { ...receipt, subtotalCents: 700 }
    expect(isReceiptDraft(mismatched)).toBe(true)
    expect(receiptReconciliationWarnings(mismatched)).toEqual([
      'Receipt totals do not add up',
      'Item prices do not match the subtotal'
    ])
  })
})

describe('purchase mutation batches', () => {
  const input = { ...receipt, accountId: 'checking', categoryId: 'groceries' }
  const ids = { purchaseId: 'purchase', transactionId: 'transaction', itemIds: ['item-1', 'item-2'] }

  it('creates the expense before the purchase and its items', () => {
    const statements = createPurchaseStatements(input, ids, 'now')
    expect(statements).toHaveLength(4)
    expect(statements[0].sql).toContain('INSERT INTO transactions')
    expect(statements[1].sql).toContain('INSERT INTO purchases')
    expect(statements.slice(2).every((item) => item.sql.includes('INSERT INTO receipt_items'))).toBe(true)
    expect(statements[1].params?.slice(0, 2)).toEqual(['purchase', 'transaction'])
  })

  it('updates the expense and purchase before replacing every item', () => {
    const statements = updatePurchaseStatements('purchase', 'transaction', input, ids.itemIds, 'now')
    expect(statements).toHaveLength(5)
    expect(statements.map((item) => item.sql.split(' ')[0])).toEqual(['UPDATE', 'UPDATE', 'DELETE', 'INSERT', 'INSERT'])
    expect(statements[0].params?.at(-1)).toBe('transaction')
  })

  it('deletes through the transaction so foreign keys remove the purchase and items', () => {
    expect(deletePurchaseStatements('transaction')).toEqual([
      { sql: 'DELETE FROM transactions WHERE id = ?', params: ['transaction'] }
    ])
    const schema = MONEY_SCHEMA_QUERIES.join('\n')
    expect(schema.match(/ON DELETE CASCADE/g)).toHaveLength(3)
  })
})

const groceries = {
  id: 'groceries', name: 'Groceries', kind: 'expense' as const, icon: 'ShoppingBasket',
  color: '#43a047', archivedAt: null, createdAt: 'now', updatedAt: 'now'
}
const rent = { ...groceries, id: 'rent', name: 'Rent', icon: 'Home' }
const salary = { ...groceries, id: 'salary', name: 'Salary', kind: 'income' as const }

function spend(id: string, amountCents: number, date: string, kind: 'expense' | 'income' = 'expense'): MoneyTransaction {
  return {
    ...baseTransaction, id, kind, accountId: 'checking', destinationAccountId: null,
    categoryId: kind === 'expense' ? id.split(':')[0] : 'salary', amountCents, date
  }
}

function snapshotWith(transactions: MoneyTransaction[], budgets: MoneySnapshot['budgets']): MoneySnapshot {
  return {
    accounts: [], categories: [groceries, rent, salary], transactions, purchases: [], budgets,
    syncedAt: '2026-08-27T00:00:00.000Z'
  }
}

const augustBudget = {
  id: 'budget', month: '2026-08', plannedIncomeCents: 500000, createdAt: 'now', updatedAt: 'now',
  allocations: [
    { id: 'a1', budgetId: 'budget', categoryId: 'groceries', amountCents: 100000 },
    { id: 'a2', budgetId: 'budget', categoryId: 'rent', amountCents: 200000 }
  ]
}

describe('budget input validation', () => {
  const input = { month: '2026-08', plannedIncomeCents: 500000, allocations: [{ categoryId: 'groceries', amountCents: 100000 }] }

  it('accepts a month with no allocations yet', () => {
    expect(isBudgetInput({ month: '2026-08', plannedIncomeCents: 0, allocations: [] })).toBe(true)
  })

  it.each([
    ['a malformed month', { ...input, month: '2026-8' }],
    ['month 13', { ...input, month: '2026-13' }],
    ['a negative income', { ...input, plannedIncomeCents: -1 }],
    ['a zero allocation', { ...input, allocations: [{ categoryId: 'groceries', amountCents: 0 }] }],
    ['a fractional allocation', { ...input, allocations: [{ categoryId: 'groceries', amountCents: 10.5 }] }],
    ['the same category twice', { ...input, allocations: [{ categoryId: 'groceries', amountCents: 1 }, { categoryId: 'groceries', amountCents: 2 }] }]
  ])('rejects %s', (_label, value) => {
    expect(isBudgetInput(value)).toBe(false)
  })
})

describe('budget summary', () => {
  it('reports spending against each allocation', () => {
    const summary = summarizeBudget(snapshotWith([
      spend('groceries:1', 25000, '2026-08-03'),
      spend('groceries:2', 60000, '2026-08-19'),
      spend('rent:1', 200000, '2026-08-01'),
      spend('income:1', 480000, '2026-08-01', 'income')
    ], [augustBudget]), '2026-08')
    expect(summary.plannedIncomeCents).toBe(500000)
    expect(summary.actualIncomeCents).toBe(480000)
    expect(summary.allocatedCents).toBe(300000)
    expect(summary.spentCents).toBe(285000)
    expect(summary.unallocatedCents).toBe(200000)
    expect(summary.overspent).toEqual([])
    expect(summary.categories.find((item) => item.categoryId === 'groceries')).toMatchObject({
      allocatedCents: 100000, spentCents: 85000, remainingCents: 15000, state: 'close'
    })
    expect(summary.categories.find((item) => item.categoryId === 'rent')?.state).toBe('close')
  })

  it('flags a category that runs past its allocation', () => {
    const summary = summarizeBudget(snapshotWith([spend('groceries:1', 105000, '2026-08-27')], [augustBudget]), '2026-08')
    expect(summary.categories.find((item) => item.categoryId === 'groceries')).toMatchObject({
      state: 'over', remainingCents: -5000
    })
    expect(summary.overspent.map((item) => item.categoryId)).toEqual(['groceries'])
  })

  it('ignores transfers and other months', () => {
    const summary = summarizeBudget(snapshotWith([
      spend('groceries:1', 40000, '2026-07-31'),
      spend('groceries:2', 10000, '2026-09-01'),
      { ...spend('groceries:3', 90000, '2026-08-10'), kind: 'transfer' as const, categoryId: null, destinationAccountId: 'savings' }
    ], [augustBudget]), '2026-08')
    expect(summary.spentCents).toBe(0)
  })

  it('counts spending in a category with no allocation as unplanned', () => {
    const summary = summarizeBudget(snapshotWith([spend('groceries:1', 7000, '2026-08-11')], [
      { ...augustBudget, allocations: [] }
    ]), '2026-08')
    expect(summary.unplannedSpentCents).toBe(7000)
    expect(summary.categories.find((item) => item.categoryId === 'groceries')?.state).toBe('unplanned')
    expect(summary.overspent).toEqual([])
  })

  it('works for a month with no budget at all', () => {
    const summary = summarizeBudget(snapshotWith([spend('groceries:1', 7000, '2026-08-11')], []), '2026-08')
    expect(summary).toMatchObject({ plannedIncomeCents: 0, allocatedCents: 0, spentCents: 7000 })
  })
})

describe('budget breaches', () => {
  const under = snapshotWith([spend('groceries:1', 90000, '2026-08-02')], [augustBudget])
  const over = snapshotWith([spend('groceries:1', 90000, '2026-08-02'), spend('groceries:2', 12340, '2026-08-27')], [augustBudget])

  it('reports only categories that just crossed the limit', () => {
    expect(budgetBreaches(under, over).map((item) => item.category.categoryId)).toEqual(['groceries'])
    expect(budgetBreaches(over, over)).toEqual([])
    expect(budgetBreaches(under, under)).toEqual([])
  })

  it('reports every overspent category when there is nothing to compare against', () => {
    expect(budgetBreaches(null, over)).toHaveLength(1)
  })

  it('names the category, the overage, and the month', () => {
    expect(budgetBreachMessage(budgetBreaches(under, over)[0]))
      .toBe('Groceries is $23.40 over its $1,000.00 budget for August 2026')
  })

  it('has a short form that fits a notification', () => {
    expect(budgetBreachMessage(budgetBreaches(under, over)[0], 'short')).toBe('Groceries is $23.40 over budget')
  })
})

describe('budget mutation batches', () => {
  const input = { month: '2026-08', plannedIncomeCents: 500000, allocations: [{ categoryId: 'groceries', amountCents: 100000 }] }

  it('upserts the month, then replaces its allocations', () => {
    const statements = saveBudgetStatements(input, { budgetId: 'budget', allocationIds: ['a1'] }, 'now')
    expect(statements).toHaveLength(3)
    expect(statements[0].sql).toContain('ON CONFLICT(month) DO UPDATE')
    expect(statements[1].sql).toContain('DELETE FROM budget_allocations')
    expect(statements[2].params).toEqual(['a1', '2026-08', 'groceries', 100000])
  })

  it('refuses a batch with missing allocation IDs', () => {
    expect(() => saveBudgetStatements(input, { budgetId: 'budget', allocationIds: [] }, 'now')).toThrow()
  })

  it('deletes a month through the budget row so allocations cascade', () => {
    expect(deleteBudgetStatements('2026-08')).toEqual([
      { sql: 'DELETE FROM budgets WHERE month = ?', params: ['2026-08'] }
    ])
  })
})
