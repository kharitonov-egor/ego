import { describe, expect, it } from 'vitest'
import { DEFAULT_REST, parseRestPreference, secondsLeft } from '../src/gym/rest'

describe('rest timer preference', () => {
  it('reads a stored preference and falls back on anything odd', () => {
    expect(parseRestPreference(null)).toEqual(DEFAULT_REST)
    expect(parseRestPreference('not json')).toEqual(DEFAULT_REST)
    expect(parseRestPreference('[]')).toEqual({ seconds: 90, autoStart: true })
    expect(parseRestPreference('{"seconds":120,"autoStart":false}')).toEqual({ seconds: 120, autoStart: false })
    expect(parseRestPreference('{"seconds":2}')).toEqual({ seconds: 90, autoStart: true })
    expect(parseRestPreference('{"seconds":90.5,"autoStart":"no"}')).toEqual({ seconds: 90, autoStart: true })
  })

  it('counts whole seconds left, rounding up and stopping at zero', () => {
    expect(secondsLeft(null, 1000)).toBe(0)
    expect(secondsLeft(10_000, 0)).toBe(10)
    expect(secondsLeft(10_000, 9_001)).toBe(1)
    expect(secondsLeft(10_000, 12_000)).toBe(0)
  })
})
