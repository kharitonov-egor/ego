import { describe, expect, it } from 'vitest'
import type { MoneySnapshot, MoneyTransaction } from '@ego/core'
import { averagesFor, balanceAt, bucketFlows, elapsedDays, flowOf, projectedSpend } from '../lib/cash-flow'
import { chartBuckets, periodSpan } from '../lib/periods'

function transaction(overrides: Partial<MoneyTransaction>): MoneyTransaction {
  return {
    id: overrides.id ?? `t-${Math.random()}`,
    kind: 'expense',
    accountId: 'checking',
    destinationAccountId: null,
    categoryId: 'food',
    amountCents: 1000,
    date: '2026-09-14',
    notes: '',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    ...overrides
  }
}

const transactions = [
  transaction({ kind: 'income', amountCents: 300000, date: '2026-09-01', categoryId: 'salary' }),
  transaction({ amountCents: 2500, date: '2026-09-14' }),
  transaction({ amountCents: 1500, date: '2026-09-14' }),
  transaction({ kind: 'transfer', amountCents: 50000, date: '2026-09-15', destinationAccountId: 'savings', categoryId: null }),
  transaction({ amountCents: 4000, date: '2026-10-02' })
]

describe('cash flow', () => {
  it('totals income and spending and ignores transfers', () => {
    expect(flowOf(transactions)).toEqual({ incomeCents: 300000, expenseCents: 8000 })
    expect(flowOf(transactions, periodSpan('month', '2026-09-10'))).toEqual({ incomeCents: 300000, expenseCents: 4000 })
  })

  it('sums each day into its bar', () => {
    const buckets = chartBuckets(periodSpan('month', '2026-09-10'))
    const flows = bucketFlows(transactions, buckets, 'day')
    expect(flows[0]).toEqual({ incomeCents: 300000, expenseCents: 0 })
    expect(flows[13]).toEqual({ incomeCents: 0, expenseCents: 4000 })
    expect(flows.reduce((sum, flow) => sum + flow.expenseCents, 0)).toBe(4000)
  })

  it('sums months for a year', () => {
    const buckets = chartBuckets(periodSpan('year', '2026-09-10'))
    const flows = bucketFlows(transactions, buckets, 'month')
    expect(flows[8]).toEqual({ incomeCents: 300000, expenseCents: 4000 })
    expect(flows[9]).toEqual({ incomeCents: 0, expenseCents: 4000 })
  })
})

describe('balance on a past day', () => {
  const snapshot: MoneySnapshot = {
    accounts: [
      { id: 'checking', name: 'Checking', kind: 'checking', icon: 'Landmark', color: '#fff', openingBalanceCents: 0, openingDate: '2026-01-01', balanceCents: 242000, archivedAt: null, createdAt: '', updatedAt: '' },
      { id: 'savings', name: 'Savings', kind: 'savings', icon: 'PiggyBank', color: '#fff', openingBalanceCents: 0, openingDate: '2026-01-01', balanceCents: 50000, archivedAt: null, createdAt: '', updatedAt: '' }
    ],
    categories: [],
    transactions: [...transactions].reverse(),
    purchases: [],
    budgets: [],
    syncedAt: ''
  }

  it('walks back through later transactions', () => {
    expect(balanceAt(snapshot, '2026-12-31')).toBe(292000)
    expect(balanceAt(snapshot, '2026-09-30')).toBe(296000)
    expect(balanceAt(snapshot, '2026-09-14')).toBe(296000)
    expect(balanceAt(snapshot, '2026-09-13')).toBe(300000)
    expect(balanceAt(snapshot, '2026-08-31')).toBe(0)
  })
})

describe('averages', () => {
  it('offers only units shorter than the period', () => {
    expect(averagesFor(7000, 7).map((item) => item.label)).toEqual(['Per day'])
    expect(averagesFor(30000, 30).map((item) => item.label)).toEqual(['Per day', 'Per week'])
    expect(averagesFor(365000, 365).map((item) => item.label)).toEqual(['Per day', 'Per week', 'Per month'])
    expect(averagesFor(30000, 30)[0].cents).toBe(1000)
  })

  it('counts elapsed days and projects the rest of a running period', () => {
    const month = periodSpan('month', '2026-09-10')
    expect(elapsedDays(month, '2026-09-10')).toBe(10)
    expect(elapsedDays(month, '2026-10-02')).toBe(30)
    expect(projectedSpend(10000, month, '2026-09-10')).toBe(30000)
    expect(projectedSpend(10000, month, '2026-09-02')).toBeNull()
    expect(projectedSpend(10000, month, '2026-10-02')).toBeNull()
  })
})
