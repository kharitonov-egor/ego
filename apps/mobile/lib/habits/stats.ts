import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import { isoFromParts, parseIso, shiftIso } from '../dates'

export interface HabitLog {
  /** How many times each habit was checked off, by day. */
  done: Map<string, Map<string, number>>
  /** Each habit's slips, oldest first. */
  slips: Map<string, HabitEntryRecord[]>
}

export interface DayScore {
  date: string
  /** Habits that met the day's target. */
  done: number
  total: number
  /** `done` with partial credit, so two of four glasses of water counts as half. */
  partial: number
}

export interface RowState {
  /** Check-offs on the day itself. */
  today: number
  /** Check-offs on the day, or for a weekly habit the days checked off that week. */
  progress: number
  target: number
  met: boolean
}

export type StreakUnit = 'day' | 'week'

export interface Streaks {
  current: number
  best: number
  unit: StreakUnit
}

export interface HabitRate {
  habit: HabitRecord
  done: number
  possible: number
  unit: StreakUnit
}

export interface MonthSummary {
  days: DayScore[]
  /** Daily targets met on each day plus weekly targets met in each week. */
  done: number
  possible: number
}

export interface QuitClock {
  /** When the current run began, in epoch milliseconds. */
  since: number
  /** The run began with a restart, not the quit itself. */
  restarted: boolean
  /** The longest run that has already ended, in milliseconds. */
  bestEnded: number
}

export interface Duration {
  days: number
  hours: number
  minutes: number
  seconds: number
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export function buildLog(entries: readonly HabitEntryRecord[]): HabitLog {
  const done = new Map<string, Map<string, number>>()
  const slips = new Map<string, HabitEntryRecord[]>()
  for (const entry of entries) {
    if (entry.kind === 'done') {
      const day = done.get(entry.date) ?? new Map<string, number>()
      day.set(entry.habitId, (day.get(entry.habitId) ?? 0) + 1)
      done.set(entry.date, day)
    } else if (entry.kind === 'slipped') {
      const list = slips.get(entry.habitId) ?? []
      list.push(entry)
      slips.set(entry.habitId, list)
    }
  }
  for (const list of slips.values()) list.sort((left, right) => loggedTime(left) - loggedTime(right))
  return { done, slips }
}

export function doneCount(log: HabitLog, habitId: string, date: string): number {
  return log.done.get(date)?.get(habitId) ?? 0
}

export function mondayOf(date: string): string {
  return shiftIso(date, -((parseIso(date).getDay() + 6) % 7))
}

export function weekDates(date: string): string[] {
  const monday = mondayOf(date)
  return Array.from({ length: 7 }, (_, index) => shiftIso(monday, index))
}

/** Days of the Monday-to-Sunday week around `date` with at least one check-off. */
export function weekCount(log: HabitLog, habitId: string, date: string): number {
  return weekDates(date).filter((day) => doneCount(log, habitId, day) > 0).length
}

export function rowState(habit: HabitRecord, log: HabitLog, date: string): RowState {
  const today = doneCount(log, habit.id, date)
  const progress = habit.period === 'week' ? weekCount(log, habit.id, date) : today
  return { today, progress, target: habit.target, met: progress >= habit.target }
}

function isBuilding(habit: HabitRecord): boolean {
  return habit.kind === 'build'
}

/**
 * A daily habit is due every day from its start date. A weekly one only counts on a day it was
 * done, so it can brighten a day but never leave one unfinished.
 */
export function dayScore(habits: readonly HabitRecord[], log: HabitLog, date: string): DayScore {
  let done = 0
  let total = 0
  let partial = 0
  for (const habit of habits) {
    if (!isBuilding(habit) || habit.startDate > date) continue
    const count = doneCount(log, habit.id, date)
    if (habit.period === 'week') {
      if (count === 0) continue
      total += 1
      done += 1
      partial += 1
      continue
    }
    total += 1
    if (count >= habit.target) done += 1
    partial += Math.min(count, habit.target) / habit.target
  }
  return { date, done, total, partial }
}

/** Only a day with everything done reaches the brightest step. */
export function heatLevel(score: Pick<DayScore, 'done' | 'total' | 'partial'>): HeatLevel {
  if (score.total === 0 || score.partial === 0) return 0
  if (score.done >= score.total) return 4
  const share = score.partial / score.total
  return share <= 1 / 3 ? 1 : share <= 2 / 3 ? 2 : 3
}

export function monthDates(month: string): string[] {
  const [year, index] = month.split('-').map(Number)
  const length = new Date(year, index, 0).getDate()
  return Array.from({ length }, (_, day) => `${month}-${String(day + 1).padStart(2, '0')}`)
}

/** A week belongs to the month its Thursday falls in, the ISO rule, so no week counts twice. */
export function monthWeeks(month: string): string[] {
  const weeks: string[] = []
  const dates = monthDates(month)
  const last = dates[dates.length - 1]
  for (let monday = mondayOf(`${month}-01`); monday <= last; monday = shiftIso(monday, 7)) {
    if (shiftIso(monday, 3).startsWith(month)) weeks.push(monday)
  }
  return weeks
}

/**
 * Whether a week counts toward a weekly habit's record. The current week stays open until it is
 * met, and the week the habit started only counts once it is met.
 */
function weekVerdict(habit: HabitRecord, log: HabitLog, monday: string, today: string): 'met' | 'missed' | 'open' {
  const sunday = shiftIso(monday, 6)
  if (monday > today || habit.startDate > sunday) return 'open'
  if (weekCount(log, habit.id, monday) >= habit.target) return 'met'
  return sunday < today && habit.startDate <= monday ? 'missed' : 'open'
}

/** With `focus`, every number describes that one habit instead of the whole list. */
export function monthSummary(
  habits: readonly HabitRecord[], log: HabitLog, month: string, today: string, focus: string | null = null
): MonthSummary {
  const counted = habits.filter((habit) => isBuilding(habit) && (focus === null || habit.id === focus))
  const daily = counted.filter((habit) => habit.period === 'day')
  let done = 0
  let possible = 0
  const days = monthDates(month).map((date) => {
    if (date > today) return { date, done: 0, total: 0, partial: 0 }
    const dailyScore = dayScore(daily, log, date)
    done += dailyScore.done
    possible += dailyScore.total
    return dayScore(counted, log, date)
  })
  for (const habit of counted) {
    if (habit.period !== 'week') continue
    for (const monday of monthWeeks(month)) {
      const verdict = weekVerdict(habit, log, monday, today)
      if (verdict === 'open') continue
      possible += 1
      if (verdict === 'met') done += 1
    }
  }
  return { days, done, possible }
}

/**
 * Runs of days with every daily habit done. With no daily habits in the set, runs of weeks with
 * every weekly habit met. The current day or week stays open until it is finished.
 */
export function streaks(habits: readonly HabitRecord[], log: HabitLog, today: string): Streaks {
  const building = habits.filter(isBuilding)
  const daily = building.filter((habit) => habit.period === 'day' && habit.startDate <= today)
  if (daily.length > 0) {
    let run = 0
    let best = 0
    const first = daily.reduce((earliest, habit) => habit.startDate < earliest ? habit.startDate : earliest, today)
    for (let date = first; date <= today; date = shiftIso(date, 1)) {
      const score = dayScore(daily, log, date)
      if (score.total > 0 && score.done === score.total) {
        run += 1
        best = Math.max(best, run)
      } else if (date !== today) {
        run = 0
      }
    }
    return { current: run, best, unit: 'day' }
  }
  const weekly = building.filter((habit) => habit.period === 'week' && habit.startDate <= today)
  if (weekly.length === 0) return { current: 0, best: 0, unit: 'day' }
  let run = 0
  let best = 0
  const current = mondayOf(today)
  const first = mondayOf(weekly.reduce((earliest, habit) => habit.startDate < earliest ? habit.startDate : earliest, today))
  for (let monday = first; monday <= current; monday = shiftIso(monday, 7)) {
    const verdicts = weekly.map((habit) => weekVerdict(habit, log, monday, today))
    if (verdicts.every((verdict) => verdict === 'met')) {
      run += 1
      best = Math.max(best, run)
    } else if (monday !== current) {
      run = 0
    }
  }
  return { current: run, best, unit: 'week' }
}

export function habitRates(habits: readonly HabitRecord[], log: HabitLog, month: string, today: string): HabitRate[] {
  const dates = monthDates(month).filter((date) => date <= today)
  return habits.filter(isBuilding).map((habit) => {
    let done = 0
    let possible = 0
    if (habit.period === 'week') {
      for (const monday of monthWeeks(month)) {
        const verdict = weekVerdict(habit, log, monday, today)
        if (verdict === 'open') continue
        possible += 1
        if (verdict === 'met') done += 1
      }
      return { habit, done, possible, unit: 'week' }
    }
    for (const date of dates) {
      if (date < habit.startDate) continue
      possible += 1
      if (doneCount(log, habit.id, date) >= habit.target) done += 1
    }
    return { habit, done, possible, unit: 'day' }
  })
}

function loggedTime(entry: HabitEntryRecord): number {
  return Date.parse(entry.loggedAt ?? entry.createdAt)
}

function localDate(timestamp: string): string {
  const moment = new Date(timestamp)
  return isoFromParts(moment.getFullYear(), moment.getMonth(), moment.getDate())
}

/**
 * The moment a habit to break was quit. Habits saved before exact times fall back to the moment
 * they were added when that was the start date, and to midnight on the start date otherwise.
 */
export function quitStart(habit: HabitRecord): number {
  if (habit.startedAt) return Date.parse(habit.startedAt)
  if (localDate(habit.createdAt) === habit.startDate) return Date.parse(habit.createdAt)
  return parseIso(habit.startDate).getTime()
}

/** Restarts from before the quit moment are history only; moving the quit later is a fresh start. */
export function quitClock(habit: HabitRecord, log: HabitLog): QuitClock {
  const start = quitStart(habit)
  let since = start
  let bestEnded = 0
  for (const slip of log.slips.get(habit.id) ?? []) {
    const at = loggedTime(slip)
    if (at < start) continue
    bestEnded = Math.max(bestEnded, at - since)
    since = at
  }
  return { since, restarted: since !== start, bestEnded }
}

export function splitDuration(milliseconds: number): Duration {
  const total = Math.max(0, Math.floor(milliseconds / 1000))
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60
  }
}
