import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as TaskManager from 'expo-task-manager'
import * as BackgroundTask from 'expo-background-task'
import { requireOptionalNativeModule } from 'expo'
import type { NotificationPermissionsStatus } from 'expo-notifications'
import type { AgentNotificationPage } from '@ego/api-contracts'
import { moneyApiFor } from '@ego/local/api-client'
import { AGENT_CHAT_ROUTE, AGENT_NOTIFICATION_PREFIX, agentNotificationPlan } from './agent'
import { apiUrlFor, isSignedIn, readStoredSettings, useSettings, type EgoSettings } from './settings'

type Notifications = typeof import('expo-notifications')

const NOTIFICATIONS_AVAILABLE = requireOptionalNativeModule('ExpoNotificationScheduler') !== null
let loading: Promise<Notifications> | null = null
function notifications(): Promise<Notifications> {
  loading ??= import('expo-notifications')
  return loading
}

const TASK_NAME = 'ego-agent-notifications'
const CURSOR_KEY = 'ego.agent.notificationCursor'
const CHANNEL = 'agent-messages'
const INTERVAL_MINUTES = 15

async function present(page: AgentNotificationPage): Promise<void> {
  if (!NOTIFICATIONS_AVAILABLE || page.notifications.length === 0) return
  const api = await notifications()
  if (!(await api.getPermissionsAsync()).granted) return
  const [presented, scheduled] = await Promise.all([api.getPresentedNotificationsAsync(), api.getAllScheduledNotificationsAsync()])
  const shown = new Set([...presented.map((item) => item.request.identifier), ...scheduled.map((item) => item.identifier)])
  const plan = agentNotificationPlan(page, new Date(), shown)
  if (plan.length === 0) return
  if (Platform.OS === 'android') {
    await api.setNotificationChannelAsync(CHANNEL, { name: 'Agent messages', importance: api.AndroidImportance.HIGH })
  }
  for (const item of plan) {
    await api.scheduleNotificationAsync({
      identifier: item.identifier,
      content: { title: item.title, body: item.body, data: { route: AGENT_CHAT_ROUTE } },
      trigger: item.at
        ? { type: api.SchedulableTriggerInputTypes.DATE, date: item.at, channelId: CHANNEL }
        : { channelId: CHANNEL }
    })
  }
}

async function check(given: EgoSettings | undefined): Promise<boolean> {
  const settings = given ?? await readStoredSettings()
  if (!isSignedIn(settings)) return false
  const api = moneyApiFor({ url: apiUrlFor(settings), token: settings.deviceToken })
  const after = await SecureStore.getItemAsync(CURSOR_KEY).catch(() => null)
  const result = await api.agentNotifications(after)
  if (!result.ok) return false
  await present(result.data)
  if (result.data.cursor && result.data.cursor !== after) await SecureStore.setItemAsync(CURSOR_KEY, result.data.cursor)
  return true
}

let running: Promise<boolean> | null = null

/**
 * Asks the Worker for agent messages since the last check and schedules them here. The Worker has
 * already applied quiet hours, the daily cap, and muted goals. Resolves to whether it got an answer.
 */
export function checkAgentNotifications(settings?: EgoSettings): Promise<boolean> {
  running ??= check(settings).catch(() => false).finally(() => { running = null })
  return running
}

/**
 * Android runs this task without mounting a screen, and the router loads app/ files only to render
 * them, so index.ts imports this module ahead of the router. TaskManager unregisters a task it
 * cannot find.
 */
TaskManager.defineTask(TASK_NAME, async () => {
  const answered = await checkAgentNotifications()
  return answered ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed
})

async function stopChecking(): Promise<void> {
  await BackgroundTask.unregisterTaskAsync(TASK_NAME).catch(() => undefined)
  await SecureStore.deleteItemAsync(CURSOR_KEY).catch(() => undefined)
  if (!NOTIFICATIONS_AVAILABLE) return
  const api = await notifications()
  const scheduled = await api.getAllScheduledNotificationsAsync()
  await Promise.all(scheduled
    .filter((item) => item.identifier.startsWith(AGENT_NOTIFICATION_PREFIX))
    .map((item) => api.cancelScheduledNotificationAsync(item.identifier)))
}

/** Checks while signed in: in the background, when the app starts, and each time it comes back to the front. */
export function AgentNotificationChecks(): null {
  const { settings, loading: settingsLoading } = useSettings()
  const signedIn = isSignedIn(settings)
  const latest = useRef(settings)
  latest.current = settings

  useEffect(() => {
    if (settingsLoading) return
    if (!signedIn) {
      void stopChecking().catch(() => undefined)
      return
    }
    void BackgroundTask.registerTaskAsync(TASK_NAME, { minimumInterval: INTERVAL_MINUTES }).catch(() => undefined)
    void checkAgentNotifications(latest.current)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAgentNotifications(latest.current)
    })
    return () => subscription.remove()
  }, [settingsLoading, signedIn, settings.deviceToken])

  return null
}

export type NotificationPermission = 'granted' | 'ask' | 'blocked'

function permissionOf(status: NotificationPermissionsStatus): NotificationPermission {
  if (status.granted) return 'granted'
  return status.canAskAgain ? 'ask' : 'blocked'
}

/** Null while loading, or in a build without notifications. */
export function useNotificationPermission(): { permission: NotificationPermission | null; allow: () => Promise<void> } {
  const [permission, setPermission] = useState<NotificationPermission | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!NOTIFICATIONS_AVAILABLE) return
    const api = await notifications()
    setPermission(permissionOf(await api.getPermissionsAsync()))
  }, [])

  useEffect(() => {
    void refresh().catch(() => undefined)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh().catch(() => undefined)
    })
    return () => subscription.remove()
  }, [refresh])

  const allow = useCallback(async (): Promise<void> => {
    if (!NOTIFICATIONS_AVAILABLE) return
    const api = await notifications()
    const current = await api.getPermissionsAsync()
    if (current.granted) return
    if (!current.canAskAgain) {
      await Linking.openSettings()
      return
    }
    setPermission(permissionOf(await api.requestPermissionsAsync()))
  }, [])

  return { permission, allow }
}
