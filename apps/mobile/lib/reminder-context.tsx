import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { requireOptionalNativeModule } from 'expo'
import { useRootNavigationState, useRouter } from 'expo-router'
import { isoToday } from '@ego/local/dates'
import { useLedger } from './ledger-context'
import { hasTransactionOnDate } from '@ego/local/repositories/transactions'
import {
  DEFAULT_REMINDER, REMINDER_PREFIX, parseReminder, reminderId, reminderPlan, type ReminderPreference
} from '@ego/local/reminders'

type Notifications = typeof import('expo-notifications')

/**
 * Builds made before expo-notifications was added lack its native side, and importing the package
 * there throws. The module loads only when the native scheduler is present.
 */
const AVAILABLE = requireOptionalNativeModule('ExpoNotificationScheduler') !== null
let loading: Promise<Notifications> | null = null
function notifications(): Promise<Notifications> {
  loading ??= import('expo-notifications')
  return loading
}

const STORE_KEY = 'ego.reminder'
const CHANNEL = 'daily-reminder'

interface ReminderContextValue {
  available: boolean
  preference: ReminderPreference
  /** The system refused notifications, so the switch cannot turn on from inside the app. */
  blocked: boolean
  setEnabled: (enabled: boolean) => Promise<void>
  setHour: (hour: number) => void
}

const ReminderContext = createContext<ReminderContextValue | null>(null)

export function ReminderProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const router = useRouter()
  const navigationReady = Boolean(useRootNavigationState()?.key)
  const [preference, setPreference] = useState<ReminderPreference>(DEFAULT_REMINDER)
  const [restored, setRestored] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [today, setToday] = useState(isoToday)
  const [recordedToday, setRecordedToday] = useState(false)
  const handled = useRef<string | null>(null)

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
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(isoToday())
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!ledger.db || !ledger.ready) {
      setRecordedToday(false)
      return
    }
    let active = true
    void hasTransactionOnDate(ledger.db, today)
      .then((found) => { if (active) setRecordedToday(found) })
      .catch(() => undefined)
    return () => { active = false }
  }, [ledger.db, ledger.ready, ledger.version, today])

  useEffect(() => {
    if (!AVAILABLE || !restored) return
    void (async () => {
      const api = await notifications()
      const scheduled = await api.getAllScheduledNotificationsAsync()
      await Promise.all(scheduled
        .filter((item) => item.identifier.startsWith(REMINDER_PREFIX))
        .map((item) => api.cancelScheduledNotificationAsync(item.identifier)))
      if (!preference.enabled) return
      const permission = await api.getPermissionsAsync()
      if (!permission.granted) return
      if (Platform.OS === 'android') {
        await api.setNotificationChannelAsync(CHANNEL, { name: 'Daily reminder', importance: api.AndroidImportance.DEFAULT })
      }
      for (const date of reminderPlan(new Date(), preference.hour, recordedToday)) {
        await api.scheduleNotificationAsync({
          identifier: reminderId(date),
          content: { title: 'Nothing logged today', body: 'Add what you spent while you still remember it.' },
          trigger: { type: api.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL }
        })
      }
    })().catch(() => undefined)
  }, [preference, recordedToday, restored, today])

  const openEntry = useCallback((identifier: string): void => {
    if (!identifier.startsWith(REMINDER_PREFIX) || handled.current === identifier) return
    handled.current = identifier
    router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })
  }, [router])

  useEffect(() => {
    if (!AVAILABLE || !navigationReady) return
    let active = true
    let subscription: { remove: () => void } | null = null
    void notifications().then(async (api) => {
      if (!active) return
      api.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false })
      })
      subscription = api.addNotificationResponseReceivedListener((response) => openEntry(response.notification.request.identifier))
      const launch = await api.getLastNotificationResponseAsync()
      if (active && launch) openEntry(launch.notification.request.identifier)
    }).catch(() => undefined)
    return () => {
      active = false
      subscription?.remove()
    }
  }, [navigationReady, openEntry])

  const setEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (enabled && AVAILABLE) {
      const api = await notifications()
      let permission = await api.getPermissionsAsync()
      if (!permission.granted && permission.canAskAgain) permission = await api.requestPermissionsAsync()
      if (!permission.granted) {
        setBlocked(true)
        return
      }
    }
    setBlocked(false)
    setPreference((current) => ({ ...current, enabled }))
  }, [])

  const setHour = useCallback((hour: number): void => setPreference((current) => ({ ...current, hour })), [])

  const value = useMemo<ReminderContextValue>(() => ({
    available: AVAILABLE, preference, blocked, setEnabled, setHour
  }), [blocked, preference, setEnabled, setHour])
  return <ReminderContext.Provider value={value}>{children}</ReminderContext.Provider>
}

export function useReminder(): ReminderContextValue {
  const context = useContext(ReminderContext)
  if (!context) throw new Error('useReminder must be used inside ReminderProvider')
  return context
}
