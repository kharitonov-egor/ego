import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import { parseIso, shiftIso } from '../dates'
import { daysBetween } from '../periods'

export interface HabitLog {
  /** Each day's finished habits. */
  done: Map<string, Set<string>>
  /** Each habit's resisted urges and slips, oldest first. */
  events: Map<string, HabitEntryRecord[]>
}

export interface DayScore {
  date: string
  done: number
  total: number
}

export interface Streaks {
  current: number
  best: number
}

export interface HabitRate {
  habit: HabitRecord
  done: number
  possible: number
}

export interface MonthSummary {
  days: DayScore[]
  done: number
  possible: number
}

export interface QuitStats {
  /** The last slip, or the start date when there has been none since. */
  cleanSince: string
  /** The latest slip on or after the start date. */
  lastSlip: string | null
  cleanDays: number
  bestDays: number
  resisted: number
  resistedThisMonth: number
  slips: number
  slipsThisMonth: number
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export function buildLog(entries: readonly HabitEntryRecord[]): HabitLog {
  const done = new Map<string, Set<string>>()
  const events = new Map<string, HabitEntryRecord[]>()
  for (const entry of entries) {
    if (entry.kind === 'done') {
      const day = done.get(entry.date) ?? new Set<string>()
      day.add(entry.habitId)
      done.set(entry.date, day)
      continue
    }
    const list = events.get(entry.habitId) ?? []
    list.push(entry)
    events.set(entry.habitId, list)
  }
  for (const list of events.values()) {
    list.sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt))
  }
  return { done, events }
}

export function isDone(log: HabitLog, habitId: string, date: string): boolean {
  return log.done.get(date)?.has(habitId) ?? false
}

/** Every habit to build is due every day from its start date. */
export function dayScore(habits: readonly HabitRecord[], log: HabitLog, date: string): DayScore {
  const finished = log.done.get(date)
  let done = 0
  let total = 0
  for (const habit of habits) {
    if (habit.kind !== 'build' || habit.startDate > date) continue
    total += 1
    if (finished?.has(habit.id)) done += 1
  }
  return { date, done, total }
}

/** Only a day with everything done reaches the brightest step. */
export function heatLevel(score: Pick<DayScore, 'done' | 'total'>): HeatLevel {
  if (score.total === 0 || score.done === 0) return 0
  if (score.done >= score.total) return 4
  const share = score.done / score.total
  return share <= 1 / 3 ? 1 : share <= 2 / 3 ? 2 : 3
}

export function mondayOf(date: string): string {
  return shiftIso(date, -((parseIso(date).getDay() + 6) % 7))
}

export function weekDates(date: string): string[] {
  const monday = mondayOf(date)
  return Array.from({ length: 7 }, (_, index) => shiftIso(monday, index))
}

export function monthDates(month: string): string[] {
  const [year, index] = month.split('-').map(Number)
  const length = new Date(year, index, 0).getDate()
  return Array.from({ length }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`)
}

/** With `focus`, every number describes that one habit instead of the whole list. */
export function monthSummary(
  habits: readonly HabitRecord[], log: HabitLog, month: string, today: string, focus: string | null = null
): MonthSummary {
  const counted = focus ? habits.filter((habit) => habit.id === focus) : habits
  let done = 0
  let possible = 0
  const days = monthDates(month).map((date) => {
    if (date > today) return { date, done: 0, total: 0 }
    const score = dayScore(counted, log, date)
    done += score.done
    possible += score.total
    return score
  })
  return { days, done, possible }
}

/**
 * Runs of days where every habit due was done. Today stays open until it is finished, so an
 * unfinished today neither extends nor breaks the current run.
 */
export function streaks(habits: readonly HabitRecord[], log: HabitLog, today: string): Streaks {
  const counted = habits.filter((habit) => habit.kind === 'build' && habit.startDate <= today)
  if (counted.length === 0) return { current: 0, best: 0 }
  const first = counted.reduce((earliest, habit) => habit.startDate < earliest ? habit.startDate : earliest, today)
  let run = 0
  let best = 0
  for (let date = first; date <= today; date = shiftIso(date, 1)) {
    const score = dayScore(counted, log, date)
    if (score.total > 0 && score.done === score.total) {
      run += 1
      best = Math.max(best, run)
    } else if (date !== today) {
      run = 0
    }
  }
  return { current: run, best }
}

export function habitRates(habits: readonly HabitRecord[], log: HabitLog, month: string, today: string): HabitRate[] {
  const dates = monthDates(month).filter((date) => date <= today)
  return habits.filter((habit) => habit.kind === 'build').map((habit) => {
    let done = 0
    let possible = 0
    for (const date of dates) {
      if (date < habit.startDate) continue
      possible += 1
      if (isDone(log, habit.id, date)) done += 1
    }
    return { habit, done, possible }
  })
}

/** Slips before the start date are history only; moving the start date later is a fresh start. */
export function quitStats(habit: HabitRecord, log: HabitLog, today: string): QuitStats {
  const events = log.events.get(habit.id) ?? []
  const month = today.slice(0, 7)
  const slipDays = [...new Set(events
    .filter((event) => event.kind === 'slipped' && event.date >= habit.startDate && event.date <= today)
    .map((event) => event.date))].sort()
  let cleanSince = habit.startDate
  let bestDays = 0
  for (const day of slipDays) {
    bestDays = Math.max(bestDays, daysBetween(cleanSince, day))
    cleanSince = day
  }
  const cleanDays = Math.max(0, daysBetween(cleanSince, today))
  let resisted = 0
  let resistedThisMonth = 0
  let slips = 0
  let slipsThisMonth = 0
  for (const event of events) {
    const thisMonth = event.date.startsWith(month)
    if (event.kind === 'resisted') {
      resisted += 1
      if (thisMonth) resistedThisMonth += 1
    } else {
      slips += 1
      if (thisMonth) slipsThisMonth += 1
    }
  }
  return {
    cleanSince, lastSlip: slipDays[slipDays.length - 1] ?? null, cleanDays, bestDays: Math.max(bestDays, cleanDays),
    resisted, resistedThisMonth, slips, slipsThisMonth
  }
}
