import { TASK_DIGEST_PREFIX, cardIdFromNotification, type PlannedNotification } from '@ego/local/tasks/reminders'
import type { NotifyInput } from '../../../shared/local'

/** The longest delay setTimeout holds, about 24.8 days. The hourly replan reaches anything later. */
export const LONGEST_TIMER_MS = 2 ** 31 - 1

/** Where a click on the notification goes: the digest opens Upcoming, a reminder opens its card. */
export function notificationRoute(identifier: string): string | undefined {
  if (identifier.startsWith(TASK_DIGEST_PREFIX)) return '/tasks/upcoming'
  const cardId = cardIdFromNotification(identifier)
  return cardId ? `/tasks/card/${encodeURIComponent(cardId)}` : undefined
}

export interface ReminderScheduler {
  /** Cancels everything scheduled before and schedules `plan` instead. */
  replace: (plan: readonly PlannedNotification[], now: number) => void
  cancel: () => void
}

/**
 * The phone hands its plan to the system's alarm service. Ego keeps running in the tray, so here
 * each notification waits on a timer in the window and goes out through the main process.
 */
export function createReminderScheduler(notify: (input: NotifyInput) => void): ReminderScheduler {
  let timers: Array<ReturnType<typeof setTimeout>> = []
  const cancel = (): void => {
    for (const timer of timers) clearTimeout(timer)
    timers = []
  }
  return {
    replace: (plan, now) => {
      cancel()
      for (const item of plan) {
        const delay = item.at.getTime() - now
        if (delay <= 0 || delay > LONGEST_TIMER_MS) continue
        const input: NotifyInput = { title: item.title, body: item.body, route: notificationRoute(item.identifier) }
        timers.push(setTimeout(() => notify(input), delay))
      }
    },
    cancel
  }
}
