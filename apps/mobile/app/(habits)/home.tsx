import React, { useCallback, useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Check, ListChecks, Plus } from 'lucide-react-native'
import type { HabitRecord } from '@ego/api-contracts'
import { HabitIcon, HabitsError, HabitsGate } from '../../components/habits/ui'
import { WeekStrip } from '../../components/habits/WeekStrip'
import { Button } from '../../components/ui/button'
import { Text as UiText } from '../../components/ui/text'
import { formatIso, parseIso, shiftIso } from '../../lib/dates'
import { useHabits } from '../../lib/habits/context'
import { dayScore, isDone } from '../../lib/habits/stats'

function dayTitle(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === shiftIso(today, -1)) return 'Yesterday'
  return parseIso(date).toLocaleDateString('en-US', { weekday: 'long' })
}

function HabitRow({ habit, done, onToggle, onEdit }: {
  habit: HabitRecord
  done: boolean
  onToggle: () => void
  onEdit: () => void
}): React.ReactElement {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked: done }}
    accessibilityLabel={habit.name}
    accessibilityHint="Hold to edit"
    accessibilityActions={[{ name: 'longpress', label: 'Edit habit' }]}
    onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') onEdit() }}
    onPress={onToggle}
    onLongPress={onEdit}
    delayLongPress={350}
    className="min-h-[68px] flex-row items-center rounded-2xl border border-border bg-card px-3 py-3 active:bg-surface-900"
  >
    <HabitIcon icon={habit.icon} />
    <Text numberOfLines={2} className={`ml-3 flex-1 text-[17px] font-semibold ${done ? 'text-surface-400' : 'text-foreground'}`}>{habit.name}</Text>
    <View className={`ml-3 h-8 w-8 items-center justify-center rounded-full ${done ? 'bg-primary' : 'border-2 border-surface-600'}`}>
      {done && <Check color="#0a0a0a" size={18} strokeWidth={3} />}
    </View>
  </Pressable>
}

function HomeBody(): React.ReactElement {
  const habits = useHabits()
  const { date, today, log } = habits
  const building = useMemo(() => (habits.habits ?? []).filter((habit) => habit.kind === 'build'), [habits.habits])
  const due = building.filter((habit) => habit.startDate <= date)
  const scoreFor = useCallback((day: string) => dayScore(building, log, day), [building, log])
  const score = scoreFor(date)
  const share = score.total === 0 ? 0 : score.done / score.total

  return <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
    <HabitsError />
    <WeekStrip selected={date} today={today} scoreFor={scoreFor} onSelect={habits.setDate} />
    <View className="mt-5 flex-row items-end justify-between">
      <View className="flex-1">
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="text-[26px] font-bold tracking-tight text-foreground">{dayTitle(date, today)}</Text>
        <Text className="mt-0.5 text-[15px] text-muted-foreground">{formatIso(date)}</Text>
      </View>
      {score.total > 0 && <Text className="text-[15px] font-semibold text-surface-300" style={{ fontVariant: ['tabular-nums'] }}>
        {score.done === score.total ? 'All done' : `${score.done} of ${score.total} done`}
      </Text>}
    </View>
    {score.total > 0 && <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: score.total, now: score.done }}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-800"
    >
      <View className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
    </View>}
    {date !== today && <Pressable accessibilityRole="button" onPress={() => habits.setDate(today)} hitSlop={10} className="mt-3 self-start">
      <Text className="text-[14px] font-semibold text-foreground underline">Back to today</Text>
    </Pressable>}

    {building.length === 0
      ? <View className="mt-10 items-center px-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><ListChecks color="#a3a3a3" size={30} /></View>
        <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">No habits yet</Text>
        <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">Add the things you want to do every day. Tap one to check it off.</Text>
        <Button className="mt-5" onPress={() => habits.openEditor({ kind: 'build', habit: null })}>
          <Plus color="#0a0a0a" size={18} /><UiText>Add a habit</UiText>
        </Button>
      </View>
      : <View className="mt-5 gap-2">
        {due.length === 0 && <Text className="py-6 text-center text-[15px] text-muted-foreground">None of your habits had started on this day.</Text>}
        {due.map((habit) => <HabitRow
          key={habit.id}
          habit={habit}
          done={isDone(log, habit.id, date)}
          onToggle={() => void habits.toggle(habit, date)}
          onEdit={() => habits.openEditor({ kind: 'build', habit })}
        />)}
        <Text className="mt-3 text-center text-[13px] text-surface-500">Hold a habit to edit, reorder, or delete it.</Text>
      </View>}
  </ScrollView>
}

export default function HabitsHome(): React.ReactElement {
  return <HabitsGate><HomeBody /></HabitsGate>
}
