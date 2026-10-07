import { describe, expect, it } from 'vitest'
import { gridMove, moveSelection, typedKey } from './navigation'

const rows = ['r1', 'r2', 'r3']
const columns = ['name', 'phone', 'email']
interface Key {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  getModifierState: (modifier: string) => boolean
}
const key = (name: string, ctrl = false, altGraph = false): Key => ({
  key: name, ctrlKey: ctrl || altGraph, metaKey: false, altKey: altGraph, getModifierState: (modifier) => altGraph && modifier === 'AltGraph'
})

describe('gridMove', () => {
  it('reads arrows, Home, End, and page keys', () => {
    expect(gridMove(key('ArrowDown'))).toBe('down')
    expect(gridMove(key('ArrowLeft'))).toBe('left')
    expect(gridMove(key('Home'))).toBe('rowStart')
    expect(gridMove(key('End'))).toBe('rowEnd')
    expect(gridMove(key('PageDown'))).toBe('pageDown')
    expect(gridMove(key('Enter'))).toBeNull()
  })

  it('jumps to the edges with Ctrl', () => {
    expect(gridMove(key('ArrowUp', true))).toBe('top')
    expect(gridMove(key('ArrowRight', true))).toBe('rowEnd')
    expect(gridMove(key('End', true))).toBe('bottom')
  })
})

describe('moveSelection', () => {
  it('starts on the first cell after the name', () => {
    expect(moveSelection(rows, columns, null, 'down', 10)).toEqual({ rowId: 'r1', columnId: 'phone' })
    expect(moveSelection(rows, ['name'], null, 'right', 10)).toEqual({ rowId: 'r1', columnId: 'name' })
  })

  it('starts over when the selected row is filtered away', () => {
    expect(moveSelection(rows, columns, { rowId: 'gone', columnId: 'email' }, 'up', 10)).toEqual({ rowId: 'r1', columnId: 'phone' })
  })

  it('moves one cell and stops at the edges', () => {
    const at = { rowId: 'r2', columnId: 'phone' }
    expect(moveSelection(rows, columns, at, 'up', 10)).toEqual({ rowId: 'r1', columnId: 'phone' })
    expect(moveSelection(rows, columns, at, 'left', 10)).toEqual({ rowId: 'r2', columnId: 'name' })
    expect(moveSelection(rows, columns, { rowId: 'r3', columnId: 'email' }, 'down', 10)).toEqual({ rowId: 'r3', columnId: 'email' })
    expect(moveSelection(rows, columns, { rowId: 'r3', columnId: 'email' }, 'right', 10)).toEqual({ rowId: 'r3', columnId: 'email' })
  })

  it('jumps to the ends of a row or the sheet and by a page', () => {
    const at = { rowId: 'r2', columnId: 'phone' }
    expect(moveSelection(rows, columns, at, 'rowEnd', 10)).toEqual({ rowId: 'r2', columnId: 'email' })
    expect(moveSelection(rows, columns, at, 'rowStart', 10)).toEqual({ rowId: 'r2', columnId: 'name' })
    expect(moveSelection(rows, columns, at, 'bottom', 10)).toEqual({ rowId: 'r3', columnId: 'phone' })
    expect(moveSelection(rows, columns, at, 'pageUp', 10)).toEqual({ rowId: 'r1', columnId: 'phone' })
  })

  it('has nothing to select in an empty grid', () => {
    expect(moveSelection([], columns, null, 'down', 10)).toBeNull()
  })
})

describe('typedKey', () => {
  it('takes printable characters only', () => {
    expect(typedKey(key('a'))).toBe('a')
    expect(typedKey(key('7'))).toBe('7')
    expect(typedKey(key('é'))).toBe('é')
    expect(typedKey(key(' '))).toBeNull()
    expect(typedKey(key('Tab'))).toBeNull()
    expect(typedKey(key('c', true))).toBeNull()
  })

  it('takes a character typed with AltGr, which Windows reports as Ctrl+Alt', () => {
    expect(typedKey(key('@', false, true))).toBe('@')
    expect(typedKey(key('€', false, true))).toBe('€')
    expect(typedKey({ ...key('q'), ctrlKey: true, altKey: true })).toBeNull()
  })
})
