import { describe, expect, it } from 'vitest'
import type { HabitEntryKind } from '@ego/core'
import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import {
  buildLog, dayScore, habitRates, heatLevel, monthDates, monthSummary, mondayOf, quitStats, streaks, weekDates
} from '../lib/habits/stats'

const AT = '2026-09-01T12:00:00.000Z'

const habit = (id: string, overrides: Partial<HabitRecord> = {}): HabitRecord => ({
  id, name: id, icon: '✅', kind: 'build', startDate: '2026-09-01', position: 0,
  createdAt: AT, updatedAt: AT, revision: 1, ...overrides
})

let sequence = 0
const entry = (habitId: string, date: string, kind: HabitEntryKind = 'done'): HabitEntryRecord => {
  sequence += 1
  return { id: `he-${sequence}`, habitId, date, kind, createdAt: AT, updatedAt: AT, revision: 1 }
}

describe('habit progress', () => {
  const read = habit('read')
  const walk = habit('walk', { startDate: '2026-09-10' })
  const smoke = habit('smoke', { kind: 'break' })

  it('counts only habits to build that had started by that day', () => {
    const log = buildLog([entry('read', '2026-09-05'), entry('read', '2026-09-12'), entry('walk', '2026-09-12')])
    expect(dayScore([read, walk, smoke], log, '2026-09-05')).toEqual({ date: '2026-09-05', done: 1, total: 1 })
    expect(dayScore([read, walk, smoke], log, '2026-09-11')).toEqual({ date: '2026-09-11', done: 0, total: 2 })
    expect(dayScore([read, walk, smoke], log, '2026-09-12')).toEqual({ date: '2026-09-12', done: 2, total: 2 })
  })

  it('reserves the brightest shade for a finished day', () => {
    expect([
      heatLevel({ done: 0, total: 3 }), heatLevel({ done: 1, total: 3 }), heatLevel({ done: 2, total: 3 }),
      heatLevel({ done: 3, total: 4 }), heatLevel({ done: 4, total: 4 }), heatLevel({ done: 0, total: 0 })
    ]).toEqual([0, 1, 2, 3, 4, 0])
  })

  it('sums a month up to today and can narrow it to one habit', () => {
    const log = buildLog([entry('read', '2026-09-10'), entry('walk', '2026-09-10'), entry('read', '2026-09-11')])
    const all = monthSummary([read, walk], log, '2026-09', '2026-09-11')
    expect(all.days).toHaveLength(30)
    expect(all.days[20]).toEqual({ date: '2026-09-21', done: 0, total: 0 })
    expect({ done: all.done, possible: all.possible }).toEqual({ done: 3, possible: 13 })
    const walking = monthSummary([read, walk], log, '2026-09', '2026-09-11', 'walk')
    expect({ done: walking.done, possible: walking.possible }).toEqual({ done: 1, possible: 2 })
    expect(habitRates([read, walk, smoke], log, '2026-09', '2026-09-11').map((rate) => [rate.habit.id, rate.done, rate.possible]))
      .toEqual([['read', 2, 11], ['walk', 1, 2]])
  })

  it('keeps the current streak open until today is finished', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-06']
    const log = buildLog(days.map((date) => entry('read', date)))
    expect(streaks([read], log, '2026-09-07')).toEqual({ current: 3, best: 3 })
    expect(streaks([read], buildLog([...days, '2026-09-07'].map((date) => entry('read', date))), '2026-09-07'))
      .toEqual({ current: 4, best: 4 })
    expect(streaks([read], log, '2026-09-08')).toEqual({ current: 0, best: 3 })
  })

  it('needs every habit done for a day to join a streak', () => {
    const log = buildLog([entry('read', '2026-09-10'), entry('walk', '2026-09-10'), entry('read', '2026-09-11')])
    expect(streaks([read, walk], log, '2026-09-11')).toEqual({ current: 1, best: 1 })
  })

  it('lays weeks out from Monday and months by their own length', () => {
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
    expect(mondayOf('2026-10-04')).toBe('2026-09-28')
    expect(weekDates('2026-10-01')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'
    ])
    expect(monthDates('2028-02')).toHaveLength(29)
  })
})

describe('habits to break', () => {
  const smoke = habit('smoke', { kind: 'break', startDate: '2026-08-01' })

  it('counts clean days from the start date when nothing has slipped', () => {
    const stats = quitStats(smoke, buildLog([entry('smoke', '2026-09-20', 'resisted')]), '2026-09-28')
    expect(stats).toMatchObject({ cleanSince: '2026-08-01', lastSlip: null, cleanDays: 58, bestDays: 58, resisted: 1, resistedThisMonth: 1 })
  })

  it('restarts the count at the last slip and remembers the best run', () => {
    const log = buildLog([
      entry('smoke', '2026-08-31', 'slipped'), entry('smoke', '2026-09-25', 'slipped'),
      entry('smoke', '2026-09-25', 'slipped'), entry('smoke', '2026-09-26', 'resisted'),
      entry('smoke', '2026-08-15', 'resisted')
    ])
    expect(quitStats(smoke, log, '2026-09-28')).toEqual({
      cleanSince: '2026-09-25', lastSlip: '2026-09-25', cleanDays: 3, bestDays: 30,
      resisted: 2, resistedThisMonth: 1, slips: 3, slipsThisMonth: 2
    })
  })

  it('ignores slips from before a later start date', () => {
    const fresh = { ...smoke, startDate: '2026-09-20' }
    const log = buildLog([entry('smoke', '2026-09-10', 'slipped')])
    expect(quitStats(fresh, log, '2026-09-28')).toMatchObject({ cleanSince: '2026-09-20', lastSlip: null, cleanDays: 8, slips: 1 })
  })

  it('shows zero days clean on the day of a slip', () => {
    const log = buildLog([entry('smoke', '2026-09-28', 'slipped')])
    expect(quitStats(smoke, log, '2026-09-28')).toMatchObject({ cleanDays: 0, lastSlip: '2026-09-28', bestDays: 58 })
  })
})
