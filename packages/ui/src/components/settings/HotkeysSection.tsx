import React, { useEffect, useState } from 'react'
import { Keyboard, RotateCcw } from 'lucide-react'
import { HOTKEY_ACTIONS, hotkeyOf, hotkeyParts, type HotkeyActionId } from '@ego/core'
import { useHotkeys } from '../../lib/hotkeys'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { Section, SectionNote } from '../Section'
import { Button } from '../ui/button'

export function KeyCaps({ combo, className }: { combo: string; className?: string }): React.ReactElement {
  return <span className={cn('inline-flex items-center gap-1', className)}>
    {hotkeyParts(combo).map((part, index) => <kbd
      key={`${part}-${index}`}
      className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-surface-700 bg-surface-800 px-1.5 font-sans text-[12px] font-semibold text-surface-100"
    >{part}</kbd>)}
  </span>
}

const GROUPS = [...new Set(HOTKEY_ACTIONS.map((action) => action.group))]

const FIXED: Array<{ label: string; combos: string[] }> = [
  { label: 'Next or previous card in focus mode', combos: ['ArrowDown', 'ArrowUp'] },
  { label: 'Leave focus mode', combos: ['Escape'] }
]

/**
 * Every shortcut with its key. A click on a key listens for the next press: Escape stops
 * listening, and Backspace or Delete takes the shortcut away.
 */
export function HotkeysSection(): React.ReactElement {
  const hotkeys = useHotkeys()
  const [recording, setRecording] = useState<HotkeyActionId | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setRecording(null)
        return
      }
      if (event.code === 'Backspace' || event.code === 'Delete') {
        hotkeys.setKey(recording, null)
        setRecording(null)
        setNote(null)
        return
      }
      const combo = hotkeyOf(event)
      if (!combo) return
      const taken = hotkeys.setKey(recording, combo)
      setRecording(null)
      const names = taken.map((id) => HOTKEY_ACTIONS.find((action) => action.id === id)?.label ?? id)
      setNote(names.length > 0 ? `${hotkeyParts(combo).join('+')} moved here from ${names.join(' and ')}.` : null)
    }
    const stop = (): void => setRecording(null)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', stop)
    }
  }, [hotkeys, recording])

  const changed = HOTKEY_ACTIONS.some((action) => hotkeys.keys[action.id] !== action.key)

  return <Section Icon={Keyboard} title="Keyboard shortcuts" right={changed
    ? <Button variant="ghost" size="sm" onClick={() => hotkeys.reset()} className="text-surface-300">Reset all</Button>
    : undefined}>
    <SectionNote>
      They act on the card under the mouse on a board, or the card in the middle of focus mode. Every computer and browser shares them.
    </SectionNote>
    {GROUPS.map((group) => <div key={group} className="mt-4">
      <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-surface-500">{group}</h3>
      {HOTKEY_ACTIONS.filter((action) => action.group === group).map((action) => {
        const combo = hotkeys.keys[action.id]
        const listening = recording === action.id
        return <div key={action.id} className="flex min-h-11 items-center gap-2 border-b border-surface-900">
          <span className="flex-1 text-[15px] text-foreground">{action.label}</span>
          {combo !== action.key && <button
            type="button"
            aria-label={`Put ${action.label} back to its default`}
            title="Back to the default"
            onClick={() => hotkeys.reset(action.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-800"
          ><RotateCcw color={color.textMuted} size={15} /></button>}
          <button
            type="button"
            aria-label={listening ? `Press a key for ${action.label}` : `Change the shortcut for ${action.label}`}
            onClick={() => {
              setNote(null)
              setRecording(listening ? null : action.id)
            }}
            className={cn('flex min-h-9 min-w-24 items-center justify-end rounded-lg px-2 transition-colors',
              listening ? 'bg-surface-800 ring-1 ring-surface-500' : 'hover:bg-surface-800')}
          >
            {listening
              ? <span className="text-[13px] font-semibold text-surface-200">Press a key</span>
              : combo
                ? <KeyCaps combo={combo} />
                : <span className="text-[13px] text-surface-500">None</span>}
          </button>
        </div>
      })}
    </div>)}
    {recording && <p className="mt-2 text-[13px] text-surface-400">Esc stops listening. Backspace removes the shortcut.</p>}
    {note && <p className="mt-2 text-[13px] text-attention">{note}</p>}
    <div className="mt-4">
      <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-surface-500">Fixed</h3>
      {FIXED.map((item) => <div key={item.label} className="flex min-h-11 items-center gap-2 border-b border-surface-900">
        <span className="flex-1 text-[15px] text-surface-300">{item.label}</span>
        <span className="flex items-center gap-1.5 px-2">{item.combos.map((combo) => <KeyCaps key={combo} combo={combo} />)}</span>
      </div>)}
    </div>
  </Section>
}
