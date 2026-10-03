import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { freshNextCalendarEvent } from '@ego/local/calendar/store'
import { useLedger } from '../ledger-context'

const RECHECK_MS = 60_000

/** The next event from the stored copy, for the start screen. It never waits on the network. */
export function useNextEvent(): { event: CalendarEvent; calendar: CalendarInfo } | null {
  const { db, api } = useLedger()
  const [next, setNext] = useState<{ event: CalendarEvent; calendar: CalendarInfo } | null>(null)
  const read = useCallback((): void => {
    if (!db) {
      setNext(null)
      return
    }
    void freshNextCalendarEvent(db, api, new Date()).then(setNext).catch(() => undefined)
  }, [api, db])
  useFocusEffect(useCallback(() => {
    read()
    const timer = setInterval(read, RECHECK_MS)
    return () => clearInterval(timer)
  }, [read]))
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') read() })
    return () => subscription.remove()
  }, [read])
  return next
}
