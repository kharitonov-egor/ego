/**
 * Keyboard shortcuts, one per action, shared by every computer and browser. A shortcut is written
 * as its modifiers and the physical key, like `KeyC` or `Shift+KeyL`, so it stays on the same key
 * whatever the keyboard layout types there.
 */

export interface HotkeyAction {
  id: string
  label: string
  /** What the action works on, shown as a heading in Settings. */
  group: string
  key: string | null
}

const LABEL_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export const HOTKEY_ACTIONS = [
  { id: 'card.archive', label: 'Archive card', group: 'Cards', key: 'KeyC' },
  { id: 'card.labels', label: 'Edit labels', group: 'Cards', key: 'KeyL' },
  { id: 'card.done', label: 'Mark done', group: 'Cards', key: 'Space' },
  { id: 'card.open', label: 'Open card', group: 'Cards', key: 'Enter' },
  ...LABEL_SLOTS.map((slot) => ({ id: `card.label${slot}`, label: `Toggle label ${slot}`, group: 'Labels', key: null }))
] as const satisfies readonly HotkeyAction[]

export type HotkeyActionId = typeof HOTKEY_ACTIONS[number]['id']

/** Only the shortcuts changed from their defaults. `null` takes an action's shortcut away. */
export type HotkeyBindings = Partial<Record<string, string | null>>

export type ResolvedHotkeys = Record<HotkeyActionId, string | null>

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const
const COMBO = /^(?:(?:Ctrl|Alt|Shift|Meta)\+)*[A-Za-z][A-Za-z0-9]{0,23}$/
const ACTION_ID = /^[a-z][A-Za-z0-9.]{0,39}$/
const BINDINGS_LIMIT = 100
/** Keys that only modify another key, so pressing one alone records nothing. */
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight', 'CapsLock'])

export function isHotkeyCombo(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 48 && COMBO.test(value)
}

/** Unknown action ids pass, so a newer build's shortcuts survive a save from an older one. */
export function isHotkeyBindings(value: unknown): value is HotkeyBindings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= BINDINGS_LIMIT &&
    entries.every(([id, combo]) => ACTION_ID.test(id) && (combo === null || isHotkeyCombo(combo)))
}

export function resolvedHotkeys(saved: HotkeyBindings): ResolvedHotkeys {
  const resolved = {} as ResolvedHotkeys
  for (const action of HOTKEY_ACTIONS) {
    const chosen = saved[action.id]
    resolved[action.id] = chosen === undefined ? action.key : chosen
  }
  return resolved
}

export interface KeyPress {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** The shortcut a key press spells, or null for a modifier pressed alone. */
export function hotkeyOf(press: KeyPress): string | null {
  if (MODIFIER_CODES.has(press.code) || !/^[A-Za-z][A-Za-z0-9]*$/.test(press.code)) return null
  const held = [press.ctrlKey && 'Ctrl', press.altKey && 'Alt', press.shiftKey && 'Shift', press.metaKey && 'Meta']
  return [...held.filter((name): name is typeof MODIFIERS[number] => typeof name === 'string'), press.code].join('+')
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[',
  BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`'
}

function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`
  return KEY_NAMES[code] ?? code
}

/** The parts of a shortcut as a person reads them, like `['Shift', 'L']`. */
export function hotkeyParts(combo: string): string[] {
  const parts = combo.split('+')
  const code = parts.pop() ?? ''
  return [...parts, keyName(code)]
}
