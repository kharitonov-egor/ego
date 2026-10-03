import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { isoFromParts, isoToday } from '@ego/local/dates'
import { hasTransactionOnDate } from '@ego/local/repositories/transactions'
import { DEFAULT_REMINDER, parseReminder, type ReminderPreference } from '@ego/local/reminders'
import { useLedger } from './ledger'
import { SecureStore } from './preferences'
import { isDue, nextReminder, waitFor } from './reminder-schedule'

const STORE_KEY = 'ego.reminder'

interface ReminderContextValue {
  preference: ReminderPreference
  setEnabled: (enabled: boolean) => void
  setHour: (hour: number) => void
}

const ReminderContext = createContext<ReminderContextValue | null>(null)

/**
 * The phone hands its evenings to the system scheduler. Here the window lives on in the tray, so a
 * timer waits for the chosen hour and asks the main process for a Windows notification.
 */
export function ReminderProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const [preference, setPreference] = useState<ReminderPreference>(DEFAULT_REMINDER)
  const [restored, setRestored] = useState(false)
  const [today, setToday] = useState(isoToday)
  const [recordedToday, setRecordedToday] = useState(false)
  /** Bumps after each evening, so the next one gets planned. */
  const [rung, setRung] = useState(0)
  const { db, ready } = ledger

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => { if (active) setPreference(parseReminder(raw)) })
      .catch(() => undefined)
      .finally(() => { if (active) setRestored(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!restored) return
    void SecureStore.setItemAsync(STORE_KEY, JSON.stringify(preference)).catch(() => undefined)
  }, [preference, restored])

  useEffect(() => {
    const onReturn = (): void => {
      if (document.visibilityState === 'visible') setToday(isoToday())
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    return () => {
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [])

  useEffect(() => {
    if (!db || !ready) {
      setRecordedToday(false)
      return
    }
    let active = true
    void hasTransactionOnDate(db, today)
      .then((found) => { if (active) setRecordedToday(found) })
      .catch(() => undefined)
    return () => { active = false }
  }, [db, ready, ledger.version, today])

  useEffect(() => {
    if (!restored) return
    const target = nextReminder(new Date(), preference, recordedToday)
    if (!target) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const ring = async (now: Date): Promise<void> => {
      if (!isDue(target, now)) return
      const day = isoFromParts(target.getFullYear(), target.getMonth(), target.getDate())
      if (db && ready && await hasTransactionOnDate(db, day).catch(() => false)) return
      if (!active) return
      window.api.notify({
        title: 'Nothing logged today',
        body: 'Add what you spent while you still remember it.',
        route: '/money/transactions?new=true'
      })
    }
    const check = (): void => {
      const now = new Date()
      if (now < target) {
        timer = setTimeout(check, waitFor(target, now))
        return
      }
      void ring(now).finally(() => {
        if (!active) return
        setToday(isoToday())
        setRung((count) => count + 1)
      })
    }
    check()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [db, preference, ready, recordedToday, restored, rung, today])

  const setEnabled = useCallback((enabled: boolean): void => setPreference((current) => ({ ...current, enabled })), [])
  const setHour = useCallback((hour: number): void => setPreference((current) => ({ ...current, hour })), [])

  const value = useMemo<ReminderContextValue>(() => ({ preference, setEnabled, setHour }), [preference, setEnabled, setHour])
  return <ReminderContext.Provider value={value}>{children}</ReminderContext.Provider>
}

export function useReminder(): ReminderContextValue {
  const context = useContext(ReminderContext)
  if (!context) throw new Error('useReminder must be used inside ReminderProvider')
  return context
}
