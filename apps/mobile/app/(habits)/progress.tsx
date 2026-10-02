import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CalendarDays, ChevronLeft, ChevronRight, Flame, Trophy, X } from 'lucide-react-native'
import { MonthCalendar } from '../../components/habits/MonthCalendar'
import { HabitIcon, HabitsError, HabitsGate, HabitsMessage, StatTile, plural } from '../../components/habits/ui'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { formatMonth, shiftMonth } from '../../lib/dates'
import { useHabits } from '../../lib/habits/context'
import { BlurBlob, BlurSpan, Blurred, useBlur } from '../../lib/blur'
import { habitRates, monthSummary, streaks } from '../../lib/habits/stats'

function percent(done: number, possible: number): number {
  return possible === 0 ? 0 : Math.round((done / possible) * 100)
}

function Bar({ share, thin = false }: { share: number; thin?: boolean }): React.ReactElement {
  return <View className={`${thin ? 'h-1' : 'h-2'} overflow-hidden rounded-full bg-surface-800`}>
    <View className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
  </View>
}

function ProgressBody(): React.ReactElement {
  const habits = useHabits()
  const { blurred } = useBlur()
  const router = useRouter()
  const { log, today } = habits
  const current = today.slice(0, 7)
  const [month, setMonth] = useState(current)
  const [focus, setFocus] = useState<string | null>(null)
  const building = useMemo(() => (habits.habits ?? []).filter((habit) => habit.kind === 'build'), [habits.habits])
  const focused = building.find((habit) => habit.id === focus) ?? null
  const first = building.reduce((earliest, habit) => habit.startDate.slice(0, 7) < earliest ? habit.startDate.slice(0, 7) : earliest, current)

  const summary = useMemo(() => monthSummary(building, log, month, today, focused?.id ?? null), [building, focused, log, month, today])
  const runs = useMemo(() => streaks(focused ? [focused] : building, log, today), [building, focused, log, today])
  const rates = useMemo(() => habitRates(building, log, month, today), [building, log, month, today])

  if (building.length === 0) {
    return <HabitsMessage
      Icon={CalendarDays}
      title="Nothing to show yet"
      detail="Add a habit on Home. Each day you check things off lights up here."
    />
  }

  const step = (delta: -1 | 1): void => setMonth((value) => shiftMonth(value, delta))
  const canStep = (delta: -1 | 1): boolean => delta === -1 ? month > first : month < current
  const rate = percent(summary.done, summary.possible)

  return <PeriodSwipe onStep={step} canStep={canStep}>
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
      <HabitsError />
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" accessibilityState={{ disabled: !canStep(-1) }} disabled={!canStep(-1)} onPress={() => step(-1)} hitSlop={8} className={`h-11 w-11 items-center justify-center rounded-full active:bg-surface-800 ${canStep(-1) ? '' : 'opacity-30'}`}>
          <ChevronLeft color="#fafafa" size={22} />
        </Pressable>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="text-[20px] font-bold tracking-tight text-foreground">{formatMonth(month)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" accessibilityState={{ disabled: !canStep(1) }} disabled={!canStep(1)} onPress={() => step(1)} hitSlop={8} className={`h-11 w-11 items-center justify-center rounded-full active:bg-surface-800 ${canStep(1) ? '' : 'opacity-30'}`}>
          <ChevronRight color="#fafafa" size={22} />
        </Pressable>
      </View>

      <Card className="border-0">
        <CardContent>
          <View className="flex-row items-end justify-between">
            <Text className="text-[40px] font-bold tracking-tight text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{`${rate}%`}</Text>
            <Text className="mb-2 text-[15px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
              {summary.possible === 0 ? 'Nothing due yet' : `${summary.done} of ${summary.possible} targets met`}
            </Text>
          </View>
          <View className="mt-3" accessible accessibilityRole="progressbar" accessibilityLabel={`${rate} percent of ${focused ? focused.name : 'habits'} done in ${formatMonth(month)}`}>
            <Bar share={summary.possible === 0 ? 0 : summary.done / summary.possible} />
          </View>
        </CardContent>
      </Card>

      <Card className="border-0">
        <CardContent>
          {focused && <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Showing ${focused.name}. Show all habits`}
            onPress={() => setFocus(null)}
            className="mb-4 flex-row items-center self-start rounded-full bg-primary py-1.5 pl-3 pr-2.5"
          >
            {blurred ? <BlurBlob size={14} tint="#0a0a0a" /> : <Text className="text-[14px] text-primary-foreground">{focused.icon}</Text>}
            <Blurred tint="#0a0a0a"><Text className="ml-1.5 text-[14px] font-semibold text-primary-foreground">{focused.name}</Text></Blurred>
            <X color="#0a0a0a" size={15} style={{ marginLeft: 6 }} />
          </Pressable>}
          <MonthCalendar
            days={summary.days}
            today={today}
            selected={habits.date}
            onOpenDay={(date) => {
              habits.setDate(date)
              router.navigate('/(habits)/home')
            }}
          />
        </CardContent>
      </Card>

      <View className="flex-row gap-3">
        <StatTile Icon={Flame} label="Current streak" value={plural(runs.current, runs.unit)} />
        <StatTile Icon={Trophy} label="Best streak" value={plural(runs.best, runs.unit)} />
      </View>
      <Text className="-mt-1 px-1 text-[13px] leading-5 text-surface-500">
        {runs.unit === 'week'
          ? focused ? <>Weeks in a row with <BlurSpan tint="#737373">{focused.name}</BlurSpan> on target.</> : 'Weeks in a row with every weekly habit on target.'
          : focused ? <>Days in a row with <BlurSpan tint="#737373">{focused.name}</BlurSpan> done.</> : 'Days in a row with every daily habit done.'}
      </Text>

      <Card className="overflow-hidden border-0">
        <CardHeader className="pb-3"><CardTitle>This month by habit</CardTitle></CardHeader>
        {rates.map(({ habit, done, possible, unit }) => {
          const selected = habit.id === focus
          return <Pressable
            key={habit.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${habit.name}, ${done} of ${possible} ${unit}s, ${percent(done, possible)} percent`}
            accessibilityHint={selected ? 'Shows every habit on the calendar' : 'Shows only this habit on the calendar'}
            onPress={() => setFocus(selected ? null : habit.id)}
            className={`flex-row items-center border-t border-surface-800 px-5 py-3 active:bg-surface-900 ${selected ? 'bg-surface-900' : ''}`}
          >
            <HabitIcon icon={habit.icon} size={40} />
            <View className="ml-3 flex-1">
              <View className="flex-row items-baseline justify-between">
                <Blurred><Text numberOfLines={1} className="flex-1 text-[16px] font-semibold text-foreground">{habit.name}</Text></Blurred>
                <Text className="ml-3 text-[14px] text-muted-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                  {possible === 0
                    ? unit === 'week' ? 'No full week yet' : 'Not started'
                    : `${done}/${possible} ${unit}s · ${percent(done, possible)}%`}
                </Text>
              </View>
              <View className="mt-2"><Bar thin share={possible === 0 ? 0 : done / possible} /></View>
            </View>
          </Pressable>
        })}
      </Card>
    </ScrollView>
  </PeriodSwipe>
}

export default function HabitsProgress(): React.ReactElement {
  return <HabitsGate><ProgressBody /></HabitsGate>
}
