import type { MoneyTransaction } from '@ego/core'

export const TRANSACTION_PAGE_SIZE = 50

/** Page a complete snapshot without changing the history used for balances. */
export function transactionPage(transactions: MoneyTransaction[], requestedPage: number) {
  const sorted = [...transactions].sort((a, b) =>
    b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const pageCount = Math.ceil(sorted.length / TRANSACTION_PAGE_SIZE)
  const page = Math.max(0, Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0, pageCount - 1))
  const start = page * TRANSACTION_PAGE_SIZE
  const end = Math.min(start + TRANSACTION_PAGE_SIZE, sorted.length)
  return { items: sorted.slice(start, end), page, pageCount, start, end }
}
