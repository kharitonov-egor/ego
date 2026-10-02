import { describe, expect, it } from 'vitest'
import { transactionDetail, transactionTitle, type TitleSource } from '../src/transaction-title'

const row = (overrides: Partial<TitleSource> = {}): TitleSource => ({
  kind: 'expense',
  notes: '',
  merchant: null,
  categoryName: 'Groceries',
  accountName: 'Chase',
  destinationAccountName: null,
  ...overrides
})

describe('transaction titles', () => {
  it('uses the note, and moves the category into the detail line', () => {
    expect(transactionTitle(row({ notes: 'Publix' }))).toBe('Publix')
    expect(transactionDetail(row({ notes: 'Publix' }))).toBe('Groceries · Chase')
  })

  it('takes only the first line of a longer note', () => {
    expect(transactionTitle(row({ notes: '  Publix\nmilk, eggs, bread ' }))).toBe('Publix')
  })

  it('prefers a receipt merchant over the note', () => {
    expect(transactionTitle(row({ merchant: 'Trader Joe\'s', notes: 'weekly shop' }))).toBe('Trader Joe\'s')
  })

  it('falls back to the category without repeating it', () => {
    expect(transactionTitle(row())).toBe('Groceries')
    expect(transactionDetail(row())).toBe('Chase')
    expect(transactionTitle(row({ categoryName: null }))).toBe('Archived category')
  })

  it('names a transfer by its note or its destination', () => {
    const transfer = row({ kind: 'transfer', categoryName: null, destinationAccountName: 'Savings' })
    expect(transactionTitle(transfer)).toBe('Savings')
    expect(transactionTitle({ ...transfer, notes: 'Rainy day fund' })).toBe('Rainy day fund')
    expect(transactionDetail(transfer)).toBe('Chase')
  })
})
