import type { MoneyTransaction } from '@ego/core'
import { addMonths, daysBetween } from './periods'
import { shiftIso } from './dates'
import { noteTitle } from './transaction-title'

export interface RecurringCharge {
  key: string
  title: string
  categoryId: string | null
  amountCents: number
  lastDate: string
  nextDate: string
  /** False when the charges arrive unevenly and the next date is an estimate. */
  steady: boolean
  occurrences: number
}

const AMOUNT_TOLERANCE = 0.25
const MIN_GAP_DAYS = 20
const MAX_GAP_DAYS = 45
/** Identical amounts may come closer together, like credit top-ups, as long as they average a month. */
const EXACT_MIN_GAP_DAYS = 10
/** A charge this many days past its expected date has probably been cancelled. */
const LAPSED_AFTER_DAYS = 10

function similar(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE * Math.max(a, b)
}

function clusters(items: readonly MoneyTransaction[]): MoneyTransaction[][] {
  const groups: MoneyTransaction[][] = []
  for (const item of items) {
    const group = groups.find((candidate) => similar(candidate[candidate.length - 1].amountCents, item.amountCents))
    if (group) group.push(item)
    else groups.push([item])
  }
  return groups
}

/** The newest stretch of charges that arrive about a month apart, oldest first. */
function monthlyRun(sorted: readonly MoneyTransaction[]): MoneyTransaction[] {
  const last = sorted[sorted.length - 1]
  const run = [last]
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const item = sorted[index]
    const gap = daysBetween(item.date, run[0].date)
    const shortest = item.amountCents === last.amountCents ? EXACT_MIN_GAP_DAYS : MIN_GAP_DAYS
    if (gap < shortest || gap > MAX_GAP_DAYS) break
    run.unshift(item)
  }
  return run
}

/** A steady monthly charge lands on the same day next month; an uneven one, after its average gap. */
function nextChargeDate(run: readonly MoneyTransaction[]): { date: string; steady: boolean } | null {
  const last = run[run.length - 1]
  const average = daysBetween(run[0].date, last.date) / (run.length - 1)
  if (average < MIN_GAP_DAYS || average > MAX_GAP_DAYS) return null
  const steady = run.every((item, index) => index === 0 || daysBetween(run[index - 1].date, item.date) >= MIN_GAP_DAYS)
  return { date: steady ? addMonths(last.date, 1) : shiftIso(last.date, Math.round(average)), steady }
}

/**
 * Charges that repeat about once a month, found from the note that names the merchant. Three in a
 * row count; two count only when the amount matches to the cent, because a coffee shop visited
 * twice a month apart rarely costs exactly the same.
 */
export function recurringCharges(transactions: readonly MoneyTransaction[], today: string): RecurringCharge[] {
  const byMerchant = new Map<string, MoneyTransaction[]>()
  for (const item of transactions) {
    if (item.kind !== 'expense') continue
    const title = noteTitle(item.notes)
    if (!title) continue
    const key = title.toLowerCase()
    const list = byMerchant.get(key)
    if (list) list.push(item)
    else byMerchant.set(key, [item])
  }

  const charges: RecurringCharge[] = []
  for (const [key, items] of byMerchant) {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    clusters(sorted).forEach((group, index) => {
      if (group.length < 2) return
      const run = monthlyRun(group)
      const last = run[run.length - 1]
      const exact = run.every((item) => item.amountCents === last.amountCents)
      if (run.length < 3 && !(run.length === 2 && exact)) return
      const next = nextChargeDate(run)
      if (!next || daysBetween(next.date, today) > LAPSED_AFTER_DAYS) return
      charges.push({
        key: `${key}#${index}`,
        title: noteTitle(last.notes),
        categoryId: last.categoryId,
        amountCents: last.amountCents,
        lastDate: last.date,
        nextDate: next.date,
        steady: next.steady,
        occurrences: run.length
      })
    })
  }
  return charges.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.title.localeCompare(b.title))
}

/** Charges expected from a few days ago, in case one is late, through the given number of days ahead. */
export function upcomingCharges(charges: readonly RecurringCharge[], today: string, days: number): RecurringCharge[] {
  const from = shiftIso(today, -3)
  const to = shiftIso(today, days)
  return charges.filter((charge) => charge.nextDate >= from && charge.nextDate <= to)
}

export function monthlyTotal(charges: readonly RecurringCharge[]): number {
  return charges.reduce((sum, charge) => sum + charge.amountCents, 0)
}

/** "Due today", "Tomorrow", "In 4 days", "Around Oct 12" for an estimate, or how late it is. */
export function dueLabel(charge: RecurringCharge, today: string, shortDate: (iso: string) => string): string {
  const days = daysBetween(today, charge.nextDate)
  if (days < 0) return days === -1 ? 'Expected yesterday' : `Expected ${-days} days ago`
  if (!charge.steady) return `Around ${shortDate(charge.nextDate)}`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}
