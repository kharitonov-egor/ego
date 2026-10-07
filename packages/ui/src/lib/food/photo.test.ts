import { describe, expect, it } from 'vitest'
import { fitWithin } from './photo'

describe('fitWithin', () => {
  it('brings the long edge of a landscape photo down to the edge', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('brings the long edge of a portrait photo down to the edge', () => {
    expect(fitWithin(900, 2400, 1600)).toEqual({ width: 600, height: 1600 })
    expect(fitWithin(600, 1600, 480)).toEqual({ width: 180, height: 480 })
  })

  it('leaves a photo that already fits alone', () => {
    expect(fitWithin(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(320, 240, 480)).toEqual({ width: 320, height: 240 })
  })
})
