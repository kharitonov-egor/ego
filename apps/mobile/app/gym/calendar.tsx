import React, { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, ScrollView, View, type ViewToken } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react-native'
import { color } from '../../components/money/tokens'
import { Dot, GymGate, HeaderIcon } from '../../components/gym/ui'
import { Text } from '../../components/ui/text'
import { isoFromParts, isoToday, shiftMonth } from '../../lib/dates'
import { useGym, useGymQuery } from '../../lib/gym-context'
import { gymCalendar } from '../../lib/repositories/gym'

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const TITLE_HEIGHT = 56
const WEEKDAY_HEIGHT = 32
const WEEK_HEIGHT = 56
const MONTH_GAP = 12
const FUTURE_MONTHS = 6
const PAST_MONTHS = 12

/** Weeks start on Monday, the way the FitNotes calendar lays them out. */
function mondayGrid(month: string): (number | null)[][] {
  const [year, index] = month.split('-').map(Number)
  const leading = (new Date(year, index - 1, 1).getDay() + 6) % 7
  const days = new Date(year, index, 0).getDate()
  const cells: (number | null)[] = [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, day) => day + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
}

function monthHeight(month: string): number {
  return TITLE_HEIGHT + WEEKDAY_HEIGHT + mondayGrid(month).length * WEEK_HEIGHT + MONTH_GAP
}

function monthTitle(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return new Date(year, index - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
}

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = []
  for (let month = first; month <= last; month = shiftMonth(month, 1)) months.push(month)
  return months
}

const MonthBlock = React.memo(function MonthBlock({ month, selected, today, colors, onPick }: {
  month: string
  selected: string
  today: string
  colors: Map<string, string[]>
  onPick: (iso: string) => void
}): React.ReactElement {
  const [year, index] = month.split('-').map(Number)
  return <View style={{ height: monthHeight(month) }}>
    <View style={{ height: TITLE_HEIGHT }} className="items-center justify-center">
      <Text accessibilityRole="header" className="text-[18px] font-semibold">{monthTitle(month)}</Text>
    </View>
    <View style={{ height: WEEKDAY_HEIGHT }} className="flex-row items-center">
      {WEEKDAYS.map((day) => <Text key={day} className="flex-1 text-center text-[13px] font-medium text-muted-foreground">{day}</Text>)}
    </View>
    {mondayGrid(month).map((week, row) => <View key={row} style={{ height: WEEK_HEIGHT }} className="flex-row">
      {week.map((day, column) => {
        if (day === null) return <View key={column} className="flex-1" />
        const iso = isoFromParts(year, index - 1, day)
        const dots = colors.get(iso) ?? []
        const isSelected = iso === selected
        const isToday = iso === today
        return <Pressable
          key={column}
          accessibilityRole="button"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={`${new Date(year, index - 1, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${dots.length > 0 ? ', workout logged' : ''}`}
          onPress={() => onPick(iso)}
          className="flex-1 items-center pt-1.5"
        >
          <View className={`h-9 w-9 items-center justify-center rounded-full ${isSelected ? 'bg-primary' : ''}`}>
            <Text className={`text-[17px] ${isSelected ? 'font-bold text-primary-foreground' : isToday ? 'font-bold text-foreground' : 'text-surface-400'}`}>{day}</Text>
          </View>
          <View className="mt-1 h-2 flex-row gap-[3px]">
            {dots.slice(0, 5).map((dot, dotIndex) => <Dot key={dotIndex} color={dot} size={7} />)}
          </View>
        </Pressable>
      })}
    </View>)}
  </View>
})

function CalendarBody(): React.ReactElement {
  const gym = useGym()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const days = useGymQuery((db) => gymCalendar(db), [])
  const list = useRef<FlatList<string>>(null)
  const [visible, setVisible] = useState(0)
  const today = isoToday()

  const colors = useMemo(() => new Map((days ?? []).map((day) => [day.date, day.colors])), [days])
  const months = useMemo(() => {
    const current = today.slice(0, 7)
    const earliest = days && days.length > 0 ? days[0].date.slice(0, 7) : current
    const back = shiftMonth(current, -PAST_MONTHS)
    return monthsBetween(earliest < back ? earliest : back, shiftMonth(current, FUTURE_MONTHS))
  }, [days, today])
  const offsets = useMemo(() => {
    let total = 0
    return months.map((month) => {
      const start = total
      total += monthHeight(month)
      return start
    })
  }, [months])
  const initialIndex = Math.max(0, months.indexOf(gym.date.slice(0, 7)))

  const pick = useCallback((iso: string) => {
    gym.setDate(iso)
    router.back()
  }, [gym.setDate, router])

  const scrollTo = (index: number): void => {
    const target = Math.max(0, Math.min(months.length - 1, index))
    list.current?.scrollToIndex({ index: target, animated: true })
  }

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<string>[] }) => {
    const first = viewableItems[0]?.index
    if (typeof first === 'number') setVisible(first)
  }).current

  if (!days) return <View className="flex-1" />
  const legend = gym.categories.filter((category) => category.exerciseCount > 0)

  return <View className="flex-1">
    {legend.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} className="max-h-12 flex-grow-0 border-b border-border" contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 16, gap: 16 }}>
      {legend.map((category) => <View key={category.id} className="h-12 flex-row items-center gap-1.5">
        <Dot color={category.color} size={8} />
        <Text className="text-[14px] text-muted-foreground">{category.name}</Text>
      </View>)}
    </ScrollView>}
    <FlatList
      ref={list}
      data={months}
      keyExtractor={(month) => month}
      initialScrollIndex={initialIndex}
      getItemLayout={(_, index) => ({ length: monthHeight(months[index]), offset: offsets[index], index })}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={{ itemVisiblePercentThreshold: 30 }}
      windowSize={5}
      contentContainerStyle={{ paddingHorizontal: 8 }}
      renderItem={({ item }) => <MonthBlock month={item} selected={gym.date} today={today} colors={colors} onPick={pick} />}
    />
    <View style={{ paddingBottom: insets.bottom }} className="flex-row items-center border-t border-border bg-card">
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => scrollTo(visible - 1)} className="h-14 w-16 items-center justify-center active:bg-surface-800">
        <ChevronLeft color={color.text} size={24} />
      </Pressable>
      <Text className="flex-1 text-center text-[15px] font-bold tracking-wide text-surface-200">{`${days.length} ${days.length === 1 ? 'WORKOUT' : 'WORKOUTS'}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => scrollTo(visible + 1)} className="h-14 w-16 items-center justify-center active:bg-surface-800">
        <ChevronRight color={color.text} size={24} />
      </Pressable>
    </View>
  </View>
}

export default function GymCalendar(): React.ReactElement {
  const gym = useGym()
  const router = useRouter()
  return <>
    <Stack.Screen options={{
      title: 'Calendar',
      headerRight: () => <HeaderIcon label="Go to today" onPress={() => {
        gym.setDate(isoToday())
        router.back()
      }}><CalendarCheck color={color.textSecondary} size={21} /></HeaderIcon>
    }} />
    <GymGate><CalendarBody /></GymGate>
  </>
}
