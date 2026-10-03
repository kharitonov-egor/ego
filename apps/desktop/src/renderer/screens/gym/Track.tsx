import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, Info, Link2, Menu, MessageSquare, Minus, Plus, Trophy } from 'lucide-react'
import {
  DEFAULT_DISTANCE_UNIT, EXERCISE_TYPE_LABELS, exerciseRecords, fieldsFor, supersetOf,
  type DistanceUnit, type SetField
} from '@ego/core'
import {
  EMPTY_DRAFT, beatsRecord, draftFrom, historyHeader, stepDraft, unitFor, valuesFromDraft, type EntryDraft
} from '@ego/local/gym/format'
import {
  cachedExerciseSets, exerciseSetsPage, exerciseSupersetPartners, exerciseTrackSets, gymDay,
  type ExerciseTrackSets, type GymExerciseView, type GymSetView
} from '@ego/local/repositories/gym'
import { Confetti } from '../../components/gym/Confetti'
import { ExerciseGraph } from '../../components/gym/ExerciseGraph'
import { RecordsSheet } from '../../components/gym/RecordsSheet'
import { RestTimerButton, RestTimerSheet } from '../../components/gym/RestTimer'
import { CommentSheet } from '../../components/gym/sheets'
import { Dot, GymGate, SectionLabel, SetMarks, SetValues, trackPath, useWideWindow } from '../../components/gym/ui'
import { WorkoutDrawer, WorkoutPanel } from '../../components/gym/WorkoutDrawer'
import { CenteredMessage, Screen, ScreenHeader } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { Sheet } from '../../components/ui/dialog'
import { Spinner } from '../../components/ui/spinner'
import { useGym, useGymQuery } from '../../lib/gym/context'
import { useRestTimer } from '../../lib/gym/rest-timer'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

const TABS = ['TRACK', 'HISTORY', 'GRAPH'] as const

const FIELD_INPUT: Record<SetField, 'decimal' | 'numeric' | 'text'> = {
  weight: 'decimal',
  reps: 'numeric',
  distance: 'decimal',
  time: 'text'
}

/** Today's last set, or else the first set of the latest earlier workout. History is newest day first. */
function prefillFrom(history: readonly GymSetView[], date: string): GymSetView | null {
  const today = history.filter((set) => set.date === date)
  if (today.length > 0) return today[today.length - 1]
  return history.find((set) => set.date < date) ?? null
}

/** Typing works as well as the buttons: Enter saves the set, and the Up and Down keys step the value. */
function Stepper({ label, value, inputMode, onChange, onStep, onSubmit }: {
  label: string
  value: string
  inputMode: 'decimal' | 'numeric' | 'text'
  onChange: (text: string) => void
  onStep: (direction: -1 | 1) => void
  onSubmit: () => void
}): React.ReactElement {
  return <div className="mb-6">
    <SectionLabel>{label}</SectionLabel>
    <div className="mt-3 flex items-center justify-center gap-3">
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => onStep(-1)} className="flex h-14 w-16 items-center justify-center rounded-xl bg-surface-800 transition-colors hover:bg-surface-700 active:bg-surface-700">
        <Minus color={color.text} size={24} />
      </button>
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (!event.repeat) onSubmit()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            onStep(event.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        inputMode={inputMode}
        autoComplete="off"
        className="tabular min-h-14 w-40 border-b border-input bg-transparent text-center text-[32px] font-bold text-foreground outline-none focus:border-surface-400"
      />
      <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => onStep(1)} className="flex h-14 w-16 items-center justify-center rounded-xl bg-surface-800 transition-colors hover:bg-surface-700 active:bg-surface-700">
        <Plus color={color.text} size={24} />
      </button>
    </div>
  </div>
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
    if (gym.writing) return
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

  return <div className="mx-auto w-full max-w-xl px-6 pb-10 pt-6">
    {fields.map((field) => <Stepper
      key={field}
      label={labels[field]}
      value={draft[field]}
      inputMode={FIELD_INPUT[field]}
      onChange={(text) => setDraft((current) => ({ ...current, [field]: text }))}
      onStep={(direction) => setDraft((current) => stepDraft(current, field, direction, unit, distanceUnit))}
      onSubmit={() => void save()}
    />)}
    {problem && <p className="-mt-2 mb-3 text-center text-[15px] text-destructive">{problem}</p>}
    <div className="flex gap-3">
      <Button size="lg" disabled={gym.writing} onClick={() => void save()} className="flex-1 tracking-wide">{selected ? 'UPDATE' : 'SAVE'}</Button>
      <Button variant={selected ? 'destructive' : 'secondary'} size="lg" disabled={gym.writing} onClick={() => void clear()} className="flex-1 tracking-wide">
        {selected ? 'DELETE' : 'CLEAR'}
      </Button>
    </div>
    {nextInSuperset && <button type="button" onClick={onNext} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-input px-4 transition-colors hover:bg-surface-900 active:bg-surface-900">
      <span className="truncate text-[15px] font-semibold">Next in superset: {nextInSuperset.name}</span>
      <ArrowRight color={color.text} size={18} className="ml-1.5 shrink-0" />
    </button>}
    <div className="mt-5">
      {todays.map((set, index) => {
        const active = set.id === selectedId
        return <div key={set.id} className={cn('border-b border-border', active ? 'bg-surface-800' : 'hover:bg-surface-900')}>
          <div className="flex min-h-[52px] items-center pr-1">
            <button
              type="button"
              aria-label={set.comment ? `Comment: ${set.comment}` : 'Add a comment'}
              title={set.comment ? 'Edit the comment' : 'Add a comment'}
              onClick={() => setCommenting(set)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-surface-700"
            >
              <MessageSquare color={set.comment ? color.text : color.textFaint} size={20} fill={set.comment ? color.surfaceRaised : 'transparent'} />
            </button>
            <button
              type="button"
              aria-pressed={active}
              title="Select this set to change or delete it"
              onClick={() => choose(set)}
              className="flex min-h-[52px] min-w-0 flex-1 items-center text-left"
            >
              <span className="tabular w-8 text-[17px] font-bold">{index + 1}</span>
              <span className="flex-1">{records.has(set.id) && <Trophy color={color.attention} size={16} aria-label="Personal record" />}</span>
              <SetValues set={set} type={exercise.type} unit={unit} />
            </button>
          </div>
          {set.comment !== '' && <p className="-mt-1 pb-2 pl-12 text-[14px] leading-5 text-muted-foreground">{set.comment}</p>}
        </div>
      })}
    </div>
    <CommentSheet visible={commenting !== null} initial={commenting?.comment ?? ''} onClose={() => setCommenting(null)} onSave={saveComment} />
  </div>
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
  const unit = unitFor(exercise.weightUnit)
  const [history, setHistory] = useState<GymSetView[]>([])
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const request = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)
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
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    request.current += 1
    loadingRef.current = false
    setHistory([])
    setNextOffset(0)
    void loadRef.current(0)
  }, [exercise.id, gym.db, gym.version])

  useEffect(() => {
    const element = sentinel.current
    if (!element || nextOffset === null || nextOffset === 0) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadRef.current(nextOffset)
    }, { rootMargin: '600px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [nextOffset, history.length])

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
    return <div className="flex h-full items-center justify-center"><Spinner /></div>
  }
  if (sections.length === 0) {
    return <div className="flex h-full items-center justify-center px-8">
      <p className="text-center text-[16px] leading-6 text-muted-foreground">No sets logged for {exercise.name} yet.</p>
    </div>
  }
  return <div className="mx-auto w-full max-w-xl pb-8 pl-4 pr-6">
    {sections.map((section) => {
      const partnerNames = partners?.get(section.date)
      return <section key={section.date}>
        <button
          type="button"
          title="Open this day in Track"
          onClick={() => onOpenDay(section.date)}
          className="block w-full pl-3 pt-6 text-left hover:opacity-80"
        >
          <SectionLabel>{historyHeader(section.date)}</SectionLabel>
          {partnerNames && <span className="flex items-center pt-2">
            <Link2 color={color.textMuted} size={15} className="shrink-0" />
            <span className="ml-1.5 flex-1 truncate text-[14px] text-muted-foreground">Superset with {partnerNames.join(', ')}</span>
          </span>}
        </button>
        {section.data.map((item, index) => <div key={item.id} className="flex">
          <div className="relative w-3 shrink-0">
            {partners?.has(section.date) && <span
              className="absolute left-0.5 w-[3px] rounded-sm bg-foreground"
              style={{ top: index === 0 ? 8 : 0, bottom: index === section.data.length - 1 ? 8 : 0 }}
            />}
          </div>
          <div className="flex-1 py-1.5">
            <div className="flex min-h-9 items-center">
              <div className="flex-1"><SetMarks record={records.has(item.id)} comment={item.comment} /></div>
              <SetValues set={item} type={exercise.type} unit={unit} />
            </div>
            {item.comment !== '' && <p className="text-right text-[14px] text-muted-foreground">{item.comment}</p>}
          </div>
        </div>)}
      </section>
    })}
    <div ref={sentinel} />
    {loading && <div className="flex justify-center py-5"><Spinner /></div>}
  </div>
}

function Tabs({ active, onChange }: { active: number; onChange: (index: number) => void }): React.ReactElement {
  return <div role="tablist" className="flex shrink-0 border-b border-border">
    {TABS.map((tab, index) => <button
      key={tab}
      type="button"
      role="tab"
      aria-selected={index === active}
      onClick={() => onChange(index)}
      className="relative flex h-12 flex-1 items-center justify-center hover:bg-surface-900 active:bg-surface-900"
    >
      <span className={cn('text-[15px] font-bold tracking-wide', index === active ? 'text-foreground' : 'text-muted-foreground')}>{tab}</span>
      <span className={cn('absolute bottom-0 left-4 right-4 h-[3px] rounded-full', index === active ? 'bg-primary' : 'bg-transparent')} />
    </button>)}
  </div>
}

/** One exercise on one day: FitNotes' Track, History, and Graph tabs. */
export default function Track(): React.ReactElement {
  const [params] = useSearchParams()
  const exerciseId = params.get('exerciseId') ?? ''
  const gym = useGym()
  const navigate = useNavigate()
  const wide = useWideWindow()
  const [tab, setTab] = useState(0)
  const [visited, setVisited] = useState<boolean[]>([true, false, false])
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
  const recordIds = records?.recordSetIds ?? new Set<string>()

  const group = day ? supersetOf(day.supersets, exerciseId) : null
  const nextId = group ? group[(group.indexOf(exerciseId) + 1) % group.length] : null
  const nextInSuperset = nextId && nextId !== exerciseId ? gym.exercises.find((item) => item.id === nextId) ?? null : null

  const showTab = (index: number): void => {
    setTab(index)
    setVisited((current) => current.map((seen, position) => seen || position === index))
  }

  const switchTo = (id: string): void => {
    navigate(trackPath(id), { replace: true })
    showTab(0)
  }

  const page = (index: number, children: React.ReactNode): React.ReactElement => <div
    role="tabpanel"
    hidden={tab !== index}
    className="min-h-0 flex-1 overflow-y-auto"
  >{children}</div>

  return <Screen>
    <ScreenHeader title={exercise?.name ?? 'Exercise'} back="/gym" right={<>
      {!wide && <IconButton label="Today's exercises" onClick={() => setDrawer(true)}><Menu color={color.text} size={20} /></IconButton>}
      <RestTimerButton onPress={() => setResting(true)} />
      <IconButton label="Personal records" onClick={() => setShowRecords(true)}><Trophy color={color.textSecondary} size={20} /></IconButton>
      <IconButton label="Exercise details" onClick={() => setShowInfo(true)}><Info color={color.textSecondary} size={20} /></IconButton>
    </>} />
    <GymGate>
      {!exercise
        ? gym.exercises.length > 0 && <CenteredMessage
          title="This exercise is gone"
          detail="It was deleted, possibly on another device."
          action="Back to the log"
          onAction={() => navigate('/gym')}
        />
        : <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <Tabs active={tab} onChange={showTab} />
            {page(0, trackSets && <TrackPage
              exercise={exercise}
              date={gym.date}
              history={[...trackSets.today, ...(trackSets.previous ? [trackSets.previous] : [])]}
              lifetime={history}
              records={recordIds}
              nextInSuperset={nextInSuperset}
              onNext={() => nextInSuperset && switchTo(nextInSuperset.id)}
              onRecord={() => setCelebration((count) => count + 1)}
            />)}
            {page(1, visited[1] && <HistoryPage
              exercise={exercise}
              records={recordIds}
              onOpenDay={(date) => {
                gym.setDate(date)
                showTab(0)
              }}
            />)}
            {page(2, visited[2] && history && <div className="mx-auto w-full max-w-4xl px-6 py-6">
              <ExerciseGraph sets={history} type={exercise.type} weightUnit={unit} distanceUnit={distanceUnit} />
            </div>)}
          </div>
          {wide && <WorkoutPanel
            day={day}
            currentId={exerciseId}
            onSelect={switchTo}
            onAddExercise={() => navigate('/gym/exercises')}
            onHome={() => navigate('/gym')}
          />}
        </div>}
    </GymGate>
    {celebration > 0 && <Confetti key={celebration} onDone={() => setCelebration(0)} />}
    {!wide && <WorkoutDrawer
      visible={drawer}
      day={day}
      currentId={exerciseId}
      onClose={() => setDrawer(false)}
      onSelect={switchTo}
      onAddExercise={() => navigate('/gym/exercises')}
      onHome={() => navigate('/gym')}
    />}
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
    {exercise && <Sheet visible={showInfo} title={exercise.name} onClose={() => setShowInfo(false)} dismissOnBackdrop>
      <div className="flex items-center gap-2">
        <Dot color={exercise.categoryColor} />
        <span className="text-[16px]">{exercise.categoryName}<span className="text-muted-foreground">, {EXERCISE_TYPE_LABELS[exercise.type].toLowerCase()}</span></span>
      </div>
      <p className="mt-4 whitespace-pre-wrap text-[16px] leading-6 text-surface-200">{exercise.notes || 'No notes yet.'}</p>
      <p className="mt-4 text-[15px] text-muted-foreground">{exercise.setCount} {exercise.setCount === 1 ? 'set' : 'sets'} logged in total</p>
      <Button variant="outline" size="lg" onClick={() => {
        setShowInfo(false)
        navigate(`/gym/exercise-editor?id=${encodeURIComponent(exercise.id)}`, { state: { back: trackPath(exercise.id) } })
      }} className="mt-5 w-full">Edit exercise</Button>
    </Sheet>}
  </Screen>
}
