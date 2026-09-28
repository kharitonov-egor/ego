import { isDateString } from './money'

/** A habit to build is checked off day by day; a habit to break counts clean days and logs slips. */
export type HabitKind = 'build' | 'break'

/** `done` belongs to a habit to build; `resisted` and `slipped` to a habit to break. */
export type HabitEntryKind = 'done' | 'resisted' | 'slipped'

export const HABIT_NAME_LIMIT = 60
/** Room for one emoji built from several code points, like a flag or a family. */
export const HABIT_ICON_LIMIT = 16

export interface HabitInput {
  name: string
  icon: string
  kind: HabitKind
  /** The first day a habit to build counts toward progress, or the day a habit to break went clean. */
  startDate: string
  position: number
}

export interface Habit extends HabitInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface HabitEntryInput {
  habitId: string
  date: string
  kind: HabitEntryKind
}

export interface HabitEntry extends HabitEntryInput {
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

export function isHabitEntryKind(value: unknown): value is HabitEntryKind {
  return value === 'done' || value === 'resisted' || value === 'slipped'
}

export function entryKindFits(habit: HabitKind, entry: HabitEntryKind): boolean {
  return habit === 'build' ? entry === 'done' : entry !== 'done'
}

export function isHabitInput(value: unknown): value is HabitInput {
  return isRecord(value) &&
    typeof value.name === 'string' && value.name.trim().length > 0 && value.name.trim().length <= HABIT_NAME_LIMIT &&
    typeof value.icon === 'string' && value.icon.trim().length > 0 && value.icon.trim().length <= HABIT_ICON_LIMIT &&
    isHabitKind(value.kind) &&
    typeof value.startDate === 'string' && isDateString(value.startDate) &&
    Number.isSafeInteger(value.position) && Number(value.position) >= 0 && Number(value.position) <= 10000
}

export function isHabitEntryInput(value: unknown): value is HabitEntryInput {
  return isRecord(value) &&
    typeof value.habitId === 'string' && value.habitId.length > 0 && value.habitId.length <= 64 &&
    typeof value.date === 'string' && isDateString(value.date) &&
    isHabitEntryKind(value.kind)
}
