import { describe, expect, it } from 'vitest'
import { dayNumber, formatMetric, tickLabel, ticksFor } from '../src/gym/graph'

describe('exercise graph', () => {
  it('picks round ticks that bracket the values', () => {
    expect(ticksFor([135, 185])).toEqual([120, 140, 160, 180, 200])
    expect(ticksFor([0.4, 1.3])).toEqual([0, 0.5, 1, 1.5])
    expect(ticksFor([100, 100])).toEqual([90, 100, 110])
  })

  it('labels values in the metric unit', () => {
    expect(formatMetric('max_weight', 185, 'lbs', 'mi')).toBe('185.0 lbs')
    expect(formatMetric('workout_volume', 12345.6, 'kg', 'mi')).toBe('12,346 kg')
    expect(formatMetric('max_reps', 11.6, 'lbs', 'mi')).toBe('12 reps')
    expect(formatMetric('workout_distance', 3.14159, 'lbs', 'km')).toBe('3.14 km')
    expect(formatMetric('max_time', 95, 'lbs', 'mi')).toBe('1:35')
    expect(tickLabel('workout_volume', 25000)).toBe('25k')
    expect(tickLabel('max_weight', 2.5)).toBe('2.5')
    expect(tickLabel('workout_time', 600)).toBe('10:00')
  })

  it('counts days between dates', () => {
    expect(dayNumber('2026-03-02') - dayNumber('2026-02-27')).toBe(3)
  })
})
