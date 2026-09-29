import { describe, expect, it } from 'vitest'
import {
  bodyWeightIn, formatBodyWeight, formatHealthDistance, formatSleepMinutes, mainSleepMinutes, readinessFor,
  readinessLevel, zoneMinutesOf, type ReadinessDay, type ReadinessNight
} from '../src/vitals'

function history(count: number, hrv: (index: number) => number | null, resting: (index: number) => number | null): ReadinessDay[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 28 - count + index)).toISOString().slice(0, 10)
    return { date, hrvMs: hrv(index), restingHeartRate: resting(index) }
  })
}

const steady = (index: number): number => 45 + (index % 3) - 1
const steadyResting = (index: number): number => 58 + (index % 2)

describe('units', () => {
  it('shows distance and body weight in either system', () => {
    expect(formatHealthDistance(8046.72, 'imperial')).toBe('5.00 mi')
    expect(formatHealthDistance(8046.72, 'metric')).toBe('8.05 km')
    expect(formatBodyWeight(80.25, 'imperial')).toBe('176.9 lb')
    expect(formatBodyWeight(80.25, 'metric')).toBe('80.3 kg')
    expect(bodyWeightIn(1, 'imperial')).toBeCloseTo(2.2046, 4)
  })

  it('writes sleep as hours and minutes', () => {
    expect(formatSleepMinutes(452)).toBe('7h 32m')
    expect(formatSleepMinutes(420)).toBe('7h 00m')
    expect(formatSleepMinutes(45)).toBe('45m')
  })

  it('adds zone minutes only when the band reported some', () => {
    expect(zoneMinutesOf({ fatBurnMinutes: 10, cardioMinutes: 20, peakMinutes: null })).toBe(30)
    expect(zoneMinutesOf({ fatBurnMinutes: null, cardioMinutes: null, peakMinutes: null })).toBeNull()
  })
})

describe('readiness', () => {
  const nights: ReadinessNight[] = [
    { date: '2026-09-28', minutesAsleep: 450, nap: false },
    { date: '2026-09-28', minutesAsleep: 40, nap: true }
  ]

  it('lands near 60 on an ordinary day', () => {
    const days = [...history(30, steady, steadyResting), { date: '2026-09-28', hrvMs: 45, restingHeartRate: 58.5 }]
    const readiness = readinessFor('2026-09-28', days, nights)
    expect(readiness?.score).toBeGreaterThanOrEqual(55)
    expect(readiness?.score).toBeLessThanOrEqual(65)
    expect(readiness?.level).toBe('moderate')
    expect(readiness?.parts.map((part) => part.key)).toEqual(['hrv', 'restingHeartRate', 'sleep'])
    expect(readiness?.parts.find((part) => part.key === 'sleep')?.value).toBe(450)
  })

  it('rises with high HRV and a low resting heart rate', () => {
    const days = [...history(30, steady, steadyResting), { date: '2026-09-28', hrvMs: 60, restingHeartRate: 54 }]
    const readiness = readinessFor('2026-09-28', days, [{ date: '2026-09-28', minutesAsleep: 510, nap: false }])
    expect(readiness?.score).toBeGreaterThanOrEqual(90)
    expect(readiness?.level).toBe('high')
  })

  it('falls after a short night with suppressed HRV', () => {
    const days = [...history(30, steady, steadyResting), { date: '2026-09-28', hrvMs: 32, restingHeartRate: 64 }]
    const readiness = readinessFor('2026-09-28', days, [{ date: '2026-09-28', minutesAsleep: 280, nap: false }])
    expect(readiness?.score).toBeLessThan(40)
    expect(readiness?.level).toBe('low')
  })

  it('waits for a week of history and scores what it has', () => {
    const short = [...history(5, steady, steadyResting), { date: '2026-09-28', hrvMs: 45, restingHeartRate: 58 }]
    expect(readinessFor('2026-09-28', short, nights)).toBeNull()
    const noHrv = [...history(14, () => null, steadyResting), { date: '2026-09-28', hrvMs: null, restingHeartRate: 58 }]
    expect(readinessFor('2026-09-28', noHrv, [])?.parts.map((part) => part.key)).toEqual(['restingHeartRate'])
    expect(readinessFor('2026-09-27', noHrv, [])).not.toBeNull()
  })

  it('ignores days outside the 30 before', () => {
    const days = [
      ...history(60, (index) => index < 30 ? 90 : steady(index), steadyResting),
      { date: '2026-09-28', hrvMs: 45, restingHeartRate: 58.5 }
    ]
    expect(readinessFor('2026-09-28', days, nights)?.parts[0].baseline).toBeCloseTo(45, 0)
  })

  it('counts the main sleep and leaves naps out', () => {
    expect(mainSleepMinutes(nights, '2026-09-28')).toBe(450)
    expect(mainSleepMinutes(nights, '2026-09-27')).toBeNull()
    expect(readinessLevel(70)).toBe('high')
    expect(readinessLevel(39)).toBe('low')
  })
})
