import { describe, expect, it } from 'vitest'
import type { GymSetLike } from '@ego/core'
import {
  dayBarLabel, draftFrom, historyHeader, setParts, stepDraft, valuesFromDraft, type EntryDraft
} from '../lib/gym/format'

const squat: GymSetLike = {
  id: 'gs-1', date: '2026-09-27', position: 0, weight: 25, weightUnit: 'lbs', reps: 12,
  distance: null, distanceUnit: null, durationSeconds: null
}

describe('gym labels', () => {
  it('names nearby days and adds the year only for other years', () => {
    expect(dayBarLabel('2026-09-27', '2026-09-27')).toBe('TODAY')
    expect(dayBarLabel('2026-09-26', '2026-09-27')).toBe('YESTERDAY')
    expect(dayBarLabel('2026-09-20', '2026-09-27')).toBe('SUN, SEP 20')
    expect(dayBarLabel('2025-06-15', '2026-09-27')).toBe('SUN, JUN 15, 2025')
    expect(historyHeader('2026-09-27', '2026-09-27')).toBe('SUNDAY, SEPTEMBER 27')
    expect(historyHeader('2025-06-15', '2026-09-27')).toBe('SUNDAY, JUNE 15 2025')
  })

  it('shows each field in the exercise unit', () => {
    expect(setParts(squat, 'weight_reps', 'lbs')).toEqual([
      { field: 'weight', value: '25.0', unit: 'lbs' },
      { field: 'reps', value: '12', unit: 'reps' }
    ])
    expect(setParts({ ...squat, weight: 20, weightUnit: 'kg' }, 'weight_reps', 'lbs')[0].value).toBe('44.09')
    const treadmill = { ...squat, weight: null, weightUnit: null, reps: null, distance: 1.53, distanceUnit: 'mi' as const, durationSeconds: 1926 }
    expect(setParts(treadmill, 'distance_time', 'lbs').map((part) => `${part.value} ${part.unit}`.trim())).toEqual(['1.53 mi', '32:06'])
  })
})

describe('entry fields', () => {
  it('starts from a previous set, or from zero', () => {
    expect(draftFrom(squat, 'weight_reps', 'lbs')).toEqual({ weight: '25.0', reps: '12', distance: '', time: '' })
    expect(draftFrom(null, 'time', 'lbs')).toEqual({ weight: '', reps: '', distance: '', time: '0:00' })
  })

  it('steps by the unit increment and never below zero', () => {
    const draft: EntryDraft = { weight: '25.0', reps: '12', distance: '', time: '0:40' }
    expect(stepDraft(draft, 'weight', 1, 'lbs', 'mi').weight).toBe('30.0')
    expect(stepDraft(draft, 'weight', 1, 'kg', 'mi').weight).toBe('27.5')
    expect(stepDraft({ ...draft, weight: '2.5' }, 'weight', -1, 'lbs', 'mi').weight).toBe('0.0')
    expect(stepDraft(draft, 'reps', -1, 'lbs', 'mi').reps).toBe('11')
    expect(stepDraft(draft, 'time', 1, 'lbs', 'mi').time).toBe('0:45')
  })

  it('turns fields into set values and explains what is missing', () => {
    expect(valuesFromDraft({ weight: '77,5', reps: '12', distance: '', time: '' }, 'weight_reps', 'lbs', 'mi')).toEqual({
      ok: true,
      values: { weight: 77.5, weightUnit: 'lbs', reps: 12, distance: null, distanceUnit: null, durationSeconds: null }
    })
    expect(valuesFromDraft({ weight: '25', reps: '0', distance: '', time: '' }, 'weight_reps', 'lbs', 'mi'))
      .toEqual({ ok: false, message: 'Enter the reps' })
    expect(valuesFromDraft({ weight: 'abc', reps: '5', distance: '', time: '' }, 'weight_reps', 'lbs', 'mi'))
      .toEqual({ ok: false, message: 'Enter a weight' })
    expect(valuesFromDraft({ weight: '', reps: '', distance: '', time: '0:00:40' }, 'time', 'lbs', 'mi')).toMatchObject({
      ok: true, values: { durationSeconds: 40, weight: null }
    })
  })
})
