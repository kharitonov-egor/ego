import {
  ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES, isAgentTrigger,
  type AgentTrigger, type AgentTriggerType, type AssistantToolName
} from '@ego/core'
import type { AgentFireResult, AgentGoal, AgentGoalStatus, AgentRunReason, AgentRunStatus } from '@ego/api-contracts'
import { isoToday, shiftIso } from '@ego/local/dates'
import { dayKeyOf, timeLabel } from '@ego/local/diary/format'

export interface GoalDraft {
  title: string
  instructions: string
  type: AgentTriggerType
  time: string
  weekday: number
  hours: string
  date: string
}

export interface GoalFormValue {
  title: string
  instructions: string
  trigger: AgentTrigger
}

export const TRIGGER_LABELS: Record<AgentTriggerType, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  interval: 'Every N hours',
  once: 'Once',
  manual: 'Only when asked'
}

export const WEEKDAY_VALUES = ['1', '2', '3', '4', '5', '6', '7'] as const
export type WeekdayValue = typeof WEEKDAY_VALUES[number]
export const WEEKDAY_LABELS: Record<WeekdayValue, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun'
}

export function weekdayValue(weekday: number): WeekdayValue {
  return WEEKDAY_VALUES[Math.min(7, Math.max(1, Math.round(weekday))) - 1]
}

export const GOAL_STATUS_LABELS: Record<AgentGoalStatus, string> = { active: 'Active', paused: 'Paused', done: 'Done' }
export const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = { queued: 'Queued', running: 'Running', succeeded: 'Done', failed: 'Failed' }
export const RUN_REASON_LABELS: Record<AgentRunReason, string> = {
  schedule: 'On schedule', now: 'Run now', delegate: 'Handed off from chat', event: 'Set off by an event'
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    return null
  }
}

export function blankDraft(today = isoToday()): GoalDraft {
  return { title: '', instructions: '', type: 'daily', time: '07:00', weekday: 1, hours: '24', date: shiftIso(today, 1) }
}

export function draftFor(goal: Pick<AgentGoal, 'title' | 'instructions' | 'trigger'>, today = isoToday()): GoalDraft {
  const draft: GoalDraft = { ...blankDraft(today), title: goal.title, instructions: goal.instructions, type: goal.trigger.type }
  const trigger = goal.trigger
  switch (trigger.type) {
    case 'daily':
    case 'weekdays': return { ...draft, time: trigger.time }
    case 'weekly': return { ...draft, weekday: trigger.weekday, time: trigger.time }
    case 'interval': return { ...draft, hours: String(trigger.hours) }
    case 'once': return { ...draft, date: trigger.date, time: trigger.time }
    case 'manual': return draft
  }
}

/** Takes 7:00 for 07:00, since that is how people type a morning time. */
export function normalizeClock(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : value.trim()
}

function draftCandidate(draft: GoalDraft): Record<string, unknown> {
  const time = normalizeClock(draft.time)
  switch (draft.type) {
    case 'daily':
    case 'weekdays': return { type: draft.type, time }
    case 'weekly': return { type: 'weekly', weekday: draft.weekday, time }
    case 'interval': return { type: 'interval', hours: /^\d+$/.test(draft.hours.trim()) ? Number(draft.hours.trim()) : Number.NaN }
    case 'once': return { type: 'once', date: draft.date.trim(), time }
    case 'manual': return { type: 'manual' }
  }
}

/** The trigger the form describes, or what to fix. */
export function draftTrigger(draft: GoalDraft): AgentTrigger | string {
  const candidate = draftCandidate(draft)
  if (isAgentTrigger(candidate)) return candidate
  if (draft.type === 'interval') return 'Hours go from 1 to 168'
  if (!CLOCK.test(normalizeClock(draft.time))) return 'Enter the time as HH:MM, like 07:00'
  if (draft.type === 'once') return 'Enter the date as YYYY-MM-DD'
  return 'Pick a day of the week'
}

export function goalFormValue(draft: GoalDraft): GoalFormValue | string {
  const trigger = draftTrigger(draft)
  if (typeof trigger === 'string') return trigger
  const title = draft.title.trim()
  const instructions = draft.instructions.trim()
  if (!title) return 'Give the goal a title'
  if (instructions.length < 3) return 'Say what the agent should do'
  return { title, instructions, trigger }
}

export const GOAL_EXAMPLES: ReadonlyArray<{ label: string; draft: Omit<GoalDraft, 'date'> }> = [
  {
    label: 'Weekday brief at 7:00',
    draft: {
      title: 'Weekday brief',
      instructions: 'Look at today\'s calendar, tasks due today or overdue, Canvas assignments due this week, and yesterday\'s habits. Post a short brief: what is on today, what is due, and one thing to watch.',
      type: 'weekdays', time: '07:00', weekday: 1, hours: '24'
    }
  },
  {
    label: 'Sunday money review',
    draft: {
      title: 'Sunday money review',
      instructions: 'Review this week\'s spending against the budget. Name the biggest categories, anything unusual, and how much is left for the month. Keep it short.',
      type: 'weekly', time: '18:00', weekday: 7, hours: '24'
    }
  }
]

/** "today at 7:00 AM", "tomorrow at 7:00 AM", "Mon, Oct 12 at 7:00 AM", on the phone's clock. */
export function momentLabel(iso: string, today = isoToday()): string {
  const key = dayKeyOf(iso)
  const time = timeLabel(iso)
  if (key === today) return `today at ${time}`
  if (key === shiftIso(today, 1)) return `tomorrow at ${time}`
  if (key === shiftIso(today, -1)) return `yesterday at ${time}`
  const date = new Date(iso)
  const sameYear = key.slice(0, 4) === today.slice(0, 4)
  const day = date.toLocaleDateString('en-US', sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `${day} at ${time}`
}

export function expiresLabel(iso: string, now = Date.now()): string {
  return Date.parse(iso) <= now ? 'Expired' : `Expires ${momentLabel(iso)}`
}

export function runResultLabel(result: AgentFireResult): string {
  if (result.error) return result.error
  if (result.fired) return 'The agent is on it'
  return 'Queued. The agent picks it up on its next check.'
}

export function wakeResultLabel(result: AgentFireResult): string {
  if (result.error) return result.error
  if (result.fired) return result.runs === 1 ? 'Woke the agent for 1 run' : `Woke the agent for ${result.runs} runs`
  return 'No runs are waiting, so there was nothing to wake it for'
}

/** Goal tools change the agent's own work, so they always ask. */
const NEVER_TRUSTED = new Set<AssistantToolName>(['create_goal', 'update_goal', 'delegate_task'])

export const TRUSTED_TOOL_LABELS: Partial<Record<AssistantToolName, string>> = {
  record_transactions: 'Record money',
  save_mood: 'Save your mood',
  log_habit: 'Check off habits',
  unlog_habit: 'Take back habit check-offs',
  log_gym_sets: 'Log gym sets',
  mark_study: 'Check off assignments',
  add_task_card: 'Add task cards',
  update_task_card: 'Change task cards',
  log_food: 'Log food',
  add_fridge_items: 'Add to the fridge list',
  remove_fridge_items: 'Take off the fridge list',
  set_food_targets: 'Set food targets',
  add_calendar_event: 'Add calendar events',
  update_calendar_event: 'Change calendar events',
  delete_calendar_event: 'Delete calendar events',
  answer_calendar_event: 'Answer invitations'
}

export const TRUSTABLE_TOOLS: ReadonlyArray<{ name: AssistantToolName; label: string }> = ASSISTANT_TOOL_NAMES
  .filter((name) => ASSISTANT_TOOLS[name].access === 'write' && !NEVER_TRUSTED.has(name))
  .map((name) => ({ name, label: TRUSTED_TOOL_LABELS[name] ?? name.replace(/_/g, ' ') }))

/** "10:00 PM" for "22:00". */
export function clockLabel(time: string): string {
  const hour = Number(time.slice(0, 2))
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${time.slice(3, 5)} ${hour < 12 ? 'AM' : 'PM'}`
}

/** Moves an HH:MM time by some minutes, wrapping past midnight. */
export function shiftClock(time: string, minutes: number): string {
  const total = (((Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
