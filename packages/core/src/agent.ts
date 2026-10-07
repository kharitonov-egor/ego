import type { AssistantToolName } from './assistant-tools'

/** When a standing goal runs. Times are the user's clock in the goal's time zone. */
export type AgentTrigger =
  | { type: 'daily'; time: string }
  | { type: 'weekdays'; time: string }
  /** `weekday` is 1 for Monday through 7 for Sunday. */
  | { type: 'weekly'; weekday: number; time: string }
  | { type: 'interval'; hours: number }
  | { type: 'once'; date: string; time: string }
  | { type: 'manual' }

export type AgentTriggerType = AgentTrigger['type']
export const AGENT_TRIGGER_TYPES: readonly AgentTriggerType[] = ['daily', 'weekdays', 'weekly', 'interval', 'once', 'manual']

/** The flat shape tools send, since their schemas cannot branch. Fields a type does not use are null. */
export interface AgentTriggerInput {
  type: AgentTriggerType
  time: string | null
  weekday: number | null
  hours: number | null
  date: string | null
}

export interface AgentDevices {
  phone: boolean
  desktop: boolean
  web: boolean
}

export interface AgentSettings {
  /** HH:MM. Notifications wait until quietEnd unless a message is urgent. */
  quietStart: string
  quietEnd: string
  /** Notifications a day before the rest arrive silently in the Agent chat. */
  dailyCap: number
  devices: AgentDevices
  /** Days a proposal waits for Confirm before it expires. */
  proposalDays: number
  /** Write tools the agent may use without a card. */
  trusted: string[]
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function isClock(value: unknown): value is string {
  return typeof value === 'string' && CLOCK.test(value)
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

export function isAgentTrigger(value: unknown): value is AgentTrigger {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'daily':
    case 'weekdays': return isClock(value.time)
    case 'weekly': return isClock(value.time) && isInteger(value.weekday, 1, 7)
    case 'interval': return isInteger(value.hours, 1, 168)
    case 'once': return isClock(value.time) && typeof value.date === 'string' && DATE.test(value.date)
    case 'manual': return true
    default: return false
  }
}

/** The trigger a flat tool input describes, or a sentence saying what is missing. */
export function triggerFromInput(input: AgentTriggerInput): AgentTrigger | string {
  const time = input.time ?? ''
  switch (input.type) {
    case 'daily':
    case 'weekdays':
      return isClock(time) ? { type: input.type, time } : 'A daily goal needs time as HH:MM'
    case 'weekly':
      if (!isClock(time)) return 'A weekly goal needs time as HH:MM'
      return isInteger(input.weekday, 1, 7) ? { type: 'weekly', weekday: input.weekday, time } : 'A weekly goal needs weekday from 1 (Monday) to 7 (Sunday)'
    case 'interval':
      return isInteger(input.hours, 1, 168) ? { type: 'interval', hours: input.hours } : 'An interval goal needs hours from 1 to 168'
    case 'once':
      if (!isClock(time)) return 'A one-off goal needs time as HH:MM'
      return input.date && DATE.test(input.date) ? { type: 'once', date: input.date, time } : 'A one-off goal needs date as YYYY-MM-DD'
    case 'manual':
      return { type: 'manual' }
  }
}

export function isAgentSettings(value: unknown): value is AgentSettings {
  if (!isRecord(value) || !isRecord(value.devices)) return false
  const devices = value.devices
  return isClock(value.quietStart) && isClock(value.quietEnd) && isInteger(value.dailyCap, 0, 100) &&
    typeof devices.phone === 'boolean' && typeof devices.desktop === 'boolean' && typeof devices.web === 'boolean' &&
    isInteger(value.proposalDays, 1, 60) && Array.isArray(value.trusted) && value.trusted.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}


/** Goals with a set time run this early, so their message can wait on the phone for the minute. */
export const AGENT_EARLY_START_MINUTES = 30

/** What "trust small" covers: habits, task cards, and study marks. */
export const DEFAULT_TRUSTED_TOOLS: readonly AssistantToolName[] = [
  'log_habit', 'unlog_habit', 'add_task_card', 'update_task_card', 'mark_study'
]

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  quietStart: '22:00',
  quietEnd: '08:00',
  dailyCap: 6,
  devices: { phone: true, desktop: true, web: true },
  proposalDays: 7,
  trusted: [...DEFAULT_TRUSTED_TOOLS]
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MINUTE_MS = 60_000
const formatters = new Map<string, Intl.DateTimeFormat>()

export interface LocalMoment {
  date: string
  /** Minutes since local midnight. */
  minute: number
  /** 1 for Monday through 7 for Sunday. */
  weekday: number
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone)
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
    })
    formatters.set(timeZone, found)
  }
  return found
}

const SHORT_WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export function localMoment(ms: number, timeZone: string): LocalMoment {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: SHORT_WEEKDAYS[parts.weekday] ?? 1
  }
}

function offsetMinutes(ms: number, timeZone: string): number {
  const seen = localMoment(ms, timeZone)
  const asUtc = Date.parse(`${seen.date}T00:00:00Z`) + seen.minute * MINUTE_MS
  return Math.round((asUtc - Math.floor(ms / MINUTE_MS) * MINUTE_MS) / MINUTE_MS)
}

/**
 * The instant a local date and clock time happen in a time zone. A time a clock change skips
 * lands on the hour after it.
 */
export function zonedTime(date: string, time: string, timeZone: string): number {
  const guess = Date.parse(`${date}T${time}:00Z`)
  const first = guess - offsetMinutes(guess, timeZone) * MINUTE_MS
  return guess - offsetMinutes(first, timeZone) * MINUTE_MS
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function clockMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
}

function weekdayOf(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

/**
 * The next time a goal is due strictly after `afterMs`, as epoch milliseconds, or null when it
 * never runs on its own again. `lastRunMs` anchors interval goals.
 */
export function nextRunAt(trigger: AgentTrigger, afterMs: number, timeZone: string, lastRunMs: number | null = null): number | null {
  switch (trigger.type) {
    case 'manual':
      return null
    case 'interval': {
      const step = trigger.hours * 3_600_000
      if (lastRunMs === null) return afterMs + step
      const next = lastRunMs + step
      return next > afterMs ? next : afterMs + MINUTE_MS
    }
    case 'once': {
      const at = zonedTime(trigger.date, trigger.time, timeZone)
      return at > afterMs ? at : null
    }
    case 'daily':
    case 'weekdays':
    case 'weekly': {
      const start = localMoment(afterMs, timeZone).date
      for (let offset = 0; offset <= 8; offset += 1) {
        const date = addDays(start, offset)
        const weekday = weekdayOf(date)
        if (trigger.type === 'weekdays' && weekday > 5) continue
        if (trigger.type === 'weekly' && weekday !== trigger.weekday) continue
        const at = zonedTime(date, trigger.time, timeZone)
        if (at > afterMs) return at
      }
      return null
    }
  }
}

/** Goals with a set clock time start early; intervals and manual goals start when due. */
export function startsEarly(trigger: AgentTrigger): boolean {
  return trigger.type === 'daily' || trigger.type === 'weekdays' || trigger.type === 'weekly' || trigger.type === 'once'
}

function clockLabel(time: string): string {
  return `${Number(time.slice(0, 2))}:${time.slice(3, 5)}`
}

export function describeTrigger(trigger: AgentTrigger): string {
  switch (trigger.type) {
    case 'daily': return `Every day at ${clockLabel(trigger.time)}`
    case 'weekdays': return `Weekdays at ${clockLabel(trigger.time)}`
    case 'weekly': return `${WEEKDAYS[trigger.weekday - 1]}s at ${clockLabel(trigger.time)}`
    case 'interval': return trigger.hours === 1 ? 'Every hour' : `Every ${trigger.hours} hours`
    case 'once': {
      const day = new Date(`${trigger.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      return `Once on ${day} at ${clockLabel(trigger.time)}`
    }
    case 'manual': return 'Only when asked'
  }
}

/** Whether a local minute falls inside quiet hours, which may run past midnight. */
export function inQuietHours(minute: number, quietStart: string, quietEnd: string): boolean {
  const start = clockMinutes(quietStart)
  const end = clockMinutes(quietEnd)
  if (start === end) return false
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

export interface DeliveryInput {
  /** When the message should reach the user at the earliest. */
  requestedMs: number
  urgent: boolean
  muted: boolean
  /** Notifications already shown today, not counting silent ones. */
  shownToday: number
  settings: Pick<AgentSettings, 'quietStart' | 'quietEnd' | 'dailyCap'>
  timeZone: string
}

export interface DeliveryPlan {
  deliverMs: number
  silent: boolean
}

/**
 * When a notification shows and whether it makes a sound. Quiet hours push it to their end unless
 * it is urgent; past the daily cap, or for a muted goal, it is listed but never shown.
 */
export function planDelivery(input: DeliveryInput): DeliveryPlan {
  const silent = input.muted || (!input.urgent && input.shownToday >= input.settings.dailyCap)
  if (input.urgent) return { deliverMs: input.requestedMs, silent }
  const local = localMoment(input.requestedMs, input.timeZone)
  if (!inQuietHours(local.minute, input.settings.quietStart, input.settings.quietEnd)) return { deliverMs: input.requestedMs, silent }
  const end = clockMinutes(input.settings.quietEnd)
  const date = local.minute < end ? local.date : addDays(local.date, 1)
  return { deliverMs: zonedTime(date, input.settings.quietEnd, input.timeZone), silent }
}
