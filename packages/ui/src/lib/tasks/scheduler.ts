import { TASK_DIGEST_PREFIX, cardIdFromNotification, type PlannedNotification } from '@ego/local/tasks/reminders'
import type { NotifyInput } from '../../platform/local'

/** The longest delay setTimeout holds, about 24.8 days. The hourly replan reaches anything later. */
export const LONGEST_TIMER_MS = 2 ** 31 - 1

/** Where a click on the notification goes: the digest opens Upcoming, a reminder opens its card. */
export function notificationRoute(identifier: string): string | undefined {
  if (identifier.startsWith(TASK_DIGEST_PREFIX)) return '/tasks/upcoming'
  const cardId = cardIdFromNotification(identifier)
  return cardId ? `/tasks/card/${encodeURIComponent(cardId)}` : undefined
}

export interface ReminderScheduler {
  /** When the current plan was made, so the next one can be planned from there. Null before the first. */
  plannedAt: () => number | null
  /**
   * Cancels the timers of the plan before and schedules `plan` instead. A reminder the plan
   * before was waiting on that came due without showing, as when Windows slept through it, shows
   * now, once, if `plan` still holds it. Of several missed digests only the latest shows.
   */
  replace: (plan: readonly PlannedNotification[], now: number) => void
  /** Stops everything, as on sign-out. The next plan starts fresh. */
  cancel: () => void
}

function keyOf(item: PlannedNotification): string {
  return `${item.identifier}@${item.at.getTime()}`
}

/**
 * The phone hands its plan to the system's alarm service. Ego keeps running in the tray, so here
 * each notification waits on a timer in the window and goes out through the main process.
 */
export function createReminderScheduler(notify: (input: NotifyInput) => void): ReminderScheduler {
  let timers: Array<ReturnType<typeof setTimeout>> = []
  let waiting = new Set<string>()
  let shown = new Set<string>()
  let plannedAt: number | null = null

  const show = (item: PlannedNotification): void => {
    shown.add(keyOf(item))
    notify({ title: item.title, body: item.body, route: notificationRoute(item.identifier) })
  }
  const clearTimers = (): void => {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }

  return {
    plannedAt: () => plannedAt,
    replace: (plan, now) => {
      clearTimers()
      const due = plan.filter((item) => item.at.getTime() <= now && waiting.has(keyOf(item)) && !shown.has(keyOf(item)))
      const digests = due.filter((item) => item.identifier.startsWith(TASK_DIGEST_PREFIX))
      const missed = [...due.filter((item) => !digests.includes(item)), ...digests.slice(-1)]
      waiting = new Set()
      shown = new Set()
      plannedAt = now
      for (const item of missed) show(item)
      for (const item of plan) {
        const delay = item.at.getTime() - now
        if (delay <= 0 || delay > LONGEST_TIMER_MS) continue
        waiting.add(keyOf(item))
        timers.push(setTimeout(() => show(item), delay))
      }
    },
    cancel: () => {
      clearTimers()
      waiting = new Set()
      shown = new Set()
      plannedAt = null
    }
  }
}
