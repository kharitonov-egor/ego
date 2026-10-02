import { describe, expect, it } from 'vitest'
import { inputScrollDelta, keyboardOverlap } from '../lib/keyboard-layout'

describe('keyboard space', () => {
  it('lifts an edge-to-edge screen above the keyboard', () => {
    expect(keyboardOverlap(0, 844, 510)).toBe(334)
  })

  it('does not add a second gap when Android already resized the window', () => {
    expect(keyboardOverlap(0, 510, 510)).toBe(0)
    expect(keyboardOverlap(80, 430, 510)).toBe(0)
  })

  it('accounts for headers and space already below the view', () => {
    expect(keyboardOverlap(80, 730, 510)).toBe(300)
  })

  it('does not move content for a hidden or hardware keyboard', () => {
    expect(keyboardOverlap(0, 844, 844)).toBe(0)
    expect(keyboardOverlap(0, 844, 900)).toBe(0)
  })

  it('caps the gap at the available height', () => {
    expect(keyboardOverlap(500, 200, 400)).toBe(200)
  })
})

describe('focused field scrolling', () => {
  it('reveals a bottom field with room above the keyboard', () => {
    const delta = inputScrollDelta(620, 52, 100, 510)
    expect(delta).toBe(174)
    expect(620 + 52 - delta).toBe(510 - 12)
  })

  it('uses the sheet viewport when it ends above the keyboard', () => {
    expect(inputScrollDelta(450, 52, 200, 480)).toBe(34)
  })

  it('leaves a visible field in place when changing focus', () => {
    expect(inputScrollDelta(300, 52, 100, 510)).toBe(0)
  })

  it('scrolls back to a field above the current viewport', () => {
    expect(inputScrollDelta(80, 52, 100, 510)).toBe(-32)
  })

  it('keeps the start of an oversized field visible', () => {
    expect(inputScrollDelta(200, 700, 100, 510)).toBe(88)
    expect(inputScrollDelta(112, 700, 100, 510)).toBe(0)
  })

  it('ignores an unavailable viewport during layout', () => {
    expect(inputScrollDelta(200, 52, 100, 100)).toBe(0)
  })
})
