import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { requireOptionalNativeModule } from 'expo'
import { useRootNavigationState, useRouter } from 'expo-router'
import { useTasks } from './context'
import {
  DEFAULT_TASK_NOTIFICATIONS, TASK_DIGEST_PREFIX, TASK_REMINDER_PREFIX, cardIdFromNotification, parseTaskNotifications,
  taskNotificationPlan, type TaskNotificationPreference
} from '@ego/local/tasks/reminders'

type Notifications = typeof import('expo-notifications')

const AVAILABLE = requireOptionalNativeModule('ExpoNotificationScheduler') !== null
let loading: Promise<Notifications> | null = null
function notifications(): Promise<Notifications> {
  loading ??= import('expo-notifications')
  return loading
}

const STORE_KEY = 'ego.tasks.notifications'
const CHANNEL = 'task-reminders'
/** A drag or a burst of edits settles before the schedule is rebuilt. */
const SETTLE_MS = 800

interface TaskNotificationsValue {
  available: boolean
  preference: TaskNotificationPreference
  /** The system refused notifications, so reminders cannot fire until they are allowed in settings. */
  blocked: boolean
  setDigest: (on: boolean) => Promise<void>
  /** Asks once when a reminder is first set. Resolves to whether notifications can show. */
  ensurePermission: () => Promise<boolean>
}

const TaskNotificationsContext = createContext<TaskNotificationsValue | null>(null)

/**
 * Due-date reminders and the morning digest, scheduled on this phone. Every change to the cards,
 * including one pulled from another device, cancels what Tasks scheduled and schedules the new
 * plan, so a done or moved card never rings. Tapping a reminder opens its card.
 */
export function TaskNotificationsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { data, now } = useTasks()
  const router = useRouter()
  const navigationReady = Boolean(useRootNavigationState()?.key)
  const [preference, setPreference] = useState<TaskNotificationPreference>(DEFAULT_TASK_NOTIFICATIONS)
  const [restored, setRestored] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const handled = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => { if (active) setPreference(parseTaskNotifications(raw)) })
      .catch(() => undefined)
      .finally(() => { if (active) setRestored(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!restored) return
    void SecureStore.setItemAsync(STORE_KEY, JSON.stringify(preference)).catch(() => undefined)
  }, [preference, restored])

  const hour = now.getHours()
  useEffect(() => {
    if (!AVAILABLE || !restored || !data) return
    const timer = setTimeout(() => {
      void (async () => {
        const api = await notifications()
        const permission = await api.getPermissionsAsync()
        const scheduled = await api.getAllScheduledNotificationsAsync()
        await Promise.all(scheduled
          .filter((item) => item.identifier.startsWith(TASK_REMINDER_PREFIX))
          .map((item) => api.cancelScheduledNotificationAsync(item.identifier)))
        if (!permission.granted) return
        if (Platform.OS === 'android') {
          await api.setNotificationChannelAsync(CHANNEL, { name: 'Task reminders', importance: api.AndroidImportance.HIGH })
        }
        for (const item of taskNotificationPlan(data, new Date(), preference)) {
          await api.scheduleNotificationAsync({
            identifier: item.identifier,
            content: { title: item.title, body: item.body },
            trigger: { type: api.SchedulableTriggerInputTypes.DATE, date: item.at, channelId: CHANNEL }
          })
        }
      })().catch(() => undefined)
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [data, hour, preference, restored])

  /** A card keeps one identifier across reminders, so the delivery time tells two taps apart. */
  const open = useCallback((identifier: string, deliveredAt: number): void => {
    const key = `${identifier}@${deliveredAt}`
    if (!identifier.startsWith(TASK_REMINDER_PREFIX) || handled.current === key) return
    handled.current = key
    if (identifier.startsWith(TASK_DIGEST_PREFIX)) {
      router.push('/tasks/upcoming')
      return
    }
    const cardId = cardIdFromNotification(identifier)
    if (cardId) router.push({ pathname: '/tasks/card/[id]', params: { id: cardId } })
  }, [router])

  useEffect(() => {
    if (!AVAILABLE || !navigationReady) return
    let active = true
    let subscription: { remove: () => void } | null = null
    void notifications().then(async (api) => {
      if (!active) return
      subscription = api.addNotificationResponseReceivedListener((response) =>
        open(response.notification.request.identifier, response.notification.date))
      const launch = await api.getLastNotificationResponseAsync()
      if (active && launch) open(launch.notification.request.identifier, launch.notification.date)
    }).catch(() => undefined)
    return () => {
      active = false
      subscription?.remove()
    }
  }, [navigationReady, open])

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (!AVAILABLE) return false
    const api = await notifications()
    let permission = await api.getPermissionsAsync()
    if (!permission.granted && permission.canAskAgain) permission = await api.requestPermissionsAsync()
    setBlocked(!permission.granted)
    return permission.granted
  }, [])

  const setDigest = useCallback(async (on: boolean): Promise<void> => {
    if (on && !await ensurePermission()) return
    setPreference((current) => ({ ...current, digest: on }))
  }, [ensurePermission])

  const value = useMemo<TaskNotificationsValue>(() => ({
    available: AVAILABLE, preference, blocked, setDigest, ensurePermission
  }), [blocked, ensurePermission, preference, setDigest])
  return <TaskNotificationsContext.Provider value={value}>{children}</TaskNotificationsContext.Provider>
}

export function useTaskNotifications(): TaskNotificationsValue {
  const context = useContext(TaskNotificationsContext)
  if (!context) throw new Error('useTaskNotifications must be used inside TaskNotificationsProvider')
  return context
}
