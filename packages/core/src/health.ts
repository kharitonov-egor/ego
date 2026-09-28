import { isDateString } from './money'

/** 1 is the worst day and 5 the best. */
export type MoodLevel = 1 | 2 | 3 | 4 | 5

export const MOOD_LEVELS: readonly MoodLevel[] = [1, 2, 3, 4, 5]
export const MOOD_NOTE_LIMIT = 2000

/** One entry per day, keyed by its date the way a budget is keyed by its month. */
export interface MoodEntry {
  id: string
  date: string
  mood: MoodLevel
  note: string
  createdAt: string
  updatedAt: string
}

export interface MoodInput {
  date: string
  mood: MoodLevel
  note: string
}

export function isMoodLevel(value: unknown): value is MoodLevel {
  return typeof value === 'number' && MOOD_LEVELS.includes(value as MoodLevel)
}

export function isMoodInput(value: unknown): value is MoodInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record: Record<string, unknown> = { ...value }
  return typeof record.date === 'string' && isDateString(record.date) &&
    isMoodLevel(record.mood) &&
    typeof record.note === 'string' && record.note.length <= MOOD_NOTE_LIMIT
}
