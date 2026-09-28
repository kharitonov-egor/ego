import { isDateString } from './money'

/** A habit to build is checked off day by day; a habit to break counts clean days and logs slips. */
export type HabitKind = 'build' | 'break'

/** `done` belongs to a habit to build; `resisted` and `slipped` to a habit to break. */
export type HabitEntryKind = 'done' | 'resisted' | 'slipped'

/**
 * A daily habit needs `target` check-offs every day. A weekly one needs `target` different days
 * checked off between Monday and Sunday.
 */
export type HabitPeriod = 'day' | 'week'

export const HABIT_NAME_LIMIT = 60
/** Room for one emoji built from several code points, like a flag or a family. */
export const HABIT_ICON_LIMIT = 16
export const HABIT_TARGET_LIMIT: Record<HabitPeriod, number> = { day: 10, week: 6 }

export interface HabitInput {
  name: string
  icon: string
  kind: HabitKind
  /** The first day a habit to build counts toward progress, or the day a habit to break went clean. */
  startDate: string
  position: number
  /** Builds from before targets leave this out, which means once. */
  target?: number
  /** Builds from before targets leave this out, which means daily. */
  period?: HabitPeriod
  /**
   * The moment a habit to break was quit, as an ISO timestamp. Null means midnight on the start
   * date, or the moment it was added when that is the same day.
   */
  startedAt?: string | null
}

export interface Habit extends Required<HabitInput> {
  id: string
  createdAt: string
  updatedAt: string
}

export interface HabitEntryInput {
  habitId: string
  date: string
  kind: HabitEntryKind
  /** When the phone logged it. The server's own time is the delivery, which can be much later. */
  loggedAt?: string | null
}

export interface HabitEntry extends Required<HabitEntryInput> {
  id: string
  createdAt: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isHabitKind(value: unknown): value is HabitKind {
  return value === 'build' || value === 'break'
}

export function isHabitPeriod(value: unknown): value is HabitPeriod {
  return value === 'day' || value === 'week'
}

export function isHabitEntryKind(value: unknown): value is HabitEntryKind {
  return value === 'done' || value === 'resisted' || value === 'slipped'
}

export function entryKindFits(habit: HabitKind, entry: HabitEntryKind): boolean {
  return habit === 'build' ? entry === 'done' : entry !== 'done'
}

function isTimestamp(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === 'string' && value.length > 0 && value.length <= 40 && !Number.isNaN(Date.parse(value)))
}

function isTarget(target: unknown, period: unknown): boolean {
  if (target === undefined) return true
  const limit = HABIT_TARGET_LIMIT[isHabitPeriod(period) ? period : 'day']
  return Number.isSafeInteger(target) && Number(target) >= 1 && Number(target) <= limit
}

export function isHabitInput(value: unknown): value is HabitInput {
  return isRecord(value) &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.trim().length <= HABIT_NAME_LIMIT &&
    typeof value.icon === 'string' && value.icon.trim().length > 0 && value.icon.trim().length <= HABIT_ICON_LIMIT &&
    isHabitKind(value.kind) &&
    typeof value.startDate === 'string' && isDateString(value.startDate) &&
    Number.isSafeInteger(value.position) && Number(value.position) >= 0 && Number(value.position) <= 10000 &&
    (value.period === undefined || isHabitPeriod(value.period)) &&
    isTarget(value.target, value.period) &&
    isTimestamp(value.startedAt)
}

export function isHabitEntryInput(value: unknown): value is HabitEntryInput {
  return isRecord(value) &&
    typeof value.habitId === 'string' && value.habitId.length > 0 && value.habitId.length <= 64 &&
    typeof value.date === 'string' && isDateString(value.date) &&
    isHabitEntryKind(value.kind) &&
    isTimestamp(value.loggedAt)
}
