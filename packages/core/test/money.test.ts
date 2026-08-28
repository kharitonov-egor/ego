import { describe, expect, it } from 'vitest'
import {
  calculateAccountBalance,
  isAccountInput,
  isCategoryInput,
  isMoneySnapshot,
  isTransactionInput,
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
    expect(isMoneySnapshot({ accounts: [{}], categories: [], transactions: [], syncedAt: 'now' })).toBe(false)
  })

  it('accepts an empty D1 snapshot', () => {
    expect(isMoneySnapshot({ accounts: [], categories: [], transactions: [], syncedAt: '2026-08-27T00:00:00.000Z' })).toBe(true)
  })
})
