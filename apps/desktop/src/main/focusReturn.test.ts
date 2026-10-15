import { beforeEach, describe, expect, it } from 'vitest'
import { focusReturn, type ForegroundWindowApi } from './focusReturn'

let foreground: unknown = null
let hidden: unknown[] = []
let focused: unknown[] = []

const windows = (): ForegroundWindowApi => ({
  get: () => foreground,
  isShown: (window) => !hidden.includes(window),
  focus: (window) => {
    focused.push(window)
  }
})

function overlay(isFocused: boolean): { isDestroyed: () => boolean; isFocused: () => boolean } {
  return { isDestroyed: () => false, isFocused: () => isFocused }
}

describe('focusReturn', () => {
  beforeEach(() => {
    foreground = 'chrome'
    hidden = []
    focused = []
  })

  it('gives focus back to the window that was in front when the overlay opened', () => {
    const focus = focusReturn(windows)
    focus.remember(null)
    focus.restore(overlay(true))
    expect(focused).toEqual(['chrome'])
  })

  it('keeps the first window when the hotkey fires again while the overlay is open', () => {
    const focus = focusReturn(windows)
    focus.remember(overlay(false))
    foreground = 'quick add'
    focus.remember(overlay(true))
    focus.restore(overlay(true))
    expect(focused).toEqual(['chrome'])
  })

  it('follows the user to the window they clicked while the overlay stayed open', () => {
    const focus = focusReturn(windows)
    focus.remember(null)
    foreground = 'slack'
    focus.remember()
    focus.restore(overlay(true))
    expect(focused).toEqual(['slack'])
  })

  it('leaves focus alone once the user has clicked into another window', () => {
    const focus = focusReturn(windows)
    focus.remember(null)
    focus.restore(overlay(false))
    expect(focused).toEqual([])
  })

  it('skips a window that has since been hidden or minimized', () => {
    const focus = focusReturn(windows)
    focus.remember(null)
    hidden = ['chrome']
    focus.restore(overlay(true))
    expect(focused).toEqual([])
  })

  it('gives focus back only once per opening', () => {
    const focus = focusReturn(windows)
    focus.remember(null)
    focus.restore(overlay(true))
    focus.restore(overlay(true))
    expect(focused).toEqual(['chrome'])
  })

  it('does nothing where user32 is unavailable', () => {
    const focus = focusReturn(() => null)
    focus.remember(null)
    focus.restore(overlay(true))
    expect(focused).toEqual([])
  })
})
