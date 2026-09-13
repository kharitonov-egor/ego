import { describe, expect, it } from 'vitest'
import type { MoneyTransaction } from '@ego/core'
import { transactionPage } from '../lib/transaction-page'

const rows = (count: number): MoneyTransaction[] => Array.from({ length: count }, (_, index) => ({
  id: String(index).padStart(4, '0'), kind: 'expense', accountId: 'account',
  destinationAccountId: null, categoryId: 'category', amountCents: 100,
  date: '2026-09-12', notes: '', createdAt: '2026-09-12T12:00:00Z', updatedAt: '2026-09-12T12:00:00Z'
}))

describe('transaction pages', () => {
  it('covers tied dates exactly once and leaves the snapshot intact', () => {
    const input = rows(121)
    const original = [...input]
    const pages = [0, 1, 2].map((page) => transactionPage(input, page))
    expect(pages.map((page) => page.items.length)).toEqual([50, 50, 21])
    expect(new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size).toBe(121)
    expect(pages[0].items[0].id).toBe('0120')
    expect(input).toEqual(original)
  })
  it('clamps a page after deletion or filtering shrinks the result', () => {
    expect(transactionPage(rows(51), 2).page).toBe(1)
    expect(transactionPage(rows(50), 1).page).toBe(0)
    expect(transactionPage([], 3)).toMatchObject({ items: [], page: 0, pageCount: 0, start: 0, end: 0 })
  })
  it('orders by date before creation time and id', () => {
    const input = rows(3)
    input[0].date = '2026-09-13'
    input[1].createdAt = '2026-09-12T13:00:00Z'
    expect(transactionPage(input, 0).items.map((item) => item.id)).toEqual(['0000', '0001', '0002'])
  })
})
