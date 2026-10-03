import { describe, expect, it } from 'vitest'
import type { HabitEntryKind } from '@ego/core'
import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import {
  buildLog, dayScore, habitRates, heatLevel, monthDates, monthSummary, monthWeeks, mondayOf, quitClock, quitStart,
  rowState, splitDuration, streaks, weekDates
} from '../src/habits/stats'

const AT = '2026-09-01T12:00:00.000Z'
const HOUR = 60 * 60 * 1000

const habit = (id: string, overrides: Partial<HabitRecord> = {}): HabitRecord => ({
  id, name: id, icon: '✅', kind: 'build', startDate: '2026-09-01', position: 0, target: 1, period: 'day',
  startedAt: null, createdAt: AT, updatedAt: AT, revision: 1, ...overrides
})

let sequence = 0
const entry = (habitId: string, date: string, kind: HabitEntryKind = 'done', loggedAt: string | null = null): HabitEntryRecord => {
  sequence += 1
  return { id: `he-${sequence}`, habitId, date, kind, loggedAt, createdAt: AT, updatedAt: AT, revision: 1 }
}

const times = (habitId: string, date: string, count: number): HabitEntryRecord[] =>
  Array.from({ length: count }, () => entry(habitId, date))

describe('daily habits', () => {
  const read = habit('read')
  const walk = habit('walk', { startDate: '2026-09-10' })
  const water = habit('water', { target: 4 })
  const smoke = habit('smoke', { kind: 'break' })

  it('counts only habits to build that had started by that day', () => {
    const log = buildLog([entry('read', '2026-09-05'), entry('read', '2026-09-12'), entry('walk', '2026-09-12')])
    expect(dayScore([read, walk, smoke], log, '2026-09-05')).toEqual({ date: '2026-09-05', done: 1, total: 1, partial: 1 })
    expect(dayScore([read, walk, smoke], log, '2026-09-11')).toEqual({ date: '2026-09-11', done: 0, total: 2, partial: 0 })
    expect(dayScore([read, walk, smoke], log, '2026-09-12')).toEqual({ date: '2026-09-12', done: 2, total: 2, partial: 2 })
  })

  it('needs every check-off of a larger target and gives partial credit on the way', () => {
    const log = buildLog([...times('water', '2026-09-05', 2), ...times('water', '2026-09-06', 5)])
    expect(dayScore([water], log, '2026-09-05')).toEqual({ date: '2026-09-05', done: 0, total: 1, partial: 0.5 })
    expect(dayScore([water], log, '2026-09-06')).toEqual({ date: '2026-09-06', done: 1, total: 1, partial: 1 })
    expect(rowState(water, log, '2026-09-05')).toEqual({ today: 2, progress: 2, target: 4, met: false })
  })

  it('reserves the brightest shade for a finished day', () => {
    expect([
      heatLevel({ done: 0, total: 3, partial: 0 }), heatLevel({ done: 1, total: 3, partial: 1 }),
      heatLevel({ done: 0, total: 1, partial: 0.5 }), heatLevel({ done: 3, total: 4, partial: 3 }),
      heatLevel({ done: 4, total: 4, partial: 4 }), heatLevel({ done: 0, total: 0, partial: 0 })
    ]).toEqual([0, 1, 2, 3, 4, 0])
  })

  it('sums a month up to today and can narrow it to one habit', () => {
    const log = buildLog([entry('read', '2026-09-10'), entry('walk', '2026-09-10'), entry('read', '2026-09-11')])
    const all = monthSummary([read, walk], log, '2026-09', '2026-09-11')
    expect(all.days).toHaveLength(30)
    expect(all.days[20]).toEqual({ date: '2026-09-21', done: 0, total: 0, partial: 0 })
    expect({ done: all.done, possible: all.possible }).toEqual({ done: 3, possible: 13 })
    const walking = monthSummary([read, walk], log, '2026-09', '2026-09-11', 'walk')
    expect({ done: walking.done, possible: walking.possible }).toEqual({ done: 1, possible: 2 })
    expect(habitRates([read, walk, smoke], log, '2026-09', '2026-09-11').map((rate) => [rate.habit.id, rate.done, rate.possible, rate.unit]))
      .toEqual([['read', 2, 11, 'day'], ['walk', 1, 2, 'day']])
  })

  it('keeps the current streak open until today is finished', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-04', '2026-09-05', '2026-09-06']
    const log = buildLog(days.map((date) => entry('read', date)))
    expect(streaks([read], log, '2026-09-07')).toEqual({ current: 3, best: 3, unit: 'day' })
    expect(streaks([read], buildLog([...days, '2026-09-07'].map((date) => entry('read', date))), '2026-09-07'))
      .toEqual({ current: 4, best: 4, unit: 'day' })
    expect(streaks([read], log, '2026-09-08')).toEqual({ current: 0, best: 3, unit: 'day' })
  })

  it('lays weeks out from Monday and months by their own length', () => {
    expect(mondayOf('2026-10-04')).toBe('2026-09-28')
    expect(weekDates('2026-10-01')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'
    ])
    expect(monthDates('2028-02')).toHaveLength(29)
    expect(monthWeeks('2026-10')).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
    expect(monthWeeks('2026-09')).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'])
  })
})

describe('weekly habits', () => {
  const read = habit('read')
  const gym = habit('gym', { period: 'week', target: 3, startDate: '2026-08-31' })

  it('counts the days done this week and meets the target on the third', () => {
    const log = buildLog([entry('gym', '2026-09-07'), entry('gym', '2026-09-07'), entry('gym', '2026-09-09')])
    expect(rowState(gym, log, '2026-09-10')).toEqual({ today: 0, progress: 2, target: 3, met: false })
    const more = buildLog([entry('gym', '2026-09-07'), entry('gym', '2026-09-09'), entry('gym', '2026-09-11')])
    expect(rowState(gym, more, '2026-09-13')).toMatchObject({ progress: 3, met: true })
  })

  it('brightens the days it was done and never leaves a day unfinished', () => {
    const log = buildLog([entry('read', '2026-09-07'), entry('gym', '2026-09-07'), entry('gym', '2026-09-08')])
    expect(dayScore([read, gym], log, '2026-09-07')).toMatchObject({ done: 2, total: 2 })
    expect(dayScore([read, gym], log, '2026-09-08')).toMatchObject({ done: 1, total: 2 })
    expect(dayScore([read, gym], log, '2026-09-09')).toMatchObject({ done: 0, total: 1 })
    expect(streaks([read, gym], buildLog([entry('read', '2026-09-01')]), '2026-09-01')).toMatchObject({ current: 1, unit: 'day' })
  })

  it('scores weeks in the month by their Thursday and leaves this week open until it is met', () => {
    const log = buildLog([
      entry('gym', '2026-08-31'), entry('gym', '2026-09-01'), entry('gym', '2026-09-02'),
      entry('gym', '2026-09-08'),
      entry('gym', '2026-09-14'), entry('gym', '2026-09-15'), entry('gym', '2026-09-16')
    ])
    const rate = habitRates([gym], log, '2026-09', '2026-09-23')[0]
    expect(rate).toMatchObject({ done: 2, possible: 3, unit: 'week' })
    expect(monthSummary([gym], log, '2026-09', '2026-09-23')).toMatchObject({ done: 2, possible: 3 })
    expect(streaks([gym], log, '2026-09-23')).toEqual({ current: 1, best: 1, unit: 'week' })
  })

  it('only counts the week a habit started in once that week is met', () => {
    const late = habit('late', { period: 'week', target: 2, startDate: '2026-09-10' })
    expect(habitRates([late], buildLog([]), '2026-09', '2026-09-16')[0]).toMatchObject({ done: 0, possible: 0 })
  })
})

describe('habits to break', () => {
  const quitAt = '2026-09-01T20:30:00.000Z'
  const smoke = habit('smoke', { kind: 'break', startDate: '2026-09-01', startedAt: quitAt })

  it('starts from the exact quit moment, or from when an older habit was added', () => {
    expect(quitStart(smoke)).toBe(Date.parse(quitAt))
    const added = habit('older', { kind: 'break', startDate: '2026-09-01', createdAt: '2026-09-01T12:00:00' })
    expect(quitStart(added)).toBe(Date.parse('2026-09-01T12:00:00'))
    const backdated = habit('backdated', { kind: 'break', startDate: '2026-08-20', createdAt: '2026-09-01T12:00:00' })
    expect(quitStart(backdated)).toBe(new Date(2026, 7, 20).getTime())
  })

  it('runs from the last restart and remembers the longest run that ended', () => {
    const log = buildLog([
      entry('smoke', '2026-09-03', 'slipped', new Date(Date.parse(quitAt) + 50 * HOUR).toISOString()),
      entry('smoke', '2026-09-04', 'slipped', new Date(Date.parse(quitAt) + 60 * HOUR).toISOString()),
      entry('smoke', '2026-09-04', 'resisted')
    ])
    expect(quitClock(smoke, log)).toEqual({
      since: Date.parse(quitAt) + 60 * HOUR, restarted: true, bestEnded: 50 * HOUR
    })
  })

  it('ignores restarts from before the quit moment', () => {
    const log = buildLog([entry('smoke', '2026-08-20', 'slipped', '2026-08-20T10:00:00.000Z')])
    expect(quitClock(smoke, log)).toEqual({ since: Date.parse(quitAt), restarted: false, bestEnded: 0 })
  })

  it('splits a run into days, hours, minutes, and seconds', () => {
    expect(splitDuration(((2 * 24 + 3) * 60 * 60 + 4 * 60 + 5) * 1000 + 999)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 })
    expect(splitDuration(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
})
