import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatIso, isoFromParts, isoToday, monthGrid, relativeDayLabel, shiftIso } from '../lib/dates'

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

describe('month grid', () => {
  it('pads the first week and fills whole rows', () => {
    const grid = monthGrid(2026, 7)
    expect(grid[0]).toEqual([null, null, null, null, null, null, 1])
    expect(grid.every((week) => week.length === 7)).toBe(true)
    expect(grid.flat().filter((day) => day !== null)).toHaveLength(31)
  })

  it('handles a February that starts on a Sunday', () => {
    const grid = monthGrid(2026, 1)
    expect(grid[0][0]).toBe(1)
    expect(grid.flat().filter((day) => day !== null)).toHaveLength(28)
  })
})
