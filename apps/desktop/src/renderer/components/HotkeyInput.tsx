import React, { useState, useCallback, useRef } from 'react'
import { Keyboard, X } from 'lucide-react'

interface HotkeyInputProps {
  value: string
  onChange: (hotkey: string) => void
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

/** Prefer e.code so F2–F24 register reliably (e.key alone can vary). */
function physicalHotkeyKey(e: React.KeyboardEvent): string {
  if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) {
    return e.code
  }
  if (e.key === ' ') {
    return 'Space'
  }
  if (e.key.length === 1) {
    return e.key.toUpperCase()
  }
  return e.key
}

export default function HotkeyInput({ value, onChange }: HotkeyInputProps): React.ReactElement {
  const [listening, setListening] = useState(false)
  const inputRef = useRef<HTMLDivElement>(null)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!listening) return
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setListening(false)
        return
      }

      if (MODIFIER_KEYS.has(e.key)) return

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Super')

      parts.push(physicalHotkeyKey(e))
      const hotkey = parts.join('+')

      onChange(hotkey)
      setListening(false)
    },
    [listening, onChange]
  )

  const clear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange('')
    },
    [onChange]
  )

  return (
    <div
      ref={inputRef}
      tabIndex={0}
      onClick={() => setListening(true)}
      onKeyDown={handleKeyDown}
      onBlur={() => setListening(false)}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm ${
        listening
          ? 'border-accent-500 bg-surface-800 ring-1 ring-accent-500/30'
          : 'border-surface-700 bg-surface-800/50 hover:border-surface-600'
      }`}
    >
      <Keyboard size={14} className="text-surface-400 shrink-0" />
      {listening ? (
        <span className="text-accent-400 animate-pulse">Press a shortcut (e.g. F2 or Ctrl+Shift+Space)...</span>
      ) : value ? (
        <div className="flex items-center gap-1.5 flex-1">
          {value.split('+').map((part, i) => (
            <kbd
              key={i}
              className="px-1.5 py-0.5 rounded bg-surface-700 text-surface-200 text-xs font-mono"
            >
              {part}
            </kbd>
          ))}
          <button
            onClick={clear}
            className="ml-auto text-surface-500 hover:text-surface-300 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <span className="text-surface-500">Click to set hotkey</span>
      )}
    </div>
  )
}
