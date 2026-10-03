import { useEffect, useState } from 'react'
import { isoToday } from '@ego/local/dates'

function untilMidnight(now: Date = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
}

/**
 * Today's date that moves on at local midnight and checks again when the window comes back, since
 * Ego can sit in the tray for days and a sleeping computer delays timers.
 */
export function useToday(): string {
  const [today, setToday] = useState(isoToday)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = (): void => {
      setToday(isoToday())
      clearTimeout(timer)
      timer = setTimeout(refresh, untilMidnight())
    }
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return today
}
