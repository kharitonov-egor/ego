import React, { useMemo, useState } from 'react'
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { parseIso } from '@ego/local/dates'
import { inAllDayRow, layoutSpans, monthWeeks, weekdayShort } from '@ego/local/calendar/layout'
import { Blurred } from '../../lib/blur'
import { blockStyle, colorOf } from './ui'

const LINE = 15
const HEADER = 24

/** Google's month view on a phone: tiny bars per day, and a tap on a day opens it. */
export function MonthGrid({ anchor, today, events, calendars, onOpenDay }: {
  anchor: string
  today: string
  events: CalendarEvent[]
  calendars: ReadonlyMap<string, CalendarInfo>
  onOpenDay: (day: string) => void
}): React.ReactElement {
  const weeks = useMemo(() => monthWeeks(anchor), [anchor])
  const month = anchor.slice(0, 7)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const rowHeight = size.height / weeks.length
  const column = size.width / 7
  const fits = Math.max(1, Math.floor((rowHeight - HEADER - 2) / LINE))
  const rows = useMemo(() => weeks.map((week) => layoutSpans(events, week, { includeTimed: true })), [events, weeks])

  return <View className="flex-1">
    <View className="flex-row border-b border-border">
      {weeks[0].map((day) => <Text key={day} className="flex-1 py-1.5 text-center text-[11px] font-semibold uppercase text-surface-500">{weekdayShort(day).charAt(0)}</Text>)}
    </View>
    <View className="flex-1" onLayout={(event: LayoutChangeEvent) => setSize(event.nativeEvent.layout)}>
      {size.height > 0 && weeks.map((week, row) => {
        const layout = rows[row]
        const lanes = layout.lanes > fits ? fits - 1 : fits
        return <View key={week[0]} style={{ height: rowHeight }} className="flex-row border-b border-border">
          {week.map((day, index) => {
            const hidden = layout.items.filter((item) => item.lane >= lanes && item.startIndex <= index && item.endIndex >= index).length
            const inMonth = day.slice(0, 7) === month
            return <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={parseIso(day).toDateString()}
              onPress={() => onOpenDay(day)}
              className={`flex-1 items-center border-l border-border active:bg-surface-900 ${inMonth ? '' : 'bg-surface-900/40'}`}
            >
              <View className={`mt-1 h-5 min-w-5 items-center justify-center rounded-full px-1 ${day === today ? 'bg-white' : ''}`}>
                <Text className={`text-[11px] font-semibold ${day === today ? 'text-black' : inMonth ? 'text-surface-200' : 'text-surface-600'}`}>{parseIso(day).getDate()}</Text>
              </View>
              {hidden > 0 && <Text style={{ position: 'absolute', top: HEADER + lanes * LINE }} className="text-[10px] font-semibold text-surface-400">+{hidden}</Text>}
            </Pressable>
          })}
          {column > 0 && layout.items.filter((item) => item.lane < lanes).map((item) => {
            const color = colorOf(item.event, calendars)
            const look = blockStyle(item.event, color)
            const bar = inAllDayRow(item.event) || item.endIndex > item.startIndex
            return <View
              key={item.event.key}
              pointerEvents="none"
              style={[bar ? look.box : { backgroundColor: 'transparent' }, {
                position: 'absolute', top: HEADER + item.lane * LINE, height: LINE - 2, borderRadius: 3,
                left: item.startIndex * column + 1, width: (item.endIndex - item.startIndex + 1) * column - 2,
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, overflow: 'hidden'
              }]}
            >
              {!bar && <View style={{ width: 4, height: 4, borderRadius: 2, marginRight: 2, backgroundColor: color }} />}
              <Blurred><Text numberOfLines={1} style={[bar ? look.text : { color: '#e5e5e5' }, { fontSize: 9, fontWeight: '600' }]}>{item.event.title || '(No title)'}</Text></Blurred>
            </View>
          })}
        </View>
      })}
    </View>
  </View>
}
