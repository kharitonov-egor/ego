import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { DateRange, MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { isoToday } from '@ego/local/dates'
import {
  canStepForward, isCurrentPeriod, isStepped, parseSavedPeriod, periodTitle, rangeForPeriod, relativePeriodName,
  stepAnchor, type SavedPeriod, type SteppedPeriod
} from '@ego/local/periods'
import { SecureStore } from './preferences'

export { PERIOD_PRESETS, rangeForPeriod } from '@ego/local/periods'

export function periodLabel(period: PeriodPreset, custom: DateRange, anchor: string = isoToday()): string {
  return periodTitle(period, anchor, custom)
}

interface PeriodContextValue {
  period: PeriodPreset
  custom: DateRange
  /** Any day inside the chosen day, week, month, or year. */
  anchor: string
  range: DateRange
  label: string
  /** "This month", "Last week", or null further back. */
  relative: string | null
  current: boolean
  canGoBack: boolean
  canGoForward: boolean
  setPeriod: (value: PeriodPreset) => void
  setCustom: (value: DateRange) => void
  step: (delta: -1 | 1) => void
  showPeriod: (period: SteppedPeriod, anchor: string) => void
  jumpToToday: () => void
}

const PeriodContext = createContext<PeriodContextValue | null>(null)

const PERIOD_KEY = 'ego.period'

export function PeriodProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [period, setPeriodState] = useState<PeriodPreset>('month')
  const [custom, setCustomRange] = useState<DateRange>({ from: null, to: null })
  const [anchor, setAnchor] = useState(isoToday)
  const [restored, setRestored] = useState(false)

  /** The kind of period comes back on the next launch. The anchor does not: Week opens on this week. */
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(PERIOD_KEY)
      .then((raw) => {
        const saved = parseSavedPeriod(raw)
        if (!active || !saved) return
        setPeriodState(saved.period)
        setCustomRange(saved.custom)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setRestored(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!restored) return
    const saved: SavedPeriod = { period, custom }
    void SecureStore.setItemAsync(PERIOD_KEY, JSON.stringify(saved)).catch(() => undefined)
  }, [custom, period, restored])
  const setPeriod = useCallback((value: PeriodPreset): void => setPeriodState(value), [])
  const setCustom = useCallback((value: DateRange): void => {
    setCustomRange(value)
    setPeriodState('custom')
  }, [])
  const step = useCallback((delta: -1 | 1): void => {
    if (isStepped(period)) setAnchor((current) => stepAnchor(period, current, delta))
  }, [period])
  const showPeriod = useCallback((next: SteppedPeriod, day: string): void => {
    setPeriodState(next)
    setAnchor(day)
  }, [])
  const jumpToToday = useCallback((): void => setAnchor(isoToday()), [])
  const seenToday = useRef(isoToday())
  /** Ego stays open in the tray for days, so coming back after midnight moves "this week" along with the clock. */
  useEffect(() => {
    const onReturn = (): void => {
      const today = isoToday()
      if (document.visibilityState !== 'visible' || today === seenToday.current) return
      const before = seenToday.current
      seenToday.current = today
      setAnchor((current) => isStepped(period) && isCurrentPeriod(period, current, before) ? today : current)
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [period])
  const value = useMemo<PeriodContextValue>(() => {
    const today = isoToday()
    const stepped = isStepped(period)
    return {
      period,
      custom,
      anchor,
      range: rangeForPeriod(period, custom, anchor),
      label: periodTitle(period, anchor, custom),
      relative: stepped ? relativePeriodName(period, anchor, today) : null,
      current: stepped ? isCurrentPeriod(period, anchor, today) : true,
      canGoBack: stepped,
      canGoForward: stepped && canStepForward(period, anchor, today),
      setPeriod,
      setCustom,
      step,
      showPeriod,
      jumpToToday
    }
  }, [anchor, custom, jumpToToday, period, setCustom, setPeriod, showPeriod, step])
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
