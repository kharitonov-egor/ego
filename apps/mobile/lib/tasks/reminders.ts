import { TASK_DAY_REMINDER_HOUR, taskDueAt, taskReminderAt, taskTimeLabel } from '@ego/core'
import { dueBadge, isCardVisible, localDay } from './board'
import type { TaskData } from './repository'

export const TASK_REMINDER_PREFIX = 'ego-task-'
export const TASK_DIGEST_PREFIX = 'ego-task-digest-'
/** Android keeps a few hundred alarms per app; the soonest ones are enough, since every change plans again. */
export const TASK_REMINDER_LIMIT = 60
export const TASK_DIGEST_DAYS = 7

export interface PlannedNotification {
  identifier: string
  at: Date
  title: string
  body: string
}

export interface TaskNotificationPreference {
  digest: boolean
}

export const DEFAULT_TASK_NOTIFICATIONS: TaskNotificationPreference = { digest: false }

export function parseTaskNotifications(raw: string | null): TaskNotificationPreference {
  if (!raw) return DEFAULT_TASK_NOTIFICATIONS
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_TASK_NOTIFICATIONS
    return { digest: 'digest' in parsed && parsed.digest === true }
  } catch {
    return DEFAULT_TASK_NOTIFICATIONS
  }
}

export function cardIdFromNotification(identifier: string): string | null {
  if (!identifier.startsWith(TASK_REMINDER_PREFIX) || identifier.startsWith(TASK_DIGEST_PREFIX)) return null
  return identifier.slice(TASK_REMINDER_PREFIX.length) || null
}

/** "today at 5 PM" reads as a sentence; "Oct 3" keeps its capital. */
function dueWords(label: string): string {
  return /^(Today|Tomorrow|Yesterday)/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`
}

/**
 * Every notification Tasks wants on the phone right now, soonest first. The caller cancels what it
 * scheduled before and schedules this list, so an edit, a done card, or a sync from another device
 * always leaves the schedule matching the cards. With the morning digest on, a date-only card's
 * same-day reminder is left to the digest instead of firing twice at 9 AM.
 */
export function taskNotificationPlan(
  data: TaskData, now: Date, preference: TaskNotificationPreference, limit = TASK_REMINDER_LIMIT
): PlannedNotification[] {
  const open = data.cards.filter((card) => card.doneAt === null && card.dueDate !== null && isCardVisible(data, card))
  const plan: PlannedNotification[] = []
  for (const card of open) {
    if (preference.digest && card.dueTime === null && (card.reminderMinutes ?? 0) < 1440) continue
    const at = taskReminderAt(card)
    if (!at || at.getTime() <= now.getTime()) continue
    const board = data.boards.find((item) => item.id === card.boardId)
    const list = data.lists.find((item) => item.id === card.listId)
    const due = dueBadge(card, at)
    plan.push({
      identifier: `${TASK_REMINDER_PREFIX}${card.id}`,
      at,
      title: card.title,
      body: [due ? `Due ${dueWords(due.label)}` : null, [board?.name, list?.name].filter(Boolean).join(' / ')]
        .filter(Boolean).join(' · ')
    })
  }
  if (preference.digest) {
    for (let offset = 0; offset < TASK_DIGEST_DAYS; offset += 1) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, TASK_DAY_REMINDER_HOUR, 0, 0, 0)
      if (at.getTime() <= now.getTime()) continue
      const day = localDay(at)
      const due = open.filter((card) => card.dueDate === day && taskDueAt(day, card.dueTime).getTime() >= at.getTime())
        .sort((left, right) => (left.dueTime ?? '99:99').localeCompare(right.dueTime ?? '99:99'))
      if (due.length === 0) continue
      const named = due.slice(0, 3).map((card) => card.dueTime ? `${card.title} (${taskTimeLabel(card.dueTime)})` : card.title)
      const rest = due.length - named.length
      plan.push({
        identifier: `${TASK_DIGEST_PREFIX}${day}`,
        at,
        title: `${plural(due.length, 'card')} due today`,
        body: rest > 0 ? `${named.join(', ')}, and ${rest} more` : named.join(', ')
      })
    }
  }
  return plan.sort((left, right) => left.at.getTime() - right.at.getTime()).slice(0, limit)
}
