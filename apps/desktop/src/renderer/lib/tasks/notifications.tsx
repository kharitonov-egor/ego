import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_TASK_NOTIFICATIONS, parseTaskNotifications, taskNotificationPlan, type TaskNotificationPreference
} from '@ego/local/tasks/reminders'
import { SecureStore } from '../preferences'
import { useTasks } from './context'
import { createReminderScheduler } from './scheduler'

const STORE_KEY = 'ego.tasks.notifications'
/** A drag or a burst of edits settles before the schedule is rebuilt. */
const SETTLE_MS = 800

interface TaskNotificationsValue {
  preference: TaskNotificationPreference
  setDigest: (on: boolean) => void
}

const TaskNotificationsContext = createContext<TaskNotificationsValue | null>(null)

/**
 * Due-date reminders and the morning digest, scheduled on this computer. Every change to the
 * cards, including one pulled from another device, cancels what Tasks scheduled and schedules the
 * new plan, so a done or moved card never rings. Clicking a reminder opens its card.
 */
export function TaskNotificationsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { data, now } = useTasks()
  const [preference, setPreference] = useState<TaskNotificationPreference>(DEFAULT_TASK_NOTIFICATIONS)
  const [restored, setRestored] = useState(false)
  const scheduler = useMemo(() => createReminderScheduler((input) => window.api.notify(input)), [])

  useEffect(() => scheduler.cancel, [scheduler])

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
    if (!restored) return
    if (!data) {
      scheduler.cancel()
      return
    }
    const timer = setTimeout(() => {
      const now = Date.now()
      const since = Math.min(scheduler.plannedAt() ?? now, now)
      scheduler.replace(taskNotificationPlan(data, new Date(since), preference), now)
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [data, hour, preference, restored, scheduler])

  const setDigest = useCallback((on: boolean): void => {
    setPreference((current) => ({ ...current, digest: on }))
  }, [])

  const value = useMemo<TaskNotificationsValue>(() => ({ preference, setDigest }), [preference, setDigest])
  return <TaskNotificationsContext.Provider value={value}>{children}</TaskNotificationsContext.Provider>
}

export function useTaskNotifications(): TaskNotificationsValue {
  const context = useContext(TaskNotificationsContext)
  if (!context) throw new Error('useTaskNotifications must be used inside TaskNotificationsProvider')
  return context
}
