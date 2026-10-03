import { reminderPlan, type ReminderPreference } from '@ego/local/reminders'

/**
 * The longest single timer. A computer that sleeps through the evening wakes to a timer that is
 * at most this far behind, rather than one Windows may have stretched by hours.
 */
export const MAX_WAIT_MS = 15 * 60 * 1000

/** The next evening the reminder could ring: tonight unless something is logged or the hour has passed. */
export function nextReminder(now: Date, preference: ReminderPreference, recordedToday: boolean): Date | null {
  if (!preference.enabled) return null
  return reminderPlan(now, preference.hour, recordedToday, 2)[0] ?? null
}

/** A reminder rings on its own day only. One the computer slept through until morning stays quiet. */
export function isDue(target: Date, now: Date): boolean {
  return now.getTime() >= target.getTime() &&
    now.getFullYear() === target.getFullYear() &&
    now.getMonth() === target.getMonth() &&
    now.getDate() === target.getDate()
}

export function waitFor(target: Date, now: Date): number {
  return Math.max(0, Math.min(target.getTime() - now.getTime(), MAX_WAIT_MS))
}
