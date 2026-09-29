import React, { useCallback, useMemo, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ban, Pencil, Plus, Trophy } from 'lucide-react-native'
import type { HabitRecord } from '@ego/api-contracts'
import { HeaderIcon } from '../../components/gym/ui'
import { HabitIcon, HabitsError, HabitsGate } from '../../components/habits/ui'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Text as UiText } from '../../components/ui/text'
import { momentLabel, runLabel, runSpoken, twoDigits } from '../../lib/habits/format'
import { useHabits } from '../../lib/habits/context'
import { useBlurText } from '../../lib/blur'
import { quitClock, splitDuration } from '../../lib/habits/stats'

const TABULAR = { fontVariant: ['tabular-nums' as const] }

/** Ticks once a second, and only while the tab is on screen. */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useFocusEffect(useCallback(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, []))
  return now
}

function Unit({ value, label }: { value: number; label: string }): React.ReactElement {
  return <View className="flex-row items-baseline">
    <Text className="text-[24px] font-semibold text-foreground" style={TABULAR}>{twoDigits(value)}</Text>
    <Text className="ml-1 text-[15px] text-muted-foreground">{label}</Text>
  </View>
}

function QuitCard({ habit, now }: { habit: HabitRecord; now: number }): React.ReactElement {
  const habits = useHabits()
  const blur = useBlurText()
  const clock = useMemo(() => quitClock(habit, habits.log), [habit, habits.log])
  const running = Math.max(0, now - clock.since)
  const { days, hours, minutes, seconds } = splitDuration(running)
  const best = Math.max(clock.bestEnded, running)

  return <Card className="p-5">
    <View className="flex-row items-center">
      <HabitIcon icon={habit.icon} size={48} />
      <View className="ml-3 flex-1">
        <Text numberOfLines={2} className="text-[18px] font-semibold text-foreground" style={blur()}>{habit.name}</Text>
        <Text className="mt-0.5 text-[14px] text-muted-foreground">
          {`${clock.restarted ? 'Restarted' : 'Clean since'} ${momentLabel(clock.since)}`}
        </Text>
      </View>
      <HeaderIcon label={`Edit ${habit.name}`} onPress={() => habits.openEditor({ kind: 'break', habit })}>
        <Pencil color="#a3a3a3" size={19} />
      </HeaderIcon>
    </View>

    <View accessible accessibilityLabel={`${runSpoken(running)} clean`} className="mt-5 items-center">
      <Text className="text-[64px] font-bold leading-[70px] tracking-tight text-foreground" style={TABULAR}>{days}</Text>
      <Text className="text-[15px] font-medium text-muted-foreground">{days === 1 ? 'day' : 'days'}</Text>
      <View className="mt-4 flex-row gap-6">
        <Unit value={hours} label="h" />
        <Unit value={minutes} label="m" />
        <Unit value={seconds} label="s" />
      </View>
    </View>

    <View accessible accessibilityLabel={`Best run, ${runSpoken(best)}`} className="mt-5 flex-row items-center border-t border-border pt-4">
      <Trophy color="#a3a3a3" size={16} />
      <Text className="ml-2 flex-1 text-[15px] font-medium text-muted-foreground">Best run</Text>
      <Text className="text-[16px] font-semibold text-foreground" style={TABULAR}>{runLabel(best)}</Text>
    </View>
  </Card>
}

function QuitBody(): React.ReactElement {
  const habits = useHabits()
  const now = useNow()
  const breaking = (habits.habits ?? []).filter((habit) => habit.kind === 'break')
  if (breaking.length === 0) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Ban color="#a3a3a3" size={30} /></View>
      <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">Nothing to quit yet</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">
        Add a habit you want to break. A clock counts the time since you quit, down to the second.
      </Text>
      <Button className="mt-5" onPress={() => habits.openEditor({ kind: 'break', habit: null })}>
        <Plus color="#0a0a0a" size={18} /><UiText>Add a habit to break</UiText>
      </Button>
    </View>
  }
  return <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
    <HabitsError />
    {breaking.map((habit) => <QuitCard key={habit.id} habit={habit} now={now} />)}
    <Text className="mt-1 text-center text-[13px] text-surface-500">To restart a clock, open it with the pencil.</Text>
  </ScrollView>
}

export default function HabitsQuit(): React.ReactElement {
  return <HabitsGate><QuitBody /></HabitsGate>
}
