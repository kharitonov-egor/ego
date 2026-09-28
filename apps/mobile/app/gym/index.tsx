import React, { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  AlarmClock, CalendarDays, ChevronLeft, ChevronRight, EllipsisVertical, LayoutGrid, Library, Plus, Settings
} from 'lucide-react-native'
import { DEFAULT_DISTANCE_UNIT, exerciseRecords } from '@ego/core'
import { CalendarDialog } from '../../components/money/DatePicker'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { color } from '../../components/money/tokens'
import { GymReviewSheet } from '../../components/gym/GymSync'
import { SyncButton } from '../../components/money/SyncButton'
import { RestTimerButton, RestTimerSheet } from '../../components/gym/RestTimer'
import { GymGate, HeaderIcon, MenuSheet, SetMarks, SetValues } from '../../components/gym/ui'
import { Button } from '../../components/ui/button'
import { Text } from '../../components/ui/text'
import { shiftIso } from '../../lib/dates'
import { dayBarLabel, unitFor } from '../../lib/gym/format'
import { useGym, useGymQuery } from '../../lib/gym-context'
import { cachedExerciseSets, gymDay, type GymDay, type WorkoutExercise } from '../../lib/repositories/gym'
import { useRestTimer } from '../../lib/rest-timer'

async function recordIdsForDay(
  db: Parameters<typeof gymDay>[0], day: GymDay, version: number
): Promise<Set<string>> {
  const records = new Set<string>()
  await Promise.all(day.exercises.map(async (item) => {
    const history = await cachedExerciseSets(db, item.exercise.id, version)
    const held = exerciseRecords(history, item.exercise.type, unitFor(item.exercise.weightUnit), DEFAULT_DISTANCE_UNIT).recordSetIds
    for (const id of held) records.add(id)
  }))
  return records
}

function ExerciseCard({ item, records, grouped, onPress }: {
  item: WorkoutExercise
  records: Set<string>
  grouped: 'none' | 'first' | 'middle' | 'last'
  onPress: () => void
}): React.ReactElement {
  const { exercise, sets } = item
  const unit = unitFor(exercise.weightUnit)
  return <View className="flex-row">
    {grouped !== 'none' && <View className="w-4 items-center">
      <View style={{
        position: 'absolute', width: 3, borderRadius: 2, backgroundColor: color.text,
        top: grouped === 'first' ? 18 : 0, bottom: grouped === 'last' ? 18 : 0
      }} />
    </View>}
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens this exercise to add or edit sets"
      onPress={onPress}
      className="mb-3 flex-1 rounded-2xl border border-border bg-card active:bg-surface-900"
    >
      <View className="border-b border-border px-4 pb-2.5 pt-3.5">
        <Text className="text-[18px] font-medium">{exercise.name}</Text>
      </View>
      <View className="px-4 py-1.5">
        {sets.map((set) => <View key={set.id} className="py-1.5">
          <View className="min-h-8 flex-row items-center">
            <View className="flex-1"><SetMarks record={records.has(set.id)} comment={set.comment} /></View>
            <SetValues set={set} type={exercise.type} unit={unit} />
          </View>
          {set.comment !== '' && <Text className="mt-0.5 text-right text-[14px] text-muted-foreground">{set.comment}</Text>}
        </View>)}
      </View>
    </Pressable>
  </View>
}

function groupPosition(day: GymDay, index: number): 'none' | 'first' | 'middle' | 'last' {
  const id = day.exercises[index].exercise.id
  const group = day.supersets.find((members) => members.includes(id))
  if (!group) return 'none'
  const previous = index > 0 && group.includes(day.exercises[index - 1].exercise.id)
  const next = index < day.exercises.length - 1 && group.includes(day.exercises[index + 1].exercise.id)
  if (previous && next) return 'middle'
  if (previous) return 'last'
  if (next) return 'first'
  return 'none'
}

function LoggedDayBody({ day, onOpen }: { day: GymDay; onOpen: (exerciseId: string) => void }): React.ReactElement {
  const gym = useGym()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const records = useGymQuery((db) => recordIdsForDay(db, day, gym.version), [day.date]) ?? new Set<string>()
  if (day.exercises.length === 0) {
    const noLibrary = gym.categories.length === 0
    return <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
      <Text className="text-center text-[20px] font-semibold">{noLibrary ? 'No exercises yet' : 'Workout log empty'}</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">
        {noLibrary
          ? 'Add the standard exercises to start, or create your own.'
          : 'Pick an exercise to log its first set. Swipe sideways to move between days.'}
      </Text>
      {noLibrary
        ? <Button size="lg" disabled={gym.writing} onPress={() => void gym.addLibrary()} className="mt-6"><Library color={color.screen} size={19} /><Text>Add standard exercises</Text></Button>
        : <Button size="lg" onPress={() => router.push('/gym/exercises')} className="mt-6"><Plus color={color.screen} size={19} /><Text>Start new workout</Text></Button>}
    </ScrollView>
  }
  return <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
    {day.exercises.map((item, index) => <ExerciseCard
      key={item.exercise.id}
      item={item}
      records={records}
      grouped={groupPosition(day, index)}
      onPress={() => onOpen(item.exercise.id)}
    />)}
  </ScrollView>
}

function DayBody({ onOpen }: { onOpen: (exerciseId: string) => void }): React.ReactElement {
  const gym = useGym()
  const day = useGymQuery((db) => gymDay(db, gym.date), [gym.date])
  if (!day || day.date !== gym.date) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator color={color.text} /></View>
  }
  return <LoggedDayBody day={day} onOpen={onOpen} />
}

/** FitNotes' home: one day's workout, a card per exercise, days a swipe apart. */
export default function GymLog(): React.ReactElement {
  const gym = useGym()
  const router = useRouter()
  const timer = useRestTimer()
  const [menu, setMenu] = useState(false)
  const [resting, setResting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const step = (days: number): void => gym.setDate(shiftIso(gym.date, days))

  return <>
    <Stack.Screen options={{
      title: 'Gym',
      headerTitleAlign: 'center',
      headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color={color.text} size={21} /></HeaderIcon>,
      headerRight: () => <View className="flex-row items-center">
        {timer.running && <RestTimerButton onPress={() => setResting(true)} />}
        <SyncButton onReview={() => setReviewing(true)} />
        <HeaderIcon label="Calendar" onPress={() => router.push('/gym/calendar')}><CalendarDays color={color.textSecondary} size={21} /></HeaderIcon>
        <HeaderIcon label="Add exercise" onPress={() => router.push('/gym/exercises')}><Plus color={color.text} size={23} /></HeaderIcon>
        <HeaderIcon label="More options" onPress={() => setMenu(true)}><EllipsisVertical color={color.textSecondary} size={21} /></HeaderIcon>
      </View>
    }} />
    <GymGate>
      <View className="flex-row items-center border-b border-border">
        <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => step(-1)} hitSlop={4} className="h-12 w-14 items-center justify-center active:bg-surface-900">
          <ChevronLeft color={color.text} size={24} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityHint="Pick a day" onPress={() => setPicking(true)} className="h-12 flex-1 items-center justify-center active:bg-surface-900">
          <Text className="text-[16px] font-bold tracking-wide">{dayBarLabel(gym.date)}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Next day" onPress={() => step(1)} hitSlop={4} className="h-12 w-14 items-center justify-center active:bg-surface-900">
          <ChevronRight color={color.text} size={24} />
        </Pressable>
      </View>
      <PeriodSwipe onStep={(delta) => step(-delta)}>
        <DayBody onOpen={(exerciseId) => router.push({ pathname: '/gym/track', params: { exerciseId } })} />
      </PeriodSwipe>
    </GymGate>
    <MenuSheet visible={menu} title="Gym" onClose={() => setMenu(false)} items={[
      { label: 'Rest timer', Icon: AlarmClock, onPress: () => setResting(true) },
      { label: 'All exercises', Icon: Library, onPress: () => router.push('/gym/exercises') },
      { label: 'Settings', Icon: Settings, onPress: () => router.push('/settings') }
    ]} />
    <RestTimerSheet visible={resting} onClose={() => setResting(false)} />
    <GymReviewSheet visible={reviewing} onClose={() => setReviewing(false)} />
    <CalendarDialog
      visible={picking}
      value={gym.date}
      onCancel={() => setPicking(false)}
      onConfirm={(iso) => {
        setPicking(false)
        gym.setDate(iso)
      }}
    />
  </>
}
