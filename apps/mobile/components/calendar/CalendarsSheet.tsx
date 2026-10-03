import React, { useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import { Check, Palette, Plus, RefreshCw, TriangleAlert, Unplug } from 'lucide-react-native'
import type { CalendarAccount, CalendarInfo } from '@ego/api-contracts'
import { CALENDAR_COLORS } from '@ego/core'
import { timeAgo } from '@ego/local/dates'
import { BottomSheet } from '../money/Common'
import { ColorDot } from './ui'

/** Google Calendar's calendar list: tick what shows, pick colors, and manage accounts. */
export function CalendarsSheet({ visible, accounts, calendars, overlay, refreshing, fetchedAt, connecting, onClose, onToggle, onColor, onOverlay, onRefresh, onConnect, onDisconnect }: {
  visible: boolean
  accounts: readonly CalendarAccount[]
  calendars: readonly CalendarInfo[]
  overlay: boolean
  refreshing: boolean
  fetchedAt: string | null
  connecting: boolean
  onClose: () => void
  onToggle: (calendar: CalendarInfo, selected: boolean) => void
  onColor: (calendar: CalendarInfo, colorId: string) => void
  onOverlay: (on: boolean) => void
  onRefresh: () => void
  onConnect: (another: boolean) => void
  onDisconnect: (account: CalendarAccount) => void
}): React.ReactElement {
  const [coloring, setColoring] = useState<CalendarInfo | null>(null)
  return <>
    <BottomSheet visible={visible && coloring === null} title="Calendars" onClose={onClose} dismissOnBackdrop>
      {accounts.map((account) => <View key={account.id} className="mb-4">
        <View className="flex-row items-center">
          <Text numberOfLines={1} className="flex-1 text-[14px] font-semibold text-surface-400">{account.id}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${account.id}`} onPress={() => onDisconnect(account)} hitSlop={8} className="p-2"><Unplug color="#737373" size={17} /></Pressable>
        </View>
        {!account.connected && <Pressable onPress={() => onConnect(true)} className="mt-1 flex-row items-start gap-2 rounded-xl bg-surface-900 px-3 py-2">
          <TriangleAlert color="#fbbf24" size={15} />
          <Text className="flex-1 text-[14px] text-attention">Access ended. Tap to connect this account again.</Text>
        </Pressable>}
        {account.connected && account.lastError && <Text className="mt-1 text-[13px] leading-4 text-surface-500">{account.lastError}</Text>}
        {calendars.filter((calendar) => calendar.accountId === account.id)
          .sort((left, right) => Number(right.primary) - Number(left.primary) || left.name.localeCompare(right.name))
          .map((calendar) => <View key={calendar.key} className="min-h-12 flex-row items-center">
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: calendar.selected }} onPress={() => onToggle(calendar, !calendar.selected)}
              className="flex-1 flex-row items-center gap-3 py-2 active:opacity-70">
              <View className="h-6 w-6 items-center justify-center rounded-md" style={{ backgroundColor: calendar.selected ? calendar.color : 'transparent', borderWidth: 2, borderColor: calendar.color }}>
                {calendar.selected && <Check color="#0a0a0a" size={15} strokeWidth={3} />}
              </View>
              <Text numberOfLines={1} className={`flex-1 text-[16px] ${calendar.selected ? 'text-foreground' : 'text-surface-400'}`}>{calendar.name}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`${calendar.name} color`} onPress={() => setColoring(calendar)} hitSlop={6} className="p-2"><Palette color="#737373" size={17} /></Pressable>
          </View>)}
      </View>)}
      <Pressable disabled={connecting} onPress={() => onConnect(accounts.length > 0)} className="min-h-12 flex-row items-center gap-3 active:opacity-70">
        <Plus color="#fafafa" size={19} />
        <Text className="text-[16px] font-semibold text-foreground">{accounts.length > 0 ? 'Add a Google account' : 'Connect Google Calendar'}</Text>
      </Pressable>
      <View className="mt-2 min-h-14 flex-row items-center border-t border-surface-900">
        <Text className="flex-1 text-[16px] text-foreground">Show Tasks, Study, and Gym</Text>
        <Switch accessibilityLabel="Show Tasks, Study, and Gym" value={overlay} onValueChange={onOverlay}
          trackColor={{ false: '#404040', true: '#fafafa' }} thumbColor={overlay ? '#0a0a0a' : '#d4d4d4'} ios_backgroundColor="#404040" />
      </View>
      <Pressable onPress={onRefresh} className="mt-1 flex-row items-center gap-2 py-2">
        <RefreshCw color="#737373" size={14} />
        <Text className="text-[13px] text-surface-500">{refreshing ? 'Syncing with Google...' : fetchedAt ? `Synced ${timeAgo(fetchedAt, new Date())}` : 'Not synced yet'}</Text>
      </Pressable>
    </BottomSheet>
    <BottomSheet visible={coloring !== null} title={coloring?.name ?? ''} onClose={() => setColoring(null)} dismissOnBackdrop>
      <View className="flex-row flex-wrap gap-3">
        {Object.entries(CALENDAR_COLORS).map(([id, named]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={named.name} onPress={() => {
          if (coloring) onColor(coloring, id)
          setColoring(null)
        }} className={`h-12 w-12 items-center justify-center rounded-full ${coloring?.colorId === id ? 'border-2 border-white' : ''}`}>
          <ColorDot color={named.hex} size={34} />
        </Pressable>)}
      </View>
    </BottomSheet>
  </>
}
