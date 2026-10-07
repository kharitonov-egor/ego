import { describe, expect, it } from 'vitest'
import { MAX_WAIT_MS, isDue, nextReminder, waitFor } from './reminder-schedule'

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 9, day, hour, minute)

describe('nextReminder', () => {
  it('stays off until the reminder is switched on', () => {
    expect(nextReminder(at(2, 10), { enabled: false, hour: 21 }, false)).toBeNull()
  })

  it('rings tonight when nothing is logged yet', () => {
    expect(nextReminder(at(2, 10), { enabled: true, hour: 21 }, false)).toEqual(at(2, 21))
  })

  it('skips tonight once something is logged', () => {
    expect(nextReminder(at(2, 10), { enabled: true, hour: 21 }, true)).toEqual(at(3, 21))
  })

  it('moves to tomorrow once the hour has passed', () => {
    expect(nextReminder(at(2, 21, 5), { enabled: true, hour: 21 }, false)).toEqual(at(3, 21))
  })
})

describe('isDue', () => {
  it('waits for the hour', () => {
    expect(isDue(at(2, 21), at(2, 20, 59))).toBe(false)
  })

  it('rings late the same evening, after a sleeping computer wakes', () => {
    expect(isDue(at(2, 21), at(2, 23, 30))).toBe(true)
  })

  it('stays quiet the next morning', () => {
    expect(isDue(at(2, 21), at(3, 8))).toBe(false)
  })
})

describe('waitFor', () => {
  it('waits until the reminder when it is close', () => {
    expect(waitFor(at(2, 21), at(2, 20, 55))).toBe(5 * 60 * 1000)
  })

  it('checks again within the cap when it is far off', () => {
    expect(waitFor(at(3, 21), at(2, 10))).toBe(MAX_WAIT_MS)
  })

  it('never waits a negative time', () => {
    expect(waitFor(at(2, 21), at(2, 22))).toBe(0)
  })
})
