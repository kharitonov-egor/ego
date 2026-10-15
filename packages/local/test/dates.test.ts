import { afterEach, describe, expect, it, vi } from 'vitest'
import { WEEKDAYS, formatIso, isoFromParts, isoToday, monthGrid, relativeDayLabel, shiftIso, weekStartOf, weekdayIndex } from '../src/dates'

afterEach(() => {
  vi.useRealTimers()
})

describe('iso helpers', () => {
  it('pads month and day', () => {
    expect(isoFromParts(2026, 7, 3)).toBe('2026-08-03')
  })

  it('uses the local calendar day, not UTC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 27, 23, 30))
    expect(isoToday()).toBe('2026-08-27')
  })

  it.each([
    ['2026-08-27', 1, '2026-08-28'],
    ['2026-08-01', -1, '2026-07-31'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2028-02-28', 1, '2028-02-29']
  ])('shifts %s by %s', (iso, days, expected) => {
    expect(shiftIso(iso, days)).toBe(expected)
  })

  it('formats without a timezone shift', () => {
    expect(formatIso('2026-08-27')).toBe('Aug 27, 2026')
  })

  it('names nearby days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 27, 9, 0))
    expect(relativeDayLabel('2026-08-27')).toBe('Today, Aug 27, 2026')
    expect(relativeDayLabel('2026-08-26')).toBe('Yesterday, Aug 26, 2026')
    expect(relativeDayLabel('2026-08-20')).toBe('Aug 20, 2026')
  })
})

describe('weeks start on Monday', () => {
  it('labels the columns Monday to Sunday', () => {
    expect(WEEKDAYS).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S'])
  })

  it.each([
    ['2026-10-12', 0],
    ['2026-10-14', 2],
    ['2026-10-18', 6]
  ])('puts %s in column %s', (iso, column) => {
    expect(weekdayIndex(new Date(`${iso}T12:00:00`))).toBe(column)
  })

  it.each([
    ['2026-10-12', '2026-10-12'],
    ['2026-10-14', '2026-10-12'],
    ['2026-10-18', '2026-10-12'],
    ['2026-11-01', '2026-10-26']
  ])('starts the week holding %s on %s', (iso, monday) => {
    expect(weekStartOf(iso)).toBe(monday)
  })
})

describe('month grid', () => {
  it('pads the first week and fills whole rows', () => {
    const grid = monthGrid(2026, 7)
    expect(grid[0]).toEqual([null, null, null, null, null, 1, 2])
    expect(grid.every((week) => week.length === 7)).toBe(true)
    expect(grid.flat().filter((day) => day !== null)).toHaveLength(31)
  })

  it('starts October 2026 on Thursday and ends it on Saturday', () => {
    const grid = monthGrid(2026, 9)
    expect(grid[0]).toEqual([null, null, null, 1, 2, 3, 4])
    expect(grid[grid.length - 1]).toEqual([26, 27, 28, 29, 30, 31, null])
  })

  it('puts a Sunday first of the month in the last column', () => {
    const grid = monthGrid(2026, 1)
    expect(grid[0]).toEqual([null, null, null, null, null, null, 1])
    expect(grid.flat().filter((day) => day !== null)).toHaveLength(28)
  })

  it('needs no padding when the month starts on a Monday', () => {
    expect(monthGrid(2026, 5)[0][0]).toBe(1)
  })
})
