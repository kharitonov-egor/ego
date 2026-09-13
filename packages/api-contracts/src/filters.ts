import { isDateString, type TransactionKind } from '@ego/core'
import { invalid, type ApiResult } from './errors'

const TRANSACTION_KINDS: TransactionKind[] = ['income', 'expense', 'transfer']
const MAX_SEARCH_LENGTH = 100
const MAX_ID_FILTERS = 50

export interface TransactionFilters {
  from: string | null
  to: string | null
  accountIds: string[]
  categoryIds: string[]
  kinds: TransactionKind[]
  search: string
}

export const NO_TRANSACTION_FILTERS: TransactionFilters = {
  from: null, to: null, accountIds: [], categoryIds: [], kinds: [], search: ''
}

export function normalizeTransactionFilters(filters: TransactionFilters): TransactionFilters {
  const unique = (values: string[]): string[] =>
    [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort()
  return {
    from: filters.from,
    to: filters.to,
    accountIds: unique(filters.accountIds),
    categoryIds: unique(filters.categoryIds),
    kinds: TRANSACTION_KINDS.filter((kind) => filters.kinds.includes(kind)),
    search: filters.search.trim()
  }
}

function fnv1a(value: string, seed: number): number {
  let result = seed
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193) >>> 0
  }
  return result >>> 0
}

/**
 * Binds a cursor to the filters that produced it. A cursor from a different query
 * must not silently continue a new one.
 */
export function transactionQueryIdentity(filters: TransactionFilters): string {
  const canonical = JSON.stringify(normalizeTransactionFilters(filters))
  return `${fnv1a(canonical, 0x811c9dc5).toString(36)}.${fnv1a(canonical, 0x9dc5811c).toString(36)}`
}

function idList(raw: string | null, label: string): ApiResult<string[]> {
  if (!raw) return { ok: true, data: [] }
  const values = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0)
  if (values.length > MAX_ID_FILTERS) return invalid(`Too many ${label} filters`)
  if (values.some((value) => value.length > 64)) return invalid(`A ${label} filter is not a valid ID`)
  return { ok: true, data: values }
}

function optionalDate(raw: string | null, label: string): ApiResult<string | null> {
  if (!raw) return { ok: true, data: null }
  if (!isDateString(raw)) return invalid(`${label} must be a YYYY-MM-DD date`)
  return { ok: true, data: raw }
}

export function parseTransactionFilters(params: URLSearchParams): ApiResult<TransactionFilters> {
  const from = optionalDate(params.get('from'), 'from')
  if (!from.ok) return from
  const to = optionalDate(params.get('to'), 'to')
  if (!to.ok) return to
  if (from.data && to.data && from.data > to.data) return invalid('from must not be after to')
  const accountIds = idList(params.get('accounts'), 'account')
  if (!accountIds.ok) return accountIds
  const categoryIds = idList(params.get('categories'), 'category')
  if (!categoryIds.ok) return categoryIds
  const rawKinds = (params.get('kinds') ?? '').split(',').map((value) => value.trim()).filter((value) => value.length > 0)
  if (rawKinds.some((kind) => !TRANSACTION_KINDS.includes(kind as TransactionKind))) {
    return invalid('kinds accepts income, expense, and transfer')
  }
  const search = params.get('search') ?? ''
  if (search.length > MAX_SEARCH_LENGTH) return invalid('Search is too long')
  return {
    ok: true,
    data: normalizeTransactionFilters({
      from: from.data,
      to: to.data,
      accountIds: accountIds.data,
      categoryIds: categoryIds.data,
      kinds: rawKinds as TransactionKind[],
      search
    })
  }
}

/** The ESCAPE character every LIKE predicate built from these filters must declare. */
export const LIKE_ESCAPE = '\\'

/** Percent and underscore are literal characters in transaction search. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export function searchPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`
}
