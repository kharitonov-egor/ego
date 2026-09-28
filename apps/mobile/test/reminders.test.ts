import { describe, expect, it } from 'vitest'
import { DEFAULT_REMINDER, hourLabel, parseReminder, reminderId, reminderPlan } from '../lib/reminders'

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 8, day, hour, minute)

describe('reminder plan', () => {
  it('schedules tonight and the next six evenings when nothing is logged yet', () => {
    const plan = reminderPlan(at(27, 14), 21, false)
    expect(plan).toHaveLength(7)
    expect(plan[0]).toEqual(at(27, 21))
    expect(plan[6]).toEqual(new Date(2026, 9, 3, 21))
  })

  it('skips tonight once something is recorded today', () => {
    const plan = reminderPlan(at(27, 14), 21, true)
    expect(plan[0]).toEqual(at(28, 21))
    expect(plan).toHaveLength(6)
  })

  it('skips tonight after the hour has passed', () => {
    expect(reminderPlan(at(27, 21, 30), 21, false)[0]).toEqual(at(28, 21))
  })

  it('names each reminder by its day, so a reschedule replaces it', () => {
    expect(reminderId(at(3, 21))).toBe('ego-daily-reminder-2026-09-03')
  })
})

describe('reminder preference', () => {
  it('reads a saved choice and falls back when it is unusable', () => {
    expect(parseReminder('{"enabled":true,"hour":20}')).toEqual({ enabled: true, hour: 20 })
    expect(parseReminder('{"enabled":"yes","hour":99}')).toEqual({ enabled: false, hour: 21 })
    expect(parseReminder(null)).toEqual(DEFAULT_REMINDER)
    expect(parseReminder('broken')).toEqual(DEFAULT_REMINDER)
  })

  it('labels hours the way a clock does', () => {
    expect(hourLabel(21)).toBe('9 PM')
    expect(hourLabel(12)).toBe('12 PM')
    expect(hourLabel(0)).toBe('12 AM')
  })
})
