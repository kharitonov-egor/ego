import { describe, expect, it } from 'vitest'
import { isSnipRect, selectionInImage, windowsOnDisplay } from './snipGeometry'

describe('windowsOnDisplay', () => {
  const right = { x: 2048, y: 0, width: 1920, height: 1080 }

  it('clips a window to the display and keeps the topmost first', () => {
    const windows = [
      { x: 3150, y: 0, width: 818, height: 1080 },
      { x: 1558, y: 0, width: 600, height: 500 },
      { x: 0, y: 0, width: 2048, height: 1104 }
    ]
    expect(windowsOnDisplay(windows, right)).toEqual([
      { x: 1102, y: 0, width: 818, height: 1080 },
      { x: 0, y: 0, width: 110, height: 500 }
    ])
  })
})

describe('selectionInImage', () => {
  it('scales a selection on a 125% display to its denser image', () => {
    expect(selectionInImage({ x: 100, y: 40, width: 200, height: 80 }, { width: 2048, height: 1152 }, { width: 2560, height: 1440 }))
      .toEqual({ x: 125, y: 50, width: 250, height: 100 })
  })

  it('stays inside the image and refuses a sliver', () => {
    expect(selectionInImage({ x: 1900, y: 1000, width: 300, height: 300 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 }))
      .toEqual({ x: 1900, y: 1000, width: 20, height: 80 })
    expect(selectionInImage({ x: 10, y: 10, width: 1, height: 50 }, { width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBeNull()
  })
})

describe('isSnipRect', () => {
  it('accepts four finite numbers only', () => {
    expect(isSnipRect({ x: 0, y: 0, width: 10, height: 10 })).toBe(true)
    expect(isSnipRect({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBe(false)
    expect(isSnipRect({ x: 0, y: 0, width: '10', height: 10 })).toBe(false)
  })
})
