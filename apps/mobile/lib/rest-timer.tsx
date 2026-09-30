import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, PermissionsAndroid, Platform, Vibration, type Permission } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { requireOptionalNativeModule } from 'expo'
import { hideRestCountdown, showRestCountdown } from '../modules/rest-countdown'

type Notifications = typeof import('expo-notifications')

const AVAILABLE = requireOptionalNativeModule('ExpoNotificationScheduler') !== null
let loading: Promise<Notifications> | null = null
function notifications(): Promise<Notifications> {
  loading ??= import('expo-notifications')
  return loading
}

const STORE_KEY = 'ego.gym.rest'
const NOTIFICATION_ID = 'ego-rest-timer'
const CHANNEL = 'rest-timer'

/**
 * Android throws from Vibration.vibrate when the manifest lacks VIBRATE, and builds made before the
 * rest timer do lack it. The typings list only runtime permissions, hence the cast.
 */
const VIBRATE_PERMISSION: string = 'android.permission.VIBRATE'
let vibrationAllowed: Promise<boolean> | null = null
function canVibrate(): Promise<boolean> {
  if (Platform.OS !== 'android') return Promise.resolve(true)
  vibrationAllowed ??= PermissionsAndroid.check(VIBRATE_PERMISSION as Permission).catch(() => false)
  return vibrationAllowed
}

export const REST_PRESETS = [30, 60, 90, 120, 180, 300] as const

export interface RestPreference {
  seconds: number
  autoStart: boolean
}

export const DEFAULT_REST: RestPreference = { seconds: 90, autoStart: true }

export function parseRestPreference(raw: string | null): RestPreference {
  if (!raw) return DEFAULT_REST
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return DEFAULT_REST
    const record: Record<string, unknown> = { ...value }
    const seconds = typeof record.seconds === 'number' && Number.isInteger(record.seconds) && record.seconds >= 5 && record.seconds <= 3600
      ? record.seconds
      : DEFAULT_REST.seconds
    return { seconds, autoStart: record.autoStart !== false }
  } catch {
    return DEFAULT_REST
  }
}

export function secondsLeft(endsAt: number | null, now: number): number {
  if (endsAt === null) return 0
  return Math.max(0, Math.ceil((endsAt - now) / 1000))
}

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

async function cancelNotification(): Promise<void> {
  if (!AVAILABLE) return
  const api = await notifications()
  await api.cancelScheduledNotificationAsync(NOTIFICATION_ID)
}

async function askForNotifications(): Promise<void> {
  if (!AVAILABLE) return
  const api = await notifications()
  const permission = await api.getPermissionsAsync()
  if (!permission.granted && permission.canAskAgain) await api.requestPermissionsAsync()
}

/**
 * While the app is open the phone vibrates at zero. When it goes to the background a notification
 * is scheduled for the same moment, and cancelled again when the app returns. The ongoing countdown
 * notification is separate and shows for as long as the timer runs.
 */
async function scheduleNotification(endsAt: number): Promise<void> {
  if (!AVAILABLE || endsAt <= Date.now()) return
  const api = await notifications()
  const permission = await api.getPermissionsAsync()
  if (!permission.granted) return
  if (Platform.OS === 'android') {
    await api.setNotificationChannelAsync(CHANNEL, { name: 'Rest timer', importance: api.AndroidImportance.HIGH })
  }
  await api.scheduleNotificationAsync({
    identifier: NOTIFICATION_ID,
    content: { title: 'Rest is over', body: 'Time for the next set.' },
    trigger: { type: api.SchedulableTriggerInputTypes.DATE, date: new Date(endsAt), channelId: CHANNEL }
  })
}

export function RestTimerProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [preference, setPreference] = useState<RestPreference>(DEFAULT_REST)
  const [restored, setRestored] = useState(false)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now)
  const [finished, setFinished] = useState(false)
  const endsAtRef = useRef<number | null>(null)
  endsAtRef.current = endsAt

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
        void canVibrate().then((allowed) => { if (allowed) Vibration.vibrate([0, 400, 200, 400]) })
      }
    }, 250)
    return () => clearInterval(tick)
  }, [endsAt])

  useEffect(() => {
    if (endsAt === null) hideRestCountdown()
    else showRestCountdown(endsAt)
  }, [endsAt])

  useEffect(() => {
    if (!finished) return
    const clear = setTimeout(() => setFinished(false), 4000)
    return () => clearTimeout(clear)
  }, [finished])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const current = endsAtRef.current
      if (state === 'background' && current !== null) void scheduleNotification(current).catch(() => undefined)
      if (state === 'active') {
        void cancelNotification().catch(() => undefined)
        setNow(Date.now())
      }
    })
    return () => subscription.remove()
  }, [])

  const start = useCallback((seconds?: number) => {
    const current = Date.now()
    setNow(current)
    setFinished(false)
    setEndsAt(current + (seconds ?? preference.seconds) * 1000)
    void askForNotifications().then(() => {
      if (endsAtRef.current !== null) showRestCountdown(endsAtRef.current)
    }).catch(() => undefined)
  }, [preference.seconds])

  const stop = useCallback(() => {
    setEndsAt(null)
    setFinished(false)
    void cancelNotification().catch(() => undefined)
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
