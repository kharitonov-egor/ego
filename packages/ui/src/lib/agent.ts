import type {
  AgentFireResult, AgentGoalStatus, AgentMemory, AgentMemorySource, AgentRun, AgentRunReason, AgentRunStatus, AssistantChat
} from '@ego/api-contracts'
import {
  ASSISTANT_TOOLS, isAgentTrigger, type AgentTrigger, type AgentTriggerType, type AssistantToolName
} from '@ego/core'

const SOURCE_LABELS: Record<AgentMemorySource, string> = { chat: 'Chat', agent: 'Claude', user: 'You' }

export function sourceLabel(source: AgentMemorySource): string {
  return SOURCE_LABELS[source]
}

const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export function dayLabel(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : DAY.format(at)
}

export function noteCount(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`
}

/** Adding text Ego already has returns the existing note, so it moves to the top instead of appearing twice. */
export function putFirst(memories: readonly AgentMemory[], memory: AgentMemory): AgentMemory[] {
  return [memory, ...memories.filter((item) => item.id !== memory.id)]
}

/** `agent` names the pinned Agent chat; anything else is a chat id. */
export function findChat(chats: readonly AssistantChat[], wanted: string): AssistantChat | null {
  return chats.find((chat) => wanted === 'agent' ? chat.kind === 'agent' : chat.id === wanted) ?? null
}

/** What the AI screen opens when nothing is asked for: the latest chat of the user's own. */
export function defaultChat(chats: readonly AssistantChat[]): AssistantChat | null {
  return chats.find((chat) => chat.kind !== 'agent') ?? null
}

/** Moves a chat to the top of the list, below the Agent chat, which stays pinned first. */
export function putChatFirst(chats: readonly AssistantChat[], chat: AssistantChat): AssistantChat[] {
  const rest = chats.filter((item) => item.id !== chat.id)
  if (chat.kind === 'agent') return [chat, ...rest]
  return [...rest.filter((item) => item.kind === 'agent'), chat, ...rest.filter((item) => item.kind !== 'agent')]
}

export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    return null
  }
}

export const TRIGGER_TYPE_LABELS: Record<AgentTriggerType, string> = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  interval: 'Every N hours',
  once: 'Once',
  manual: 'Only when asked'
}

/** 1 is Monday, as in a weekly trigger. */
export const WEEKDAY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'
].map((label, index) => ({ value: index + 1, label }))

/** The When picker keeps every field, so switching the type back and forth loses nothing. */
export interface TriggerDraft {
  type: AgentTriggerType
  time: string
  weekday: number
  hours: string
  date: string
}

export function draftFromTrigger(trigger: AgentTrigger, today: string): TriggerDraft {
  const draft: TriggerDraft = { type: trigger.type, time: '07:00', weekday: 1, hours: '4', date: today }
  switch (trigger.type) {
    case 'daily':
    case 'weekdays': return { ...draft, time: trigger.time }
    case 'weekly': return { ...draft, time: trigger.time, weekday: trigger.weekday }
    case 'interval': return { ...draft, hours: String(trigger.hours) }
    case 'once': return { ...draft, date: trigger.date, time: trigger.time }
    case 'manual': return draft
  }
}

function triggerOf(draft: TriggerDraft): AgentTrigger {
  switch (draft.type) {
    case 'daily':
    case 'weekdays': return { type: draft.type, time: draft.time }
    case 'weekly': return { type: 'weekly', weekday: draft.weekday, time: draft.time }
    case 'interval': return { type: 'interval', hours: draft.hours.trim() === '' ? Number.NaN : Number(draft.hours) }
    case 'once': return { type: 'once', date: draft.date, time: draft.time }
    case 'manual': return { type: 'manual' }
  }
}

/** The trigger the picker describes, or what to fix in it. */
export function triggerFromDraft(draft: TriggerDraft): AgentTrigger | string {
  const trigger = triggerOf(draft)
  if (isAgentTrigger(trigger)) return trigger
  if (draft.type === 'interval') return 'Pick a whole number of hours from 1 to 168'
  if (draft.type === 'once' && !draft.date) return 'Pick a date'
  return 'Pick a time'
}

const GOAL_STATUS_LABELS: Record<AgentGoalStatus, string> = { active: 'Active', paused: 'Paused', done: 'Done' }

export function goalStatusLabel(status: AgentGoalStatus): string {
  return GOAL_STATUS_LABELS[status]
}

const RUN_STATUS_LABELS: Record<AgentRunStatus, string> = { queued: 'Waiting', running: 'Running', succeeded: 'Done', failed: 'Failed' }
const RUN_REASON_LABELS: Record<AgentRunReason, string> = { schedule: 'On schedule', now: 'Run now', delegate: 'Asked in chat', event: 'From an event' }

export function runStatusLabel(status: AgentRunStatus): string {
  return RUN_STATUS_LABELS[status]
}

export function runReasonLabel(reason: AgentRunReason): string {
  return RUN_REASON_LABELS[reason]
}

/** The latest thing that happened to a run. */
export function runTime(run: AgentRun): string {
  return run.finishedAt ?? run.startedAt ?? run.firedAt ?? run.createdAt
}

export function fireMessage(result: AgentFireResult): string {
  if (result.fired) return 'The agent is on it'
  return result.error ?? 'No goals are due right now'
}

function startOfDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()
}

const DATE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** "Today at 7:00", "Tomorrow at 18:30", or "Sun, Oct 11 at 10:00" on this device's clock. */
export function momentLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : DATE.format(at)
  return `${day} at ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** The same moment in the middle of a sentence: "Expires tomorrow at 9:00". */
export function momentInSentence(iso: string, now: Date = new Date()): string {
  return momentLabel(iso, now).replace(/^(Today|Tomorrow|Yesterday)\b/, (word) => word.toLowerCase())
}

/** Goals and delegation change what the agent does next, so they always wait for Confirm. */
const NEVER_TRUSTED: ReadonlySet<AssistantToolName> = new Set(['create_goal', 'update_goal', 'delegate_task'])

const TRUST_LABELS: Partial<Record<AssistantToolName, string>> = {
  record_transactions: 'Record money',
  save_mood: 'Save mood entries',
  log_habit: 'Check off habits',
  unlog_habit: 'Uncheck habits',
  log_gym_sets: 'Log gym sets',
  mark_study: 'Check off assignments',
  add_task_card: 'Add task cards',
  update_task_card: 'Change task cards',
  log_food: 'Log food',
  add_fridge_items: 'Add to the fridge',
  remove_fridge_items: 'Take from the fridge',
  set_food_targets: 'Set food targets',
  add_calendar_event: 'Add calendar events',
  update_calendar_event: 'Change calendar events',
  delete_calendar_event: 'Delete calendar events',
  answer_calendar_event: 'Answer invitations'
}

export interface TrustOption {
  name: AssistantToolName
  label: string
}

/** Every write tool the agent may be trusted with, in the order the tools are defined. */
export function trustOptions(): TrustOption[] {
  return Object.values(ASSISTANT_TOOLS)
    .filter((tool) => tool.access === 'write' && !NEVER_TRUSTED.has(tool.name))
    .map((tool) => ({ name: tool.name, label: TRUST_LABELS[tool.name] ?? tool.name.replace(/_/g, ' ') }))
}

/** Turns one tool on or off and keeps anything else in the list as it was. */
export function withTrust(trusted: readonly string[], name: string, on: boolean): string[] {
  const rest = trusted.filter((item) => item !== name)
  return on ? [...rest, name] : rest
}
