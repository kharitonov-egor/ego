import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { DateRange, MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { formatIso, isoFromParts, isoToday } from './dates'

export const PERIOD_PRESETS: PeriodPreset[] = ['today', 'week', 'month', 'year', 'all', 'custom']

export function rangeForPeriod(period: PeriodPreset, custom: DateRange): DateRange {
  if (period === 'all') return { from: null, to: null }
  if (period === 'custom') return custom
  const today = isoToday()
  if (period === 'today') return { from: today, to: today }
  const now = new Date(`${today}T00:00:00`)
  const from = new Date(now)
  if (period === 'week') from.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  if (period === 'month') from.setDate(1)
  if (period === 'year') from.setMonth(0, 1)
  return { from: isoFromParts(from.getFullYear(), from.getMonth(), from.getDate()), to: today }
}

export function periodLabel(period: PeriodPreset, custom: DateRange): string {
  if (period === 'all') return 'All time'
  if (period === 'today') return 'Today'
  if (period !== 'custom') return `This ${period}`
  if (custom.from && custom.to) return `${formatIso(custom.from)} - ${formatIso(custom.to)}`
  if (custom.from) return `From ${formatIso(custom.from)}`
  if (custom.to) return `Until ${formatIso(custom.to)}`
  return 'Custom'
}

interface PeriodContextValue {
  period: PeriodPreset
  custom: DateRange
  range: DateRange
  label: string
  setPeriod: (value: PeriodPreset) => void
  setCustom: (value: DateRange) => void
}

const PeriodContext = createContext<PeriodContextValue | null>(null)

export function PeriodProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [custom, setCustomRange] = useState<DateRange>({ from: null, to: null })
  const setCustom = useCallback((value: DateRange): void => {
    setCustomRange(value)
    setPeriod('custom')
  }, [])
  const value = useMemo<PeriodContextValue>(() => ({
    period,
    custom,
    range: rangeForPeriod(period, custom),
    label: periodLabel(period, custom),
    setPeriod,
    setCustom
  }), [custom, period, setCustom])
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>
}

export function usePeriod(): PeriodContextValue {
  const context = useContext(PeriodContext)
  if (!context) throw new Error('usePeriod must be used inside PeriodProvider')
  return context
}

export function transactionsInRange(snapshot: MoneySnapshot, range: DateRange): MoneyTransaction[] {
  if (!range.from && !range.to) return snapshot.transactions
  return snapshot.transactions.filter((item) =>
    (!range.from || item.date >= range.from) && (!range.to || item.date <= range.to))
}
