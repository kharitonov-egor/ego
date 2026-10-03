import { describe, expect, it } from 'vitest'
import {
  calendarColorOf, describeRecurrence, eventColorOf, formatRecurrenceRule, monthlyWeekdayOf, parseRecurrenceRule,
  recurrencePresets, splitRecurrence, textOn, untilDate, untilToken
} from '../src/calendar'

describe('calendar colors', () => {
  it('maps the API\'s classic shades to the palette Google Calendar draws', () => {
    expect(calendarColorOf('14', '#9fe1e7')).toBe('#039be5')
    expect(calendarColorOf('14', '#9FE1E7')).toBe('#039be5')
    expect(calendarColorOf('14', '#ff00aa')).toBe('#ff00aa')
    expect(calendarColorOf(null, null)).toBe('#039be5')
    expect(eventColorOf('11', '#123456')).toBe('#d50000')
    expect(eventColorOf(null, '#123456')).toBe('#123456')
  })

  it('picks readable text for each block', () => {
    expect(textOn('#f6bf26')).toBe('#000000')
    expect(textOn('#3f51b5')).toBe('#ffffff')
  })
})

describe('recurrence', () => {
  it('reads and writes rules without losing parts Ego does not edit', () => {
    const rule = parseRecurrenceRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;WKST=SU;UNTIL=20261231T045959Z')
    expect(rule).toMatchObject({ frequency: 'WEEKLY', interval: 2, weekdays: ['WE', 'MO'], extra: ['WKST=SU'] })
    expect(rule && formatRecurrenceRule(rule)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T045959Z;WKST=SU')
    expect(parseRecurrenceRule('RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2')?.monthly).toEqual({ kind: 'weekday', ordinal: 2, weekday: 'TU' })
    expect(parseRecurrenceRule('EXDATE:20261010')).toBeNull()
  })

  it('describes rules the way Google Calendar words them', () => {
    expect(describeRecurrence(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'], '2026-10-05')).toBe('Every weekday')
    expect(describeRecurrence(['RRULE:FREQ=WEEKLY'], '2026-10-05')).toBe('Weekly on Monday')
    expect(describeRecurrence(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6'], '2026-10-05')).toBe('Every 2 weeks on Monday and Wednesday, 6 times')
    expect(describeRecurrence(['RRULE:FREQ=MONTHLY;BYDAY=-1FR'], '2026-10-30')).toBe('Monthly on the last Friday')
    expect(describeRecurrence(['RRULE:FREQ=YEARLY'], '2026-10-02')).toBe('Annually on October 2')
    expect(describeRecurrence(['RRULE:FREQ=DAILY;UNTIL=20261231T045959Z'], '2026-10-02', 'America/New_York')).toBe('Daily, until Dec 30, 2026')
    expect(describeRecurrence([], '2026-10-02')).toBeNull()
  })

  it('offers presets for the start day', () => {
    const presets = recurrencePresets('2026-10-30')
    expect(presets.map((item) => item.label)).toEqual([
      'Does not repeat', 'Daily', 'Weekly on Friday', 'Monthly on the last Friday', 'Annually on October 30',
      'Every weekday (Monday to Friday)'
    ])
    expect(monthlyWeekdayOf('2026-10-13')).toEqual({ ordinal: 2, weekday: 'TU' })
  })

  it('splits a series for this and following', () => {
    expect(splitRecurrence(['RRULE:FREQ=WEEKLY', 'EXDATE:20261008T220000Z'], '20261014T215959Z', 2)).toEqual({
      ended: ['RRULE:FREQ=WEEKLY;UNTIL=20261014T215959Z', 'EXDATE:20261008T220000Z'],
      rest: ['RRULE:FREQ=WEEKLY', 'EXDATE:20261008T220000Z']
    })
    expect(splitRecurrence(['RRULE:FREQ=DAILY;COUNT=10'], '20261003', 4)).toEqual({
      ended: ['RRULE:FREQ=DAILY;COUNT=4'], rest: ['RRULE:FREQ=DAILY;COUNT=6']
    })
  })

  it('writes UNTIL tokens for days and instants', () => {
    expect(untilToken({ date: '2026-10-14' })).toBe('20261014')
    expect(untilToken({ instant: '2026-10-14T21:59:59.000Z' })).toBe('20261014T215959Z')
    expect(untilDate('20261014')).toBe('2026-10-14')
  })
})
