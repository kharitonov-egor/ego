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
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-[15px] transition-colors ${
        listening
          ? 'border-surface-300 bg-surface-800'
          : 'border-input bg-surface-900 hover:border-surface-600'
      }`}
    >
      <Keyboard size={16} className="shrink-0 text-surface-400" />
      {listening ? (
        <span className="animate-pulse text-foreground">Press a shortcut (e.g. F2 or Ctrl+Shift+Space)...</span>
      ) : value ? (
        <div className="flex items-center gap-1.5 flex-1">
          {value.split('+').map((part, i) => (
            <kbd
              key={i}
              className="rounded-md bg-surface-700 px-2 py-0.5 font-mono text-[13px] text-surface-100"
            >
              {part}
            </kbd>
          ))}
          <button
            type="button"
            aria-label="Clear hotkey"
            onClick={clear}
            className="ml-auto text-surface-500 transition-colors hover:text-surface-200"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <span className="text-surface-500">Click to set hotkey</span>
      )}
    </div>
  )
}
