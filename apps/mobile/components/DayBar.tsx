import React from 'react'
import { Pressable, View } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { formatIso, parseIso, shiftIso } from '@ego/local/dates'
import { Button } from './ui/button'
import { Text } from './ui/text'

/** Today, Yesterday, or the weekday, with arrows either side and the calendar behind the title. */
export function DayBar({ date, today, onPick, onOpenCalendar }: {
  date: string
  today: string
  onPick: (iso: string) => void
  onOpenCalendar: () => void
}): React.ReactElement {
  const title = date === today ? 'Today'
    : date === shiftIso(today, -1) ? 'Yesterday'
      : parseIso(date).toLocaleDateString('en-US', { weekday: 'long' })
  return <View className="flex-row items-center">
    <Button variant="ghost" size="icon" accessibilityLabel="Previous day" onPress={() => onPick(shiftIso(date, -1))}>
      <ChevronLeft color="#fafafa" size={22} />
    </Button>
    <View className="flex-1 items-center">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${formatIso(date)}`}
        accessibilityHint="Opens the calendar"
        onPress={onOpenCalendar}
        hitSlop={8}
        className="items-center"
      >
        <Text accessibilityLiveRegion="polite" className="text-[22px] font-bold tracking-tight">{title}</Text>
        <Text className="mt-0.5 text-[14px] text-muted-foreground">{formatIso(date)}</Text>
      </Pressable>
      {date !== today && <Pressable accessibilityRole="button" onPress={() => onPick(today)} hitSlop={10} className="mt-1">
        <Text className="text-[14px] font-semibold underline">Back to today</Text>
      </Pressable>}
    </View>
    <Button variant="ghost" size="icon" accessibilityLabel="Next day" disabled={date >= today} onPress={() => onPick(shiftIso(date, 1))}>
      <ChevronRight color="#fafafa" size={22} />
    </Button>
  </View>
}
