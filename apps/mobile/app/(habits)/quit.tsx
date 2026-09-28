import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Ban, Hand, Pencil, Plus } from 'lucide-react-native'
import type { HabitRecord } from '@ego/api-contracts'
import { HeaderIcon } from '../../components/gym/ui'
import { HabitIcon, HabitsError, HabitsGate, StatTile } from '../../components/habits/ui'
import { ConfirmDialog } from '../../components/money/Common'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Text as UiText } from '../../components/ui/text'
import { parseIso } from '../../lib/dates'
import { useHabits } from '../../lib/habits/context'
import { quitStats } from '../../lib/habits/stats'

const UNDO_MS = 6000

function shortDate(iso: string, today: string): string {
  return parseIso(iso).toLocaleDateString('en-US', iso.slice(0, 4) === today.slice(0, 4)
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

function QuitCard({ habit }: { habit: HabitRecord }): React.ReactElement {
  const habits = useHabits()
  const { today } = habits
  const stats = useMemo(() => quitStats(habit, habits.log, today), [habit, habits.log, today])
  const [confirmingSlip, setConfirmingSlip] = useState(false)
  const [undo, setUndo] = useState<{ id: string; kind: 'resisted' | 'slipped' } | null>(null)

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(timer)
  }, [undo])

  const log = async (kind: 'resisted' | 'slipped'): Promise<void> => {
    const id = await habits.record(habit, kind, today)
    if (id) setUndo({ id, kind })
  }
  const since = stats.lastSlip === null ? `Clean since ${shortDate(habit.startDate, today)}`
    : stats.lastSlip === today ? 'Slipped today' : `Last slip ${shortDate(stats.lastSlip, today)}`

  return <Card className="p-5">
    <View className="flex-row items-center">
      <HabitIcon icon={habit.icon} size={48} />
      <View className="ml-3 flex-1">
        <Text numberOfLines={2} className="text-[18px] font-semibold text-foreground">{habit.name}</Text>
        <Text className="mt-0.5 text-[14px] text-muted-foreground">{since}</Text>
      </View>
      <HeaderIcon label={`Edit ${habit.name}`} onPress={() => habits.openEditor({ kind: 'break', habit })}>
        <Pencil color="#a3a3a3" size={19} />
      </HeaderIcon>
    </View>

    <View accessible accessibilityLabel={`${stats.cleanDays} ${stats.cleanDays === 1 ? 'day' : 'days'} clean`} className="mt-5 items-center">
      <Text className="text-[56px] font-bold leading-[62px] tracking-tight text-foreground" style={{ fontVariant: ['tabular-nums'] }}>{stats.cleanDays}</Text>
      <Text className="text-[15px] font-medium text-muted-foreground">{stats.cleanDays === 1 ? 'day clean' : 'days clean'}</Text>
    </View>

    <View className="mt-5 flex-row gap-2">
      <StatTile label="Best run" value={String(stats.bestDays)} detail={stats.bestDays === 1 ? 'day' : 'days'} />
      <StatTile label="Resisted" value={String(stats.resisted)} detail={`${stats.resistedThisMonth} this month`} />
      <StatTile label="Slips" value={String(stats.slips)} detail={`${stats.slipsThisMonth} this month`} />
    </View>

    <View className="mt-4 flex-row gap-3">
      <Button size="lg" className="flex-1" accessibilityHint="Logs an urge you did not act on today" onPress={() => void log('resisted')}>
        <Hand color="#0a0a0a" size={18} /><UiText>Resisted</UiText>
      </Button>
      <Button size="lg" variant="outline" className="flex-1" accessibilityHint="Asks before logging a slip today" onPress={() => setConfirmingSlip(true)}>
        <UiText>Slipped</UiText>
      </Button>
    </View>

    {undo && <View className="mt-3 min-h-11 flex-row items-center justify-between rounded-xl bg-surface-900 pl-4 pr-1">
      <Text accessibilityLiveRegion="polite" className="text-[14px] text-surface-300">{undo.kind === 'resisted' ? 'Logged a resisted urge.' : 'Logged a slip.'}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void habits.removeEntry(undo.id)
          setUndo(null)
        }}
        hitSlop={6}
        className="h-11 justify-center rounded-lg px-3 active:bg-surface-800"
      ><Text className="text-[14px] font-semibold text-foreground underline">Undo</Text></Pressable>
    </View>}

    <ConfirmDialog
      visible={confirmingSlip}
      title="Log a slip?"
      detail={stats.cleanDays > 0
        ? `Your run of ${stats.cleanDays} ${stats.cleanDays === 1 ? 'day' : 'days'} ends today. The count starts again tomorrow.`
        : 'This adds another slip for today.'}
      confirmLabel="Log slip"
      destructive
      onCancel={() => setConfirmingSlip(false)}
      onConfirm={() => {
        setConfirmingSlip(false)
        void log('slipped')
      }}
    />
  </Card>
}

function QuitBody(): React.ReactElement {
  const habits = useHabits()
  const breaking = (habits.habits ?? []).filter((habit) => habit.kind === 'break')
  if (breaking.length === 0) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Ban color="#a3a3a3" size={30} /></View>
      <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">Nothing to quit yet</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">
        Add a habit you want to break. It counts your days clean, the urges you resisted, and any slips.
      </Text>
      <Button className="mt-5" onPress={() => habits.openEditor({ kind: 'break', habit: null })}>
        <Plus color="#0a0a0a" size={18} /><UiText>Add a habit to break</UiText>
      </Button>
    </View>
  }
  return <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
    <HabitsError />
    {breaking.map((habit) => <QuitCard key={habit.id} habit={habit} />)}
  </ScrollView>
}

export default function HabitsQuit(): React.ReactElement {
  return <HabitsGate><QuitBody /></HabitsGate>
}
