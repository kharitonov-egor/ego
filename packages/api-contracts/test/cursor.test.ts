import { describe, expect, it } from 'vitest'
import {
  NO_TRANSACTION_FILTERS, decodeCursor, encodeCursor, escapeLikePattern, parseTransactionFilters,
  transactionQueryIdentity, type TransactionFilters
} from '../src'

const cursor = { date: '2026-09-12', createdAt: '2026-09-12T10:00:00.000Z', id: 'tx-1' }
const filters = (overrides: Partial<TransactionFilters> = {}): TransactionFilters =>
  ({ ...NO_TRANSACTION_FILTERS, ...overrides })

describe('feed cursors', () => {
  it('round trips the tuple of the preceding row', () => {
    const decoded = decodeCursor(encodeCursor(cursor, filters()), filters())
    expect(decoded).toEqual({ ok: true, data: cursor })
  })

  it('refuses a cursor from a different query', () => {
    const encoded = encodeCursor(cursor, filters({ search: 'coffee' }))
    const decoded = decodeCursor(encoded, filters({ search: 'groceries' }))
    expect(decoded.ok).toBe(false)
  })

  it('accepts filters that differ only in order or spacing', () => {
    const left = filters({ accountIds: ['b', 'a'], kinds: ['expense', 'income'], search: ' milk ' })
    const right = filters({ accountIds: ['a', 'b'], kinds: ['income', 'expense'], search: 'milk' })
    expect(transactionQueryIdentity(left)).toBe(transactionQueryIdentity(right))
    expect(decodeCursor(encodeCursor(cursor, left), right).ok).toBe(true)
  })

  it('rejects malformed cursors instead of paging from the start', () => {
    expect(decodeCursor('not-a-cursor', filters()).ok).toBe(false)
    expect(decodeCursor('', filters()).ok).toBe(false)
    expect(decodeCursor(encodeCursor({ ...cursor, date: '2026-13-45' }, filters()), filters()).ok).toBe(false)
  })

  it('survives non-ascii identifiers', () => {
    const wide = { ...cursor, id: 'tx-каф-☕' }
    expect(decodeCursor(encodeCursor(wide, filters()), filters())).toEqual({ ok: true, data: wide })
  })
})

describe('transaction filters', () => {
  it('parses a query string and normalizes it', () => {
    const parsed = parseTransactionFilters(new URLSearchParams(
      'from=2026-09-01&to=2026-09-30&accounts=b,a,a&kinds=transfer,income&search=%20cafe%20'))
    expect(parsed).toEqual({
      ok: true,
      data: { from: '2026-09-01', to: '2026-09-30', accountIds: ['a', 'b'], categoryIds: [], kinds: ['income', 'transfer'], search: 'cafe' }
    })
  })

  it('rejects an inverted range, an unknown kind, and a bad date', () => {
    expect(parseTransactionFilters(new URLSearchParams('from=2026-09-30&to=2026-09-01')).ok).toBe(false)
    expect(parseTransactionFilters(new URLSearchParams('kinds=refund')).ok).toBe(false)
    expect(parseTransactionFilters(new URLSearchParams('from=2026-02-30')).ok).toBe(false)
  })

  it('treats percent and underscore as literal search characters', () => {
    const backslash = String.fromCharCode(92)
    expect(escapeLikePattern(`50%_off${backslash}`)).toBe(`50${backslash}%${backslash}_off${backslash}${backslash}`)
  })
})
