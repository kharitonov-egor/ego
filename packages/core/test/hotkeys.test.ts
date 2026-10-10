import { describe, expect, it } from 'vitest'
import { hotkeyOf, hotkeyParts, isHotkeyBindings, isHotkeyCombo, resolvedHotkeys } from '../src/hotkeys'

const press = (code: string, held: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...held
})

describe('keyboard shortcuts', () => {
  it('spells a press by its physical key, modifiers first, and ignores a modifier alone', () => {
    expect(hotkeyOf(press('KeyC'))).toBe('KeyC')
    expect(hotkeyOf(press('KeyL', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+KeyL')
    expect(hotkeyOf(press('ShiftLeft', { shiftKey: true }))).toBeNull()
    expect(hotkeyOf(press(''))).toBeNull()
  })

  it('reads a shortcut the way a person would', () => {
    expect(hotkeyParts('KeyC')).toEqual(['C'])
    expect(hotkeyParts('Shift+Digit1')).toEqual(['Shift', '1'])
    expect(hotkeyParts('ArrowDown')).toEqual(['↓'])
    expect(hotkeyParts('Escape')).toEqual(['Esc'])
  })

  it('fills in defaults and lets a saved null take a shortcut away', () => {
    const keys = resolvedHotkeys({ 'card.archive': 'KeyX', 'card.labels': null, 'card.label1': 'Digit1' })
    expect(keys['card.archive']).toBe('KeyX')
    expect(keys['card.labels']).toBeNull()
    expect(keys['card.label1']).toBe('Digit1')
    expect(keys['card.label2']).toBeNull()
    expect(keys['card.done']).toBe('Space')
  })

  it('accepts saved shortcuts from a newer build and refuses malformed ones', () => {
    expect(isHotkeyBindings({ 'board.someday': 'Alt+KeyS', 'card.archive': null })).toBe(true)
    expect(isHotkeyBindings({ 'card.archive': 'ctrl c' })).toBe(false)
    expect(isHotkeyBindings({ 'Not an id': 'KeyC' })).toBe(false)
    expect(isHotkeyBindings(['KeyC'])).toBe(false)
    expect(isHotkeyCombo('Ctrl+Alt+Shift+Meta+KeyK')).toBe(true)
    expect(isHotkeyCombo('Hyper+KeyK')).toBe(false)
  })
})
