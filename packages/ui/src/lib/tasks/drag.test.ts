import { describe, expect, it } from 'vitest'
import { columnAt, dropIndex, edgeScroll } from './drag'

describe('dropIndex', () => {
  const heights = [72, 40, 100]

  it('puts the item before the first one whose middle is below the pointer', () => {
    expect(dropIndex(-20, heights, 8)).toBe(0)
    expect(dropIndex(35, heights, 8)).toBe(0)
    expect(dropIndex(37, heights, 8)).toBe(1)
    expect(dropIndex(99, heights, 8)).toBe(1)
    expect(dropIndex(101, heights, 8)).toBe(2)
  })

  it('drops at the end below the last item and into an empty list', () => {
    expect(dropIndex(500, heights, 8)).toBe(3)
    expect(dropIndex(0, [], 8)).toBe(0)
  })
})

describe('columnAt', () => {
  it('splits the gap between neighbouring columns and stays within the board', () => {
    expect(columnAt(-50, 310, 10, 4)).toBe(0)
    expect(columnAt(150, 310, 10, 4)).toBe(0)
    expect(columnAt(304, 310, 10, 4)).toBe(0)
    expect(columnAt(306, 310, 10, 4)).toBe(1)
    expect(columnAt(5000, 310, 10, 4)).toBe(3)
  })
})

describe('edgeScroll', () => {
  it('scrolls faster the closer the pointer gets to an edge', () => {
    expect(edgeScroll(500, 0, 1000, 60, 16)).toBe(0)
    expect(edgeScroll(30, 0, 1000, 60, 16)).toBe(-8)
    expect(edgeScroll(0, 0, 1000, 60, 16)).toBe(-16)
    expect(edgeScroll(-40, 0, 1000, 60, 16)).toBe(-16)
    expect(edgeScroll(970, 0, 1000, 60, 16)).toBe(8)
    expect(edgeScroll(1200, 0, 1000, 60, 16)).toBe(16)
  })
})
