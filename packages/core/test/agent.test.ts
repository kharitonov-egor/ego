import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS, describeTrigger, inQuietHours, isAgentSettings, isAgentTrigger, nextRunAt, planDelivery,
  triggerFromInput, zonedTime
} from '../src/agent'

const NY = 'America/New_York'
const at = (iso: string): number => Date.parse(iso)
const iso = (ms: number | null): string | null => ms === null ? null : new Date(ms).toISOString()

describe('zonedTime', () => {
  it('reads a local clock time in summer and winter', () => {
    expect(iso(zonedTime('2026-10-07', '07:00', NY))).toBe('2026-10-07T11:00:00.000Z')
    expect(iso(zonedTime('2026-11-02', '07:00', NY))).toBe('2026-11-02T12:00:00.000Z')
    expect(iso(zonedTime('2026-10-07', '23:30', 'Asia/Kolkata'))).toBe('2026-10-07T18:00:00.000Z')
  })
})

describe('nextRunAt', () => {
  it('finds the next daily, weekday, and weekly slot after a moment', () => {
    const wednesday8am = at('2026-10-07T12:00:00Z')
    expect(iso(nextRunAt({ type: 'daily', time: '07:00' }, wednesday8am, NY))).toBe('2026-10-08T11:00:00.000Z')
    expect(iso(nextRunAt({ type: 'daily', time: '09:15' }, wednesday8am, NY))).toBe('2026-10-07T13:15:00.000Z')
    const friday8am = at('2026-10-09T12:00:00Z')
    expect(iso(nextRunAt({ type: 'weekdays', time: '07:00' }, friday8am, NY))).toBe('2026-10-12T11:00:00.000Z')
    expect(iso(nextRunAt({ type: 'weekly', weekday: 7, time: '18:00' }, wednesday8am, NY))).toBe('2026-10-11T22:00:00.000Z')
  })

  it('keeps the wall-clock time across the end of daylight saving', () => {
    const saturdayNight = at('2026-11-01T02:00:00Z')
    expect(iso(nextRunAt({ type: 'daily', time: '07:00' }, saturdayNight, NY))).toBe('2026-11-01T12:00:00.000Z')
  })

  it('counts intervals from the last run and returns null when nothing is left', () => {
    const now = at('2026-10-07T12:00:00Z')
    expect(iso(nextRunAt({ type: 'interval', hours: 3 }, now, NY))).toBe('2026-10-07T15:00:00.000Z')
    expect(iso(nextRunAt({ type: 'interval', hours: 3 }, now, NY, at('2026-10-07T10:00:00Z')))).toBe('2026-10-07T13:00:00.000Z')
    expect(nextRunAt({ type: 'once', date: '2026-10-01', time: '09:00' }, now, NY)).toBeNull()
    expect(iso(nextRunAt({ type: 'once', date: '2026-10-09', time: '09:00' }, now, NY))).toBe('2026-10-09T13:00:00.000Z')
    expect(nextRunAt({ type: 'manual' }, now, NY)).toBeNull()
  })
})

describe('triggers', () => {
  it('turns the flat tool shape into a trigger or says what is missing', () => {
    const base = { time: null, weekday: null, hours: null, date: null }
    expect(triggerFromInput({ ...base, type: 'daily', time: '07:00' })).toEqual({ type: 'daily', time: '07:00' })
    expect(triggerFromInput({ ...base, type: 'weekly', time: '18:00', weekday: 7 })).toEqual({ type: 'weekly', weekday: 7, time: '18:00' })
    expect(triggerFromInput({ ...base, type: 'weekly', time: '18:00' })).toContain('weekday')
    expect(triggerFromInput({ ...base, type: 'interval', hours: 0 })).toContain('hours')
    expect(triggerFromInput({ ...base, type: 'once', time: '09:00' })).toContain('date')
    expect(triggerFromInput({ ...base, type: 'manual' })).toEqual({ type: 'manual' })
    expect(isAgentTrigger({ type: 'daily', time: '7:00' })).toBe(false)
    expect(isAgentTrigger({ type: 'weekly', weekday: 8, time: '07:00' })).toBe(false)
  })

  it('describes a trigger in words', () => {
    expect(describeTrigger({ type: 'weekdays', time: '07:00' })).toBe('Weekdays at 7:00')
    expect(describeTrigger({ type: 'weekly', weekday: 7, time: '18:30' })).toBe('Sundays at 18:30')
    expect(describeTrigger({ type: 'interval', hours: 1 })).toBe('Every hour')
    expect(describeTrigger({ type: 'once', date: '2026-10-09', time: '09:00' })).toBe('Once on Oct 9 at 9:00')
    expect(describeTrigger({ type: 'manual' })).toBe('Only when asked')
  })

  it('accepts the default settings and rejects a bad clock', () => {
    expect(isAgentSettings(DEFAULT_AGENT_SETTINGS)).toBe(true)
    expect(isAgentSettings({ ...DEFAULT_AGENT_SETTINGS, quietStart: '25:00' })).toBe(false)
  })
})

describe('planDelivery', () => {
  const settings = { quietStart: '22:00', quietEnd: '08:00', dailyCap: 2 }

  it('holds a message in quiet hours until they end', () => {
    expect(inQuietHours(23 * 60, '22:00', '08:00')).toBe(true)
    expect(inQuietHours(7 * 60, '22:00', '08:00')).toBe(true)
    expect(inQuietHours(12 * 60, '22:00', '08:00')).toBe(false)
    const lateNight = planDelivery({ requestedMs: at('2026-10-08T03:30:00Z'), urgent: false, muted: false, shownToday: 0, settings, timeZone: NY })
    expect(iso(lateNight.deliverMs)).toBe('2026-10-08T12:00:00.000Z')
    const earlyMorning = planDelivery({ requestedMs: at('2026-10-08T11:00:00Z'), urgent: false, muted: false, shownToday: 0, settings, timeZone: NY })
    expect(iso(earlyMorning.deliverMs)).toBe('2026-10-08T12:00:00.000Z')
  })

  it('lets urgent messages through and silences the rest past the cap or when muted', () => {
    const urgent = planDelivery({ requestedMs: at('2026-10-08T03:30:00Z'), urgent: true, muted: false, shownToday: 5, settings, timeZone: NY })
    expect(urgent).toEqual({ deliverMs: at('2026-10-08T03:30:00Z'), silent: false })
    const capped = planDelivery({ requestedMs: at('2026-10-08T16:00:00Z'), urgent: false, muted: false, shownToday: 2, settings, timeZone: NY })
    expect(capped.silent).toBe(true)
    const muted = planDelivery({ requestedMs: at('2026-10-08T16:00:00Z'), urgent: false, muted: true, shownToday: 0, settings, timeZone: NY })
    expect(muted.silent).toBe(true)
  })
})
