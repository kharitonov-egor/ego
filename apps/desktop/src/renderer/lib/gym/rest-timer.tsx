import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { DEFAULT_REST, parseRestPreference, secondsLeft, type RestPreference } from '@ego/local/gym/rest'
import { SecureStore } from '../preferences'

export { REST_PRESETS } from '@ego/local/gym/rest'

const STORE_KEY = 'ego.gym.rest'

interface RestTimerValue {
  preference: RestPreference
  running: boolean
  start: (seconds?: number) => void
  stop: () => void
  adjust: (deltaSeconds: number) => void
  setSeconds: (seconds: number) => void
  setAutoStart: (autoStart: boolean) => void
}

interface RestClockValue {
  remaining: number
  /** True for a few seconds after the countdown reaches zero. */
  finished: boolean
}

const RestTimerContext = createContext<RestTimerValue | null>(null)
/** Separate from the controls, so only the countdown text re-renders every tick. */
const RestClockContext = createContext<RestClockValue>({ remaining: 0, finished: false })

let audio: AudioContext | null = null

/** Two short tones, where the phone vibrates twice. */
function beep(): void {
  if (typeof AudioContext === 'undefined') return
  audio ??= new AudioContext()
  const context = audio
  void context.resume().catch(() => undefined)
  for (const offset of [0, 0.3]) {
    const at = context.currentTime + offset
    const tone = context.createOscillator()
    const gain = context.createGain()
    tone.type = 'sine'
    tone.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
    tone.connect(gain).connect(context.destination)
    tone.start(at)
    tone.stop(at + 0.22)
  }
}

/**
 * The beep sounds either way. When Ego is behind another window or in the tray, a notification
 * says so too, and clicking it opens the exercise the rest started from.
 */
function ring(route: string): void {
  try {
    beep()
  } catch {
    // A missing audio device must not stop the notification.
  }
  if (!document.hasFocus()) window.api.notify({ title: 'Rest is over', body: 'Time for the next set.', route, silent: true })
}

export function RestTimerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const location = useLocation()
  const [preference, setPreference] = useState<RestPreference>(DEFAULT_REST)
  const [restored, setRestored] = useState(false)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now)
  const [finished, setFinished] = useState(false)
  const here = useRef('/gym')
  here.current = `${location.pathname}${location.search}`
  const startedFrom = useRef('/gym')

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => { if (active) setPreference(parseRestPreference(raw)) })
      .catch(() => undefined)
      .finally(() => { if (active) setRestored(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!restored) return
    void SecureStore.setItemAsync(STORE_KEY, JSON.stringify(preference)).catch(() => undefined)
  }, [preference, restored])

  useEffect(() => {
    if (endsAt === null) return
    const tick = setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= endsAt) {
        setEndsAt(null)
        setFinished(true)
        ring(startedFrom.current)
      }
    }, 250)
    return () => clearInterval(tick)
  }, [endsAt])

  useEffect(() => {
    if (!finished) return
    const clear = setTimeout(() => setFinished(false), 4000)
    return () => clearTimeout(clear)
  }, [finished])

  const start = useCallback((seconds?: number) => {
    const current = Date.now()
    startedFrom.current = here.current
    setNow(current)
    setFinished(false)
    setEndsAt(current + (seconds ?? preference.seconds) * 1000)
  }, [preference.seconds])

  const stop = useCallback(() => {
    setEndsAt(null)
    setFinished(false)
  }, [])

  const adjust = useCallback((deltaSeconds: number) => {
    setEndsAt((current) => {
      if (current === null) return current
      const next = current + deltaSeconds * 1000
      return next <= Date.now() ? null : next
    })
  }, [])

  const setSeconds = useCallback((seconds: number) => setPreference((current) => ({ ...current, seconds })), [])
  const setAutoStart = useCallback((autoStart: boolean) => setPreference((current) => ({ ...current, autoStart })), [])

  const running = endsAt !== null
  const value = useMemo<RestTimerValue>(() => ({
    preference, running, start, stop, adjust, setSeconds, setAutoStart
  }), [adjust, preference, running, setAutoStart, setSeconds, start, stop])
  const clock = useMemo<RestClockValue>(() => ({ remaining: secondsLeft(endsAt, now), finished }), [endsAt, finished, now])

  return <RestTimerContext.Provider value={value}>
    <RestClockContext.Provider value={clock}>{children}</RestClockContext.Provider>
  </RestTimerContext.Provider>
}

export function useRestClock(): RestClockValue {
  return useContext(RestClockContext)
}

export function useRestTimer(): RestTimerValue {
  const context = useContext(RestTimerContext)
  if (!context) throw new Error('useRestTimer must be used inside RestTimerProvider')
  return context
}
