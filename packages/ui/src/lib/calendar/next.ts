import { useEffect, useState } from 'react'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { freshNextCalendarEvent } from '@ego/local/calendar/store'
import { useLedger } from '../ledger'

const RECHECK_MS = 60_000

/** The next event from the stored copy, for the start screen. It never waits on the network. */
export function useNextEvent(): { event: CalendarEvent; calendar: CalendarInfo } | null {
  const { db, api } = useLedger()
  const [next, setNext] = useState<{ event: CalendarEvent; calendar: CalendarInfo } | null>(null)
  useEffect(() => {
    if (!db) {
      setNext(null)
      return
    }
    let active = true
    const read = (): void => {
      void freshNextCalendarEvent(db, api, new Date())
        .then((found) => { if (active) setNext(found) })
        .catch(() => undefined)
    }
    read()
    const timer = window.setInterval(read, RECHECK_MS)
    window.addEventListener('focus', read)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', read)
    }
  }, [api, db])
  return next
}
