import type { LocalDatabase } from '../database/types'
import { shiftIso } from '../dates'
import { buildLog, dayScore, heatLevel, mondayOf, streaks, type HeatLevel, type Streaks } from '../habits/stats'
import { localHabitEntries, localHabits } from '../repositories/habits'
import { dueSentence, dueTime, dueWithin, isDone, isOverdue } from '../study/schedule'
import { cachedStudy } from '../study/store'
import { upcomingSections } from '../tasks/board'
import type { TaskData } from '../tasks/repository'

export const SPEND_DAYS = 14

export interface HabitsGlance {
  done: number
  total: number
  /** The last seven days, oldest first, today last. */
  week: HeatLevel[]
  streak: Streaks
}

export interface MoneyGlance {
  todayCents: number
  monthCents: number
  /** Spending on each of the last `SPEND_DAYS` days, oldest first. */
  days: number[]
}

export interface GymGlance {
  setsToday: number
  lastDate: string | null
  /** Monday first. */
  week: boolean[]
}

export interface HealthGlance {
  connected: boolean
  steps: number | null
  sleepMinutes: number | null
}

export interface StudyGlance {
  overdue: number
  week: number
  next: { title: string; due: string } | null
}

export interface TasksGlance {
  overdue: number
  today: number
  next: string | null
}

/** Each part is null when its read failed, so one broken table leaves the rest on screen. */
export interface LocalGlance {
  today: string
  habits: HabitsGlance | null
  money: MoneyGlance | null
  gym: GymGlance | null
  health: HealthGlance | null
  study: StudyGlance | null
  moodLogged: boolean | null
  diary: { lastAt: string | null } | null
}

async function habitsGlance(db: LocalDatabase, today: string): Promise<HabitsGlance> {
  const [habits, entries] = await Promise.all([localHabits(db), localHabitEntries(db)])
  const log = buildLog(entries)
  const score = dayScore(habits, log, today)
  return {
    done: score.done,
    total: score.total,
    week: Array.from({ length: 7 }, (_, index) => heatLevel(dayScore(habits, log, shiftIso(today, index - 6)))),
    streak: streaks(habits, log, today)
  }
}

async function moneyGlance(db: LocalDatabase, today: string): Promise<MoneyGlance> {
  const monthStart = `${today.slice(0, 7)}-01`
  const first = shiftIso(today, 1 - SPEND_DAYS)
  const rows = await db.all<{ date: string; cents: number }>(
    `SELECT date, SUM(amount_cents) AS cents FROM transactions
      WHERE kind = 'expense' AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY date`,
    [first < monthStart ? first : monthStart, today])
  const byDay = new Map(rows.map((row) => [row.date, row.cents]))
  return {
    todayCents: byDay.get(today) ?? 0,
    monthCents: rows.reduce((sum, row) => row.date >= monthStart ? sum + row.cents : sum, 0),
    days: Array.from({ length: SPEND_DAYS }, (_, index) => byDay.get(shiftIso(first, index)) ?? 0)
  }
}

async function gymGlance(db: LocalDatabase, today: string): Promise<GymGlance> {
  const monday = mondayOf(today)
  const [counts, days] = await Promise.all([
    db.all<{ sets: number; last: string | null }>(`SELECT
      (SELECT COUNT(*) FROM gym_sets WHERE deleted_at IS NULL AND date = ?) AS sets,
      (SELECT MAX(date) FROM gym_sets WHERE deleted_at IS NULL AND date <= ?) AS last`, [today, today]),
    db.all<{ date: string }>(
      'SELECT DISTINCT date FROM gym_sets WHERE deleted_at IS NULL AND date BETWEEN ? AND ?',
      [monday, shiftIso(monday, 6)])
  ])
  const trained = new Set(days.map((row) => row.date))
  return {
    setsToday: counts[0]?.sets ?? 0,
    lastDate: counts[0]?.last ?? null,
    week: Array.from({ length: 7 }, (_, index) => trained.has(shiftIso(monday, index)))
  }
}

async function healthGlance(db: LocalDatabase, today: string): Promise<HealthGlance> {
  const [state, day, sleep] = await Promise.all([
    db.all<{ connection: string | null }>('SELECT connection FROM health_state WHERE id = 1'),
    db.all<{ steps: number | null }>('SELECT steps FROM health_days WHERE date = ?', [today]),
    db.all<{ minutes: number }>(
      'SELECT minutes_asleep AS minutes FROM health_sleeps WHERE nap = 0 AND date = ? ORDER BY end_time DESC LIMIT 1',
      [today])
  ])
  return {
    connected: Boolean(state[0]?.connection),
    steps: day[0]?.steps ?? null,
    sleepMinutes: sleep[0]?.minutes ?? null
  }
}

async function studyGlance(db: LocalDatabase, now: Date): Promise<StudyGlance> {
  const { items } = await cachedStudy(db)
  const upcoming = items
    .filter((item) => !isDone(item) && dueTime(item) >= now.getTime())
    .sort((left, right) => dueTime(left) - dueTime(right))
  const next = upcoming[0]
  return {
    overdue: items.filter((item) => isOverdue(item, now)).length,
    week: dueWithin(items, now, 7),
    next: next ? { title: next.title, due: dueSentence(next) } : null
  }
}

async function moodLogged(db: LocalDatabase, today: string): Promise<boolean> {
  const rows = await db.all<{ count: number }>(
    'SELECT COUNT(*) AS count FROM mood_entries WHERE date = ? AND deleted_at IS NULL', [today])
  return (rows[0]?.count ?? 0) > 0
}

async function diaryGlance(db: LocalDatabase): Promise<{ lastAt: string | null }> {
  const rows = await db.all<{ last: string | null }>('SELECT MAX(sent_at) AS last FROM diary_messages WHERE deleted_at IS NULL')
  return { lastAt: rows[0]?.last ?? null }
}

function settle<T>(work: Promise<T>): Promise<T | null> {
  return work.catch(() => null)
}

export async function localGlance(db: LocalDatabase, today: string, now: Date): Promise<LocalGlance> {
  const [habits, money, gym, health, study, mood, diary] = await Promise.all([
    settle(habitsGlance(db, today)),
    settle(moneyGlance(db, today)),
    settle(gymGlance(db, today)),
    settle(healthGlance(db, today)),
    settle(studyGlance(db, now)),
    settle(moodLogged(db, today)),
    settle(diaryGlance(db))
  ])
  return { today, habits, money, gym, health, study, moodLogged: mood, diary }
}

export function tasksGlance(data: TaskData, now: Date): TasksGlance {
  const sections = upcomingSections(data, now)
  const overdue = sections.find((section) => section.key === 'overdue')?.data ?? []
  const today = sections.find((section) => section.key === 'today')?.data ?? []
  return {
    overdue: overdue.length,
    today: today.length,
    next: sections[0]?.data[0]?.title ?? null
  }
}
