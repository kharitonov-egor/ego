import { NO_TRANSACTION_FILTERS, type TransactionFilters } from '@ego/api-contracts'
import type { DateRange, TransactionKind } from '@ego/core'

/**
 * The filters that belong to Activity alone. The period is shared with Home and Categories
 * through the period context, so switching to Week on one tab switches all three.
 */
export interface ActivityView {
  accountIds: string[]
  categoryIds: string[]
  kinds: TransactionKind[]
  search: string
}

export const DEFAULT_ACTIVITY_VIEW: ActivityView = {
  accountIds: [],
  categoryIds: [],
  kinds: [],
  search: ''
}

export function activityFilters(view: ActivityView, range: DateRange): TransactionFilters {
  return {
    ...NO_TRANSACTION_FILTERS,
    from: range.from,
    to: range.to,
    accountIds: view.accountIds,
    categoryIds: view.categoryIds,
    kinds: view.kinds,
    search: view.search.trim()
  }
}

/** Changes the list identity, so the loaded pages and any selection have to start again. */
export function viewIdentity(view: ActivityView, range: DateRange): string {
  return [
    range.from ?? '', range.to ?? '', view.search.trim(),
    [...view.accountIds].sort().join('+'),
    [...view.categoryIds].sort().join('+'),
    [...view.kinds].sort().join('+')
  ].join('|')
}

export function hasFilters(view: ActivityView): boolean {
  return view.accountIds.length > 0 || view.categoryIds.length > 0 || view.kinds.length > 0
}

export function filterCount(view: ActivityView): number {
  return view.accountIds.length + view.categoryIds.length + view.kinds.length
}

export function toggleIn<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export interface ActivityChip {
  id: string
  label: string
  next: ActivityView
}

export interface ChipLabels {
  account: (id: string) => string
  category: (id: string) => string
}

/** Active filters appear above the list and each one can be removed on its own. */
export function activityChips(view: ActivityView, labels: ChipLabels): ActivityChip[] {
  return [
    ...view.kinds.map((kind) => ({
      id: `kind:${kind}`,
      label: kind === 'transfer' ? 'Transfers' : kind === 'income' ? 'Income' : 'Expenses',
      next: { ...view, kinds: view.kinds.filter((item) => item !== kind) }
    })),
    ...view.accountIds.map((accountId) => ({
      id: `account:${accountId}`,
      label: labels.account(accountId),
      next: { ...view, accountIds: view.accountIds.filter((item) => item !== accountId) }
    })),
    ...view.categoryIds.map((categoryId) => ({
      id: `category:${categoryId}`,
      label: labels.category(categoryId),
      next: { ...view, categoryIds: view.categoryIds.filter((item) => item !== categoryId) }
    }))
  ]
}

export function clearFilters(view: ActivityView): ActivityView {
  return { ...view, accountIds: [], categoryIds: [], kinds: [] }
}

interface StoredPreferences {
  accountIds: string[]
  categoryIds: string[]
  kinds: TransactionKind[]
}

const KINDS: TransactionKind[] = ['income', 'expense', 'transfer']

/** Filter choices are worth remembering. The search text is not, on a private ledger. */
export function storedPreferences(view: ActivityView): string {
  const stored: StoredPreferences = {
    accountIds: view.accountIds,
    categoryIds: view.categoryIds,
    kinds: view.kinds
  }
  return JSON.stringify(stored)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Older installs stored a period here too. It is ignored now that the period is shared. */
export function parsePreferences(raw: string | null): ActivityView {
  if (!raw) return DEFAULT_ACTIVITY_VIEW
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_ACTIVITY_VIEW
  }
  if (!isRecord(parsed)) return DEFAULT_ACTIVITY_VIEW
  return {
    accountIds: stringList(parsed.accountIds),
    categoryIds: stringList(parsed.categoryIds),
    kinds: KINDS.filter((kind) => stringList(parsed.kinds).includes(kind)),
    search: ''
  }
}
