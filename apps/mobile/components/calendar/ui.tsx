import React, { useEffect, useState } from 'react'
import { Pressable, Text, View, type TextStyle, type ViewStyle } from 'react-native'
import type { CalendarEvent, CalendarInfo, CalendarScope } from '@ego/api-contracts'
import { DEFAULT_CALENDAR_COLOR, eventColorOf, textOn } from '@ego/core'
import { UNDO_MS, type UndoAction } from '../../lib/calendar/context'
import { BottomSheet } from '../money/Common'

export function colorOf(event: CalendarEvent, calendars: ReadonlyMap<string, CalendarInfo>): string {
  return eventColorOf(event.colorId, calendars.get(`${event.accountId}/${event.calendarId}`)?.color ?? DEFAULT_CALENDAR_COLOR)
}

/**
 * How Google draws an event: a solid block once accepted, an outline while the invitation waits,
 * and struck through once declined or, for Ego's own items, done.
 */
export function blockStyle(event: CalendarEvent, color: string): { box: ViewStyle; text: TextStyle } {
  const waiting = event.response === 'needsAction' || event.response === 'tentative'
  const struck = event.response === 'declined' || (event.accountId === 'ego' && event.status === 'tentative')
  if (waiting || struck) {
    return {
      box: { backgroundColor: '#0a0a0a', borderColor: color, borderWidth: 1, borderStyle: event.response === 'tentative' ? 'dashed' : 'solid', opacity: struck ? 0.6 : 1 },
      text: { color, textDecorationLine: struck ? 'line-through' : 'none' }
    }
  }
  return { box: { backgroundColor: color, borderColor: color, borderWidth: 1 }, text: { color: textOn(color) } }
}

export function ColorDot({ color, size = 10 }: { color: string; size?: number }): React.ReactElement {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
}

const SCOPES: ReadonlyArray<{ scope: CalendarScope; label: string }> = [
  { scope: 'one', label: 'This event' },
  { scope: 'following', label: 'This and following events' },
  { scope: 'all', label: 'All events' }
]

/** Google's question for a repeating event: which occurrences the change covers. */
export function ScopeSheet({ visible, title, scopes, onCancel, onPick }: {
  visible: boolean
  title: string
  scopes: readonly CalendarScope[]
  onCancel: () => void
  onPick: (scope: CalendarScope) => void
}): React.ReactElement {
  return <BottomSheet visible={visible} title={title} onClose={onCancel} dismissOnBackdrop>
    {SCOPES.filter((item) => scopes.includes(item.scope)).map((item) => <Pressable
      key={item.scope}
      accessibilityRole="button"
      onPress={() => onPick(item.scope)}
      className="min-h-14 flex-row items-center border-b border-surface-900 active:bg-surface-900"
    ><Text className="text-[17px] text-foreground">{item.label}</Text></Pressable>)}
  </BottomSheet>
}

/** "Event moved · Undo" above the bottom edge, like Google's, until it times out. */
export function UndoBar({ undo, bottom, onDismiss }: { undo: UndoAction | null; bottom: number; onDismiss: () => void }): React.ReactElement | null {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!undo) return
    setBusy(false)
    const timer = setTimeout(onDismiss, UNDO_MS)
    return () => clearTimeout(timer)
  }, [onDismiss, undo])
  if (!undo) return null
  return <View className="absolute left-4 right-4 flex-row items-center rounded-2xl border border-surface-700 bg-surface-900 py-1.5 pl-5 pr-1.5" style={{ bottom }}>
    <Text className="flex-1 text-[16px] text-foreground">{undo.label}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
      setBusy(true)
      void undo.run().finally(onDismiss)
    }} className="min-h-11 justify-center rounded-xl px-4 active:bg-surface-800">
      <Text className="text-[16px] font-semibold text-sky-300">Undo</Text>
    </Pressable>
  </View>
}
