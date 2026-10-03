import React, { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { parseIso } from '@ego/local/dates'
import { eventDays, inAllDayRow, scheduleDays, timeRangeLabel, weekdayShort } from '@ego/local/calendar/layout'
import { Blurred } from '../../lib/blur'
import { blockStyle, colorOf } from './ui'

function whenOnDay(event: CalendarEvent, day: string): string {
  if (event.allDay || inAllDayRow(event)) return 'All day'
  const { first, last } = eventDays(event)
  if (first !== last) {
    const [from, to] = timeRangeLabel(event).split(' – ')
    return day === first ? `From ${from}` : day === last ? `Until ${to}` : 'All day'
  }
  return timeRangeLabel(event)
}

/** Google's Schedule view: each day with something on it, one card per event. */
export function Schedule({ days, today, events, calendars, onOpen, bottomInset }: {
  days: string[]
  today: string
  events: CalendarEvent[]
  calendars: ReadonlyMap<string, CalendarInfo>
  onOpen: (event: CalendarEvent) => void
  bottomInset: number
}): React.ReactElement {
  const groups = useMemo(() => scheduleDays(events, days), [days, events])
  if (groups.length === 0) {
    return <View className="flex-1 items-center justify-center px-8">
      <Text className="text-center text-[16px] text-surface-400">Nothing scheduled in the next {days.length} days.</Text>
    </View>
  }
  return <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: bottomInset + 80 }}>
    {groups.map((group) => <View key={group.day} className="flex-row gap-3 border-b border-surface-900 py-2.5">
      <View className="w-12 items-center pt-1">
        <Text className="text-[11px] font-semibold uppercase text-surface-400">{weekdayShort(group.day)}</Text>
        <View className={`mt-0.5 h-8 w-8 items-center justify-center rounded-full ${group.day === today ? 'bg-white' : ''}`}>
          <Text className={`text-[17px] font-semibold ${group.day === today ? 'text-black' : 'text-foreground'}`}>{parseIso(group.day).getDate()}</Text>
        </View>
      </View>
      <View className="flex-1 gap-1.5">
        {group.events.map((event) => {
          const look = blockStyle(event, colorOf(event, calendars))
          return <Pressable key={event.key} accessibilityRole="button" onPress={() => onOpen(event)} style={[look.box, { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }]} className="active:opacity-80">
            <Blurred><Text numberOfLines={1} style={[look.text, { fontSize: 15, fontWeight: '600' }]}>{event.title || '(No title)'}</Text></Blurred>
            <Text numberOfLines={1} style={[look.text, { fontSize: 13, opacity: 0.85, textDecorationLine: 'none' }]}>
              {whenOnDay(event, group.day)}{event.location ? ` · ${event.location}` : ''}
            </Text>
          </Pressable>
        })}
      </View>
    </View>)}
  </ScrollView>
}
