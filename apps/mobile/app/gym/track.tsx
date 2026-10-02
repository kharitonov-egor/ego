import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, SectionList, TextInput, View, useWindowDimensions,
  type NativeScrollEvent, type NativeSyntheticEvent
} from 'react-native'
import { KeyboardScrollView } from '../../components/ui/keyboard'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, ArrowRight, Info, Link2, Menu, MessageSquare, Minus, Plus, Trophy } from 'lucide-react-native'
import {
  DEFAULT_DISTANCE_UNIT, EXERCISE_TYPE_LABELS, exerciseRecords, fieldsFor, supersetOf,
  type DistanceUnit, type SetField
} from '@ego/core'
import { BottomSheet } from '../../components/money/Common'
import { color, tabular } from '../../components/money/tokens'
import { Confetti } from '../../components/gym/Confetti'
import { ExerciseGraph } from '../../components/gym/ExerciseGraph'
import { RecordsSheet } from '../../components/gym/RecordsSheet'
import { RestTimerButton, RestTimerSheet } from '../../components/gym/RestTimer'
import { CommentSheet } from '../../components/gym/sheets'
import { WorkoutDrawer } from '../../components/gym/WorkoutDrawer'
import { Dot, GymGate, HeaderIcon, SectionLabel, SetMarks, SetValues } from '../../components/gym/ui'
import { Button } from '../../components/ui/button'
import { Text } from '../../components/ui/text'
import {
  EMPTY_DRAFT, beatsRecord, draftFrom, historyHeader, stepDraft, unitFor, valuesFromDraft, type EntryDraft
} from '../../lib/gym/format'
import { useGym, useGymQuery } from '../../lib/gym-context'
import {
  cachedExerciseSets, exerciseSetsPage, exerciseSupersetPartners, exerciseTrackSets, gymDay,
  type ExerciseTrackSets, type GymExerciseView, type GymSetView
} from '../../lib/repositories/gym'
import { useRestTimer } from '../../lib/rest-timer'

const TABS = ['TRACK', 'HISTORY', 'GRAPH'] as const

const FIELD_KEYBOARD: Record<SetField, 'decimal-pad' | 'number-pad' | 'numbers-and-punctuation'> = {
  weight: 'decimal-pad',
  reps: 'number-pad',
  distance: 'decimal-pad',
  time: 'numbers-and-punctuation'
}

/** Today's last set, or else the first set of the latest earlier workout. History is newest day first. */
function prefillFrom(history: readonly GymSetView[], date: string): GymSetView | null {
  const today = history.filter((set) => set.date === date)
  if (today.length > 0) return today[today.length - 1]
  return history.find((set) => set.date < date) ?? null
}

function Stepper({ label, value, keyboard, onChange, onStep }: {
  label: string
  value: string
  keyboard: 'decimal-pad' | 'number-pad' | 'numbers-and-punctuation'
  onChange: (text: string) => void
  onStep: (direction: -1 | 1) => void
}): React.ReactElement {
  return <View className="mb-6">
    <SectionLabel>{label}</SectionLabel>
    <View className="mt-3 flex-row items-center justify-center gap-3">
      <Pressable accessibilityRole="button" accessibilityLabel={`Less ${label.toLowerCase()}`} onPress={() => onStep(-1)} className="h-14 w-16 items-center justify-center rounded-xl bg-surface-800 active:bg-surface-700">
        <Minus color={color.text} size={24} />
      </Pressable>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboard}
        selectTextOnFocus
        className="min-h-14 w-40 border-b border-input text-center text-[32px] font-bold text-foreground"
        style={tabular}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={`More ${label.toLowerCase()}`} onPress={() => onStep(1)} className="h-14 w-16 items-center justify-center rounded-xl bg-surface-800 active:bg-surface-700">
        <Plus color={color.text} size={24} />
      </Pressable>
    </View>
  </View>
}

function TrackPage({ exercise, date, history, lifetime, records, nextInSuperset, onNext, onRecord }: {
  exercise: GymExerciseView
  date: string
  history: readonly GymSetView[]
  /** Every set of the exercise, once loaded. Deciding whether a new set breaks a record needs all of them. */
  lifetime: readonly GymSetView[] | null
  records: Set<string>
  nextInSuperset: GymExerciseView | null
  onNext: () => void
  onRecord: () => void
}): React.ReactElement {
  const gym = useGym()
  const timer = useRestTimer()
  const insets = useSafeAreaInsets()
  const unit = unitFor(exercise.weightUnit)
  const fields = fieldsFor(exercise.type)
  const todays = useMemo(() => history.filter((set) => set.date === date), [history, date])
  const distanceUnit: DistanceUnit = history.find((set) => set.distanceUnit)?.distanceUnit ?? DEFAULT_DISTANCE_UNIT
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT)
  const [problem, setProblem] = useState<string | null>(null)
  const [commenting, setCommenting] = useState<GymSetView | null>(null)
  const prefilledFor = useRef<string | null>(null)
  const selected = todays.find((set) => set.id === selectedId) ?? null

  useEffect(() => {
    const key = `${exercise.id}|${date}`
    if (prefilledFor.current === key) return
    prefilledFor.current = key
    setSelectedId(null)
    setProblem(null)
    setDraft(draftFrom(prefillFrom(history, date), exercise.type, unit))
  }, [exercise.id, date, history])

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selected, selectedId])

  const restore = (): void => setDraft(draftFrom(prefillFrom(history, date), exercise.type, unit))

  const choose = (set: GymSetView): void => {
    setProblem(null)
    if (set.id === selectedId) {
      setSelectedId(null)
      restore()
      return
    }
    setSelectedId(set.id)
    setDraft(draftFrom(set, exercise.type, unit))
  }

  const save = async (): Promise<void> => {
    const parsed = valuesFromDraft(draft, exercise.type, unit, distanceUnit)
    if (!parsed.ok) {
      setProblem(parsed.message)
      return
    }
    setProblem(null)
    if (selected) {
      const saved = await gym.updateSet(selected.id, {
        exerciseId: exercise.id, date, position: selected.position, comment: selected.comment, ...parsed.values
      })
      if (saved) setSelectedId(null)
      return
    }
    const record = lifetime !== null &&
      beatsRecord(lifetime, { date, ...parsed.values }, exercise.type, unit, distanceUnit)
    const saved = await gym.logSet({ exerciseId: exercise.id, date, comment: '', ...parsed.values })
    if (!saved) return
    if (record) onRecord()
    if (timer.preference.autoStart) timer.start()
  }

  const clear = async (): Promise<void> => {
    setProblem(null)
    if (selected) {
      if (await gym.deleteSets([selected.id])) setSelectedId(null)
      return
    }
    setDraft(draftFrom(null, exercise.type, unit))
  }

  const saveComment = (comment: string): void => {
    const target = commenting
    setCommenting(null)
    if (!target) return
    void gym.updateSet(target.id, {
      exerciseId: target.exerciseId, date: target.date, position: target.position, weight: target.weight,
      weightUnit: target.weightUnit, reps: target.reps, distance: target.distance, distanceUnit: target.distanceUnit,
      durationSeconds: target.durationSeconds, comment
    })
  }

  const labels: Record<SetField, string> = {
    weight: `WEIGHT (${unit})`,
    reps: 'REPS',
    distance: `DISTANCE (${distanceUnit})`,
    time: 'TIME'
  }

  return <KeyboardScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }}>
    {fields.map((field) => <Stepper
      key={field}
      label={labels[field]}
      value={draft[field]}
      keyboard={FIELD_KEYBOARD[field]}
      onChange={(text) => setDraft((current) => ({ ...current, [field]: text }))}
      onStep={(direction) => setDraft((current) => stepDraft(current, field, direction, unit, distanceUnit))}
    />)}
    {problem && <Text className="-mt-2 mb-3 text-center text-[15px] text-destructive">{problem}</Text>}
    <View className="flex-row gap-3">
      <Button size="lg" disabled={gym.writing} onPress={() => void save()} className="flex-1"><Text className="tracking-wide">{selected ? 'UPDATE' : 'SAVE'}</Text></Button>
      <Button variant={selected ? 'destructive' : 'secondary'} size="lg" disabled={gym.writing} onPress={() => void clear()} className="flex-1">
        <Text className="tracking-wide">{selected ? 'DELETE' : 'CLEAR'}</Text>
      </Button>
    </View>
    {nextInSuperset && <Pressable accessibilityRole="button" onPress={onNext} className="mt-3 min-h-12 flex-row items-center justify-center rounded-xl border border-input px-4 active:bg-surface-900">
      <Text numberOfLines={1} className="text-[15px] font-semibold">Next in superset: {nextInSuperset.name}</Text>
      <ArrowRight color={color.text} size={18} style={{ marginLeft: 6 }} />
    </Pressable>}
    <View className="mt-5">
      {todays.map((set, index) => {
        const active = set.id === selectedId
        return <View key={set.id} className={`border-b border-border ${active ? 'bg-surface-800' : ''}`}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityHint="Select this set to change or delete it" onPress={() => choose(set)} className="min-h-[52px] flex-row items-center pr-1">
            <Pressable accessibilityRole="button" accessibilityLabel={set.comment ? `Comment: ${set.comment}` : 'Add a comment'} onPress={() => setCommenting(set)} hitSlop={4} className="h-12 w-12 items-center justify-center">
              <MessageSquare color={set.comment ? color.text : color.textFaint} size={20} fill={set.comment ? color.surfaceRaised : 'transparent'} />
            </Pressable>
            <Text className="w-8 text-[17px] font-bold" style={tabular}>{index + 1}</Text>
            <View className="flex-1">{records.has(set.id) && <Trophy color={color.attention} size={16} accessibilityLabel="Personal record" />}</View>
            <SetValues set={set} type={exercise.type} unit={unit} />
          </Pressable>
          {set.comment !== '' && <Text className="-mt-1 pb-2 pl-12 text-[14px] leading-5 text-muted-foreground">{set.comment}</Text>}
        </View>
      })}
    </View>
    <CommentSheet visible={commenting !== null} initial={commenting?.comment ?? ''} onClose={() => setCommenting(null)} onSave={saveComment} />
  </KeyboardScrollView>
}

interface HistorySection {
  date: string
  data: GymSetView[]
}

const HISTORY_PAGE_SIZE = 100

function HistoryPage({ exercise, records, onOpenDay }: {
  exercise: GymExerciseView
  records: Set<string>
  onOpenDay: (date: string) => void
}): React.ReactElement {
  const gym = useGym()
  const insets = useSafeAreaInsets()
  const unit = unitFor(exercise.weightUnit)
  const [history, setHistory] = useState<GymSetView[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const request = useRef(0)
  const partners = useGymQuery((db) => exerciseSupersetPartners(db, exercise.id), [exercise.id])

  const load = async (offset: number): Promise<void> => {
    if (!gym.db || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const started = request.current
    try {
      const page = await exerciseSetsPage(gym.db, exercise.id, HISTORY_PAGE_SIZE, offset)
      if (started !== request.current) return
      setHistory((current) => offset === 0 ? page.items : [...current, ...page.items])
      setNextOffset(page.nextOffset)
    } finally {
      loadingRef.current = false
      if (started === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    request.current += 1
    setHistory([])
    setNextOffset(0)
    void load(0)
  // load intentionally restarts only when the exercise or stored gym data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id, gym.db, gym.version])

  const sections = useMemo(() => {
    const grouped: HistorySection[] = []
    for (const set of history) {
      const last = grouped[grouped.length - 1]
      if (last && last.date === set.date) last.data.push(set)
      else grouped.push({ date: set.date, data: [set] })
    }
    return grouped
  }, [history])
  if (sections.length === 0 && loading) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator color={color.text} /></View>
  }
  if (sections.length === 0) {
    return <View className="flex-1 items-center justify-center px-8">
      <Text className="text-center text-[16px] leading-6 text-muted-foreground">No sets logged for {exercise.name} yet.</Text>
    </View>
  }
  return <SectionList
    sections={sections}
    keyExtractor={(item) => item.id}
    stickySectionHeadersEnabled={false}
    initialNumToRender={30}
    onEndReachedThreshold={0.6}
    onEndReached={() => { if (nextOffset !== null) void load(nextOffset) }}
    contentContainerStyle={{ paddingLeft: 8, paddingRight: 20, paddingBottom: insets.bottom + 24 }}
    renderSectionHeader={({ section }) => {
      const partnerNames = partners?.get(section.date)
      return <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens this day in Track"
        onPress={() => onOpenDay(section.date)}
        className="pl-3 pt-6 active:opacity-70"
      >
        <SectionLabel>{historyHeader(section.date)}</SectionLabel>
        {partnerNames && <View className="flex-row items-center pt-2">
          <Link2 color={color.textMuted} size={15} />
          <Text numberOfLines={1} className="ml-1.5 flex-1 text-[14px] text-muted-foreground">Superset with {partnerNames.join(', ')}</Text>
        </View>}
      </Pressable>
    }}
    renderItem={({ item, index, section }) => <View className="flex-row">
      <View className="w-3">
        {partners?.has(section.date) && <View style={{
          position: 'absolute', left: 2, width: 3, borderRadius: 2, backgroundColor: color.text,
          top: index === 0 ? 8 : 0, bottom: index === section.data.length - 1 ? 8 : 0
        }} />}
      </View>
      <View className="flex-1 py-1.5">
        <View className="min-h-9 flex-row items-center">
          <View className="flex-1"><SetMarks record={records.has(item.id)} comment={item.comment} /></View>
          <SetValues set={item} type={exercise.type} unit={unit} />
        </View>
        {item.comment !== '' && <Text className="text-right text-[14px] text-muted-foreground">{item.comment}</Text>}
      </View>
    </View>}
    ListFooterComponent={loading ? <ActivityIndicator color={color.text} className="py-5" /> : null}
  />
}

function Tabs({ active, onChange }: { active: number; onChange: (index: number) => void }): React.ReactElement {
  return <View accessibilityRole="tablist" className="flex-row border-b border-border">
    {TABS.map((tab, index) => <Pressable
      key={tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: index === active }}
      onPress={() => onChange(index)}
      className="h-12 flex-1 items-center justify-center active:bg-surface-900"
    >
      <Text className={`text-[15px] font-bold tracking-wide ${index === active ? 'text-foreground' : 'text-muted-foreground'}`}>{tab}</Text>
      <View className={`absolute bottom-0 left-4 right-4 h-[3px] rounded-full ${index === active ? 'bg-primary' : 'bg-transparent'}`} />
    </Pressable>)}
  </View>
}

/** One exercise on one day: FitNotes' Track, History, and Graph tabs, a swipe apart. */
export default function Track(): React.ReactElement {
  const params = useLocalSearchParams<{ exerciseId?: string }>()
  const exerciseId = params.exerciseId ?? ''
  const gym = useGym()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const pager = useRef<ScrollView>(null)
  const [tab, setTab] = useState(0)
  const [visited, setVisited] = useState<boolean[]>([true, false, false])
  const [scrubbing, setScrubbing] = useState(false)
  const [pageHeight, setPageHeight] = useState(0)
  const [drawer, setDrawer] = useState(false)
  const [showRecords, setShowRecords] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [resting, setResting] = useState(false)
  const [celebration, setCelebration] = useState(0)
  const exercise = gym.exercises.find((item) => item.id === exerciseId) ?? null
  const track = useGymQuery(async (db) => ({
    exerciseId, sets: await exerciseTrackSets(db, exerciseId, gym.date)
  }), [exerciseId, gym.date])
  const day = useGymQuery((db) => gymDay(db, gym.date), [gym.date])
  const recordHistory = useGymQuery(
    async (db) => ({ exerciseId, sets: await cachedExerciseSets(db, exerciseId, gym.version) }), [exerciseId])
  const trackSets: ExerciseTrackSets | null = track && track.exerciseId === exerciseId ? track.sets : null
  const history = recordHistory && recordHistory.exerciseId === exerciseId ? recordHistory.sets : null
  const unit = unitFor(exercise?.weightUnit ?? 'default')
  const distanceUnit: DistanceUnit = history?.find((set) => set.distanceUnit)?.distanceUnit ?? DEFAULT_DISTANCE_UNIT
  const records = useMemo(
    () => exercise && history ? exerciseRecords(history, exercise.type, unit, distanceUnit) : null,
    [exercise, history, unit, distanceUnit])

  const group = day ? supersetOf(day.supersets, exerciseId) : null
  const nextId = group ? group[(group.indexOf(exerciseId) + 1) % group.length] : null
  const nextInSuperset = nextId && nextId !== exerciseId ? gym.exercises.find((item) => item.id === nextId) ?? null : null

  const showTab = (index: number, animated = true): void => {
    setTab(index)
    setVisited((current) => current.map((seen, position) => seen || position === index))
    pager.current?.scrollTo({ x: index * width, animated })
  }

  const onPaged = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const index = Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width))
    if (index !== tab) {
      setTab(index)
      setVisited((current) => current.map((seen, position) => seen || position === index))
    }
  }

  const switchTo = (id: string): void => {
    router.setParams({ exerciseId: id })
    showTab(0, false)
  }

  return <>
    <Stack.Screen options={{
      title: exercise?.name ?? 'Exercise',
      headerTitleAlign: 'left',
      headerBackVisible: false,
      headerLeft: () => <View className="mr-2 flex-row items-center">
        <HeaderIcon label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/gym')}><ArrowLeft color={color.text} size={22} /></HeaderIcon>
        <HeaderIcon label="Today's exercises" onPress={() => setDrawer(true)}><Menu color={color.text} size={22} /></HeaderIcon>
      </View>,
      headerRight: () => <View className="flex-row items-center">
        <RestTimerButton onPress={() => setResting(true)} />
        <HeaderIcon label="Personal records" onPress={() => setShowRecords(true)}><Trophy color={color.textSecondary} size={21} /></HeaderIcon>
        <HeaderIcon label="Exercise details" onPress={() => setShowInfo(true)}><Info color={color.textSecondary} size={21} /></HeaderIcon>
      </View>
    }} />
    <GymGate>
      {!exercise
        ? gym.exercises.length > 0 && <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-[18px] font-semibold">This exercise is gone</Text>
          <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">It was deleted, possibly on another device.</Text>
          <Button onPress={() => router.dismissTo('/gym')} className="mt-5"><Text>Back to the log</Text></Button>
        </View>
        : <>
          <Tabs active={tab} onChange={(index) => showTab(index)} />
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            scrollEnabled={!scrubbing}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onMomentumScrollEnd={onPaged}
            onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}
            className="flex-1"
          >
            <View style={{ width, height: pageHeight }}>
              {trackSets && <TrackPage
                exercise={exercise}
                date={gym.date}
                history={[...trackSets.today, ...(trackSets.previous ? [trackSets.previous] : [])]}
                lifetime={history}
                records={records?.recordSetIds ?? new Set<string>()}
                nextInSuperset={nextInSuperset}
                onNext={() => nextInSuperset && switchTo(nextInSuperset.id)}
                onRecord={() => setCelebration((count) => count + 1)}
              />}
            </View>
            <View style={{ width, height: pageHeight }}>
              {visited[1] && <HistoryPage
                exercise={exercise}
                records={records?.recordSetIds ?? new Set<string>()}
                onOpenDay={(date) => {
                  gym.setDate(date)
                  showTab(0)
                }}
              />}
            </View>
            <View style={{ width, height: pageHeight }}>
              {visited[2] && history && <ScrollView contentContainerStyle={{ padding: 20 }}>
                <ExerciseGraph sets={history} type={exercise.type} weightUnit={unit} distanceUnit={distanceUnit} onScrubbingChange={setScrubbing} />
              </ScrollView>}
            </View>
          </ScrollView>
        </>}
    </GymGate>
    {celebration > 0 && <Confetti key={celebration} onDone={() => setCelebration(0)} />}
    <WorkoutDrawer
      visible={drawer}
      day={day}
      currentId={exerciseId}
      onClose={() => setDrawer(false)}
      onSelect={switchTo}
      onAddExercise={() => router.replace('/gym/exercises')}
      onHome={() => router.dismissTo('/gym')}
    />
    {exercise && records && <RecordsSheet
      visible={showRecords}
      name={exercise.name}
      type={exercise.type}
      records={records}
      weightUnit={unit}
      distanceUnit={distanceUnit}
      onClose={() => setShowRecords(false)}
    />}
    <RestTimerSheet visible={resting} onClose={() => setResting(false)} />
    {exercise && <BottomSheet visible={showInfo} title={exercise.name} onClose={() => setShowInfo(false)} dismissOnBackdrop>
      <View className="flex-row items-center gap-2">
        <Dot color={exercise.categoryColor} />
        <Text className="text-[16px]">{exercise.categoryName}</Text>
        <Text className="text-[16px] text-muted-foreground">, {EXERCISE_TYPE_LABELS[exercise.type].toLowerCase()}</Text>
      </View>
      <Text className="mt-4 text-[16px] leading-6 text-surface-200">{exercise.notes || 'No notes yet.'}</Text>
      <Text className="mt-4 text-[15px] text-muted-foreground">{exercise.setCount} {exercise.setCount === 1 ? 'set' : 'sets'} logged in total</Text>
      <Button variant="outline" size="lg" onPress={() => {
        setShowInfo(false)
        router.push({ pathname: '/gym/exercise-editor', params: { id: exercise.id } })
      }} className="mt-5"><Text>Edit exercise</Text></Button>
    </BottomSheet>}
  </>
}
