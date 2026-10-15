import type { HabitRecord } from '@ego/api-contracts'

export interface HabitMove {
  /** Every habit, in the order the local database returns them. */
  habits: HabitRecord[]
  /** The habits whose position changed, already carrying the new one. */
  changed: HabitRecord[]
}

/**
 * Puts a habit at `to` among the habits of its kind and numbers that kind from zero, so two habits
 * that shared a position still end up in order. Null when the habit stays where it is.
 */
export function moveHabit(habits: readonly HabitRecord[], id: string, to: number): HabitMove | null {
  const habit = habits.find((item) => item.id === id)
  if (!habit) return null
  const siblings = habits.filter((item) => item.kind === habit.kind)
  const from = siblings.indexOf(habit)
  if (to === from || to < 0 || to >= siblings.length) return null
  const order = siblings.filter((item) => item.id !== id)
  order.splice(to, 0, habit)
  const changed = order.flatMap((item, position) => item.position === position ? [] : [{ ...item, position }])
  const next = habits.map((item) => changed.find((moved) => moved.id === item.id) ?? item)
  next.sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt))
  return { habits: next, changed }
}

/**
 * Home leaves out habits that start after the day it shows. A habit dropped at `index` among the
 * `shown` ones, not counting itself, goes right before the shown habit now at that index, or right
 * after the last shown one. Returns its index among `all` of its kind.
 */
export function shownIndexToAll(all: readonly HabitRecord[], shown: readonly HabitRecord[], id: string, index: number): number {
  const rest = all.filter((item) => item.id !== id)
  const others = shown.filter((item) => item.id !== id)
  const at = (habit: HabitRecord): number => rest.findIndex((item) => item.id === habit.id)
  const before = others[index]
  if (before) return at(before)
  const last = others[others.length - 1]
  return last ? at(last) + 1 : 0
}
