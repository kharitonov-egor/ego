import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { WEEKDAYS, parseIso } from '@ego/local/dates'
import { heatLevel, type DayScore, type HeatLevel } from '@ego/local/habits/stats'

/** White at rising strength on the card: a sequential scale where only a finished day is solid. */
export const HEAT: Record<HeatLevel, string> = {
  0: '#1c1c1c',
  1: 'rgba(250, 250, 250, 0.16)',
  2: 'rgba(250, 250, 250, 0.34)',
  3: 'rgba(250, 250, 250, 0.58)',
  4: '#fafafa'
}
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
const DAY_TITLE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

export function MonthCalendar({ days, today, selected, onOpenDay }: {
  days: readonly DayScore[]
  today: string
  selected: string
  onOpenDay: (date: string) => void
}): React.ReactElement {
  const leading = days.length > 0 ? (parseIso(days[0].date).getDay() + 6) % 7 : 0
  const cells: (DayScore | null)[] = [...Array.from({ length: leading }, () => null), ...days]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
  return <View>
    <View className="flex-row">{MONDAY_FIRST.map((weekday) => <Text key={weekday} className="flex-1 text-center text-[13px] font-medium text-muted-foreground">{WEEKDAYS[weekday]}</Text>)}</View>
    <View className="mt-1.5 gap-1.5">{weeks.map((week, row) => <View key={row} className="flex-row gap-1.5">{week.map((day, column) => {
      if (day === null) return <View key={column} className="aspect-square flex-1" />
      const future = day.date > today
      const idle = !future && day.total === 0
      const level = heatLevel(day)
      const isSelected = day.date === selected
      return <Pressable
        key={column}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected, disabled: future || idle }}
        accessibilityLabel={`${DAY_TITLE.format(parseIso(day.date))}, ${future ? 'not yet' : idle ? 'nothing due' : `${day.done} of ${day.total} done`}`}
        accessibilityHint={future || idle ? undefined : 'Opens this day on Home'}
        disabled={future || idle}
        onPress={() => onOpenDay(day.date)}
        className="aspect-square flex-1 items-center justify-center rounded-lg"
        style={{
          backgroundColor: future || idle ? 'transparent' : HEAT[level],
          borderWidth: isSelected || day.date === today ? 2 : future || idle ? 1 : 0,
          borderColor: isSelected ? '#fafafa' : day.date === today ? '#737373' : '#262626'
        }}
      >
        <Text className={`text-[14px] font-semibold ${future || idle ? 'text-surface-600' : level === 4 ? 'text-primary-foreground' : level === 0 ? 'text-muted-foreground' : 'text-white'}`}>{parseIso(day.date).getDate()}</Text>
      </Pressable>
    })}</View>)}</View>
    <View className="mt-4 flex-row items-center justify-end gap-1.5">
      <Text className="mr-1 text-[13px] text-muted-foreground">Fewer</Text>
      {([0, 1, 2, 3, 4] as const).map((level) => <View key={level} className="h-3.5 w-3.5 rounded" style={{ backgroundColor: HEAT[level] }} />)}
      <Text className="ml-1 text-[13px] text-muted-foreground">All done</Text>
    </View>
  </View>
}
