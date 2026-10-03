import React, { useEffect, useId, useState } from 'react'
import type { CalendarEvent, CalendarInfo, CalendarScope } from '@ego/api-contracts'
import { DEFAULT_CALENDAR_COLOR, eventColorOf, textOn } from '@ego/core'
import { Button } from '../ui/button'
import { Modal } from '../ui/dialog'
import { UNDO_MS, type UndoAction } from '../../lib/calendar/context'
import { cn } from '../../lib/utils'

export function colorOf(event: CalendarEvent, calendars: ReadonlyMap<string, CalendarInfo>): string {
  return eventColorOf(event.colorId, calendars.get(`${event.accountId}/${event.calendarId}`)?.color ?? DEFAULT_CALENDAR_COLOR)
}

/**
 * How Google draws an event: a solid block once accepted, an outline while the invitation waits,
 * and struck through once declined or, for Ego's own items, done.
 */
export function blockStyle(event: CalendarEvent, color: string): { style: React.CSSProperties; className: string } {
  const waiting = event.response === 'needsAction' || event.response === 'tentative'
  const struck = event.response === 'declined' || (event.accountId === 'ego' && event.status === 'tentative')
  if (waiting || struck) {
    return {
      style: { backgroundColor: '#0a0a0a', borderColor: color, color },
      className: cn('border', struck && 'line-through opacity-60', event.response === 'tentative' && 'border-dashed')
    }
  }
  return { style: { backgroundColor: color, borderColor: color, color: textOn(color) }, className: 'border' }
}

export function ColorDot({ color, size = 10 }: { color: string; size?: number }): React.ReactElement {
  return <span className="inline-block shrink-0 rounded-full" style={{ backgroundColor: color, width: size, height: size }} />
}

const ALL_SCOPES: readonly CalendarScope[] = ['one', 'following', 'all']

const SCOPES: ReadonlyArray<{ scope: CalendarScope; label: string }> = [
  { scope: 'one', label: 'This event' },
  { scope: 'following', label: 'This and following events' },
  { scope: 'all', label: 'All events' }
]

/** Google's question for a repeating event: which occurrences the change covers. */
export function ScopeDialog({ visible, title, scopes = ALL_SCOPES, onCancel, onPick }: {
  visible: boolean
  title: string
  scopes?: readonly CalendarScope[]
  onCancel: () => void
  onPick: (scope: CalendarScope) => void
}): React.ReactElement | null {
  const titleId = useId()
  const [scope, setScope] = useState<CalendarScope>(scopes[0] ?? 'one')
  const firstScope = scopes[0] ?? 'one'
  useEffect(() => { if (visible) setScope(firstScope) }, [visible, firstScope])
  return <Modal visible={visible} onClose={onCancel} dismissOnBackdrop labelledBy={titleId} className="w-full max-w-sm rounded-3xl border border-surface-800 bg-card p-6">
    <h2 id={titleId} className="text-[20px] font-bold">{title}</h2>
    <div role="radiogroup" className="mt-4 flex flex-col gap-1">
      {SCOPES.filter((item) => scopes.includes(item.scope)).map((item) => <label key={item.scope} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-surface-900">
        <input type="radio" name={titleId} checked={scope === item.scope} onChange={() => setScope(item.scope)} className="h-4 w-4 accent-white" />
        <span className="text-[15px]">{item.label}</span>
      </label>)}
    </div>
    <div className="mt-5 flex gap-3">
      <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
      <Button data-autofocus onClick={() => onPick(scope)} className="flex-1">OK</Button>
    </div>
  </Modal>
}

/** "Event moved · Undo" along the bottom, like Google's, until it times out. */
export function UndoToast({ undo, onDismiss }: { undo: UndoAction | null; onDismiss: () => void }): React.ReactElement | null {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!undo) return
    setBusy(false)
    const timer = window.setTimeout(onDismiss, UNDO_MS)
    return () => window.clearTimeout(timer)
  }, [onDismiss, undo])
  if (!undo) return null
  return <div role="status" className="pointer-events-auto fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-2xl border border-surface-700 bg-surface-900 py-2 pl-5 pr-2 shadow-2xl">
    <span className="text-[15px]">{undo.label}</span>
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
      setBusy(true)
      void undo.run().finally(onDismiss)
    }}>Undo</Button>
  </div>
}
