import { describe, expect, it } from 'vitest'
import type { MoneyTransaction } from '@ego/core'
import { dueLabel, monthlyTotal, recurringCharges, upcomingCharges, type RecurringCharge } from '../src/recurring'

const TODAY = '2026-09-27'

let sequence = 0
function spend(date: string, amountCents: number, notes: string): MoneyTransaction {
  sequence += 1
  return {
    id: `t-${sequence}`, kind: 'expense', accountId: 'chase', destinationAccountId: null, categoryId: 'subscriptions',
    amountCents, date, notes, createdAt: `${date}T12:00:00.000Z`, updatedAt: `${date}T12:00:00.000Z`
  }
}

describe('recurring charges', () => {
  it('finds a steady monthly charge and predicts the same day next month', () => {
    const history = ['2026-06-04', '2026-07-06', '2026-08-04', '2026-09-04'].map((date) => spend(date, 2000, 'Anthropic'))
    expect(recurringCharges(history, TODAY)).toEqual([expect.objectContaining({
      title: 'Anthropic', amountCents: 2000, lastDate: '2026-09-04', nextDate: '2026-10-04', occurrences: 4
    })])
  })

  it('tracks two prices from one merchant as two bills', () => {
    const history = [
      ...['2026-07-01', '2026-08-01', '2026-09-01'].map((date) => spend(date, 600, 'DigitalOcean')),
      ...['2026-07-01', '2026-08-01', '2026-09-01'].map((date) => spend(date, 435, 'DigitalOcean'))
    ]
    expect(recurringCharges(history, TODAY).map((charge) => charge.amountCents).sort()).toEqual([435, 600])
  })

  it('accepts two charges a month apart only when they match to the cent', () => {
    expect(recurringCharges([spend('2026-08-06', 800, 'Wispr Flow'), spend('2026-09-08', 800, 'Wispr Flow')], TODAY)).toHaveLength(1)
    expect(recurringCharges([spend('2026-08-06', 1137, 'Panera'), spend('2026-09-08', 1210, 'Panera')], TODAY)).toHaveLength(0)
  })

  it('estimates uneven top-ups from their average gap', () => {
    const history = [spend('2026-07-20', 2000, 'OpenAI'), spend('2026-08-28', 2000, 'OpenAI'), spend('2026-09-14', 2000, 'OpenAI')]
    expect(recurringCharges(history, TODAY)[0]).toMatchObject({ title: 'OpenAI', nextDate: '2026-10-12', steady: false })
  })

  it('ignores places visited several times a month', () => {
    const history = ['2026-07-02', '2026-07-09', '2026-07-20', '2026-08-03', '2026-08-15', '2026-09-01', '2026-09-12']
      .map((date) => spend(date, 250, 'Florida Fresh'))
    expect(recurringCharges(history, TODAY)).toHaveLength(0)
  })

  it('drops a charge that stopped arriving', () => {
    const history = ['2026-04-10', '2026-05-10', '2026-06-10'].map((date) => spend(date, 999, 'Netflix'))
    expect(recurringCharges(history, TODAY)).toHaveLength(0)
  })

  it('lists what falls due soon, including one a few days late', () => {
    const charges = recurringCharges([
      ...['2026-07-01', '2026-08-01', '2026-09-01'].map((date) => spend(date, 600, 'DigitalOcean')),
      ...['2026-06-25', '2026-07-25', '2026-08-25'].map((date) => spend(date, 1500, 'Gym')),
      ...['2026-07-20', '2026-08-20', '2026-09-20'].map((date) => spend(date, 999, 'Music'))
    ], TODAY)
    expect(upcomingCharges(charges, TODAY, 7).map((charge) => charge.title)).toEqual(['Gym', 'DigitalOcean'])
    expect(monthlyTotal(charges)).toBe(600 + 1500 + 999)
  })
})

describe('due labels', () => {
  const charge = (nextDate: string, steady = true): RecurringCharge => ({
    key: 'k', title: 'Bill', categoryId: null, amountCents: 100, lastDate: '2026-09-01', nextDate, steady, occurrences: 3
  })
  const short = (iso: string): string => iso.slice(5)

  it('counts the days until a steady charge', () => {
    expect(dueLabel(charge('2026-09-27'), TODAY, short)).toBe('Due today')
    expect(dueLabel(charge('2026-09-28'), TODAY, short)).toBe('Tomorrow')
    expect(dueLabel(charge('2026-10-01'), TODAY, short)).toBe('In 4 days')
  })

  it('hedges an estimate and names a late charge', () => {
    expect(dueLabel(charge('2026-10-12', false), TODAY, short)).toBe('Around 10-12')
    expect(dueLabel(charge('2026-09-26'), TODAY, short)).toBe('Expected yesterday')
    expect(dueLabel(charge('2026-09-25'), TODAY, short)).toBe('Expected 2 days ago')
  })
})
