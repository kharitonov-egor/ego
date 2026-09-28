export interface ReminderPreference {
  enabled: boolean
  /** Local hour, 0 to 23. */
  hour: number
}

export const DEFAULT_REMINDER: ReminderPreference = { enabled: false, hour: 21 }
export const REMINDER_HOURS = [19, 20, 21, 22] as const
export const REMINDER_PREFIX = 'ego-daily-reminder-'
/** Scheduled ahead so the reminder still fires on days the app is never opened. */
export const REMINDER_DAYS = 7

export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve} ${suffix}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function reminderId(date: Date): string {
  return `${REMINDER_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The next reminders, one per evening. Tonight's is left out once something is recorded today, or
 * when its hour has already passed.
 */
export function reminderPlan(now: Date, hour: number, recordedToday: boolean, days: number = REMINDER_DAYS): Date[] {
  const plan: Date[] = []
  for (let offset = 0; offset < days; offset += 1) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0, 0)
    if (offset === 0 && recordedToday) continue
    if (at.getTime() <= now.getTime()) continue
    plan.push(at)
  }
  return plan
}

export function parseReminder(raw: string | null): ReminderPreference {
  if (!raw) return DEFAULT_REMINDER
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_REMINDER
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_REMINDER
  const record: Record<string, unknown> = { ...parsed }
  const hour = typeof record.hour === 'number' && Number.isInteger(record.hour) && record.hour >= 0 && record.hour <= 23
    ? record.hour
    : DEFAULT_REMINDER.hour
  return { enabled: record.enabled === true, hour }
}
