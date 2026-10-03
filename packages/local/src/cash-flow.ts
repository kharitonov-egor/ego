import type { MoneySnapshot, MoneyTransaction } from '@ego/core'
import { bucketKey, daysBetween, type BucketSize, type ChartBucket, type Span } from './periods'

export interface Flow {
  incomeCents: number
  expenseCents: number
}

export function flowOf(transactions: readonly MoneyTransaction[], span?: Span): Flow {
  let incomeCents = 0
  let expenseCents = 0
  for (const item of transactions) {
    if (span && (item.date < span.from || item.date > span.to)) continue
    if (item.kind === 'income') incomeCents += item.amountCents
    else if (item.kind === 'expense') expenseCents += item.amountCents
  }
  return { incomeCents, expenseCents }
}

export function bucketFlows(transactions: readonly MoneyTransaction[], buckets: readonly ChartBucket[], size: BucketSize): Flow[] {
  const flows = buckets.map((): Flow => ({ incomeCents: 0, expenseCents: 0 }))
  const index = new Map(buckets.map((bucket, position) => [bucket.key, position]))
  for (const item of transactions) {
    if (item.kind === 'transfer') continue
    const position = index.get(bucketKey(size, item.date))
    if (position === undefined) continue
    if (item.kind === 'income') flows[position].incomeCents += item.amountCents
    else flows[position].expenseCents += item.amountCents
  }
  return flows
}

/**
 * The combined balance of the open accounts at the end of a day. Stored balances already count
 * every transaction, so this walks back through the ones dated after that day.
 */
export function balanceAt(snapshot: MoneySnapshot, day: string): number {
  const open = new Set(snapshot.accounts.filter((account) => !account.archivedAt).map((account) => account.id))
  let total = snapshot.accounts.reduce((sum, account) => open.has(account.id) ? sum + account.balanceCents : sum, 0)
  for (const item of snapshot.transactions) {
    if (item.date <= day) continue
    if (open.has(item.accountId)) total += item.kind === 'income' ? -item.amountCents : item.amountCents
    if (item.kind === 'transfer' && item.destinationAccountId && open.has(item.destinationAccountId)) total -= item.amountCents
  }
  return total
}

export interface Average {
  label: string
  cents: number
}

const DAYS_PER_MONTH = 30.44

/** Only units shorter than the period itself, so a single week never claims a monthly figure. */
export function averagesFor(expenseCents: number, days: number): Average[] {
  const perDay = expenseCents / Math.max(1, days)
  const averages: Average[] = [{ label: 'Per day', cents: perDay }]
  if (days >= 14) averages.push({ label: 'Per week', cents: perDay * 7 })
  if (days >= 60) averages.push({ label: 'Per month', cents: perDay * DAYS_PER_MONTH })
  return averages
}

/** Days of the span that have happened, counting today. */
export function elapsedDays(span: Span, today: string): number {
  if (today < span.from) return 0
  return daysBetween(span.from, today < span.to ? today : span.to) + 1
}

/** A straight-line estimate of where spending ends if the current pace holds. */
export function projectedSpend(expenseCents: number, span: Span, today: string): number | null {
  const elapsed = elapsedDays(span, today)
  const total = daysBetween(span.from, span.to) + 1
  if (elapsed < 3 || elapsed >= total) return null
  return Math.round(expenseCents / elapsed * total)
}

/**
 * Shades for a calendar: 0 for a day with no spending, then 1 to 4 by rank among the days that had
 * some, so one large rent payment does not wash every other day out to the palest shade.
 */
export function heatLevels(values: readonly number[]): number[] {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b)
  return values.map((value) => {
    if (value <= 0) return 0
    const below = sorted.findIndex((other) => other >= value)
    return Math.min(4, 1 + Math.floor(below / sorted.length * 4))
  })
}
