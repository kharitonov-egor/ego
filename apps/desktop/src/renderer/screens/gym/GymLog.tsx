import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlarmClock, BookmarkPlus, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, EllipsisVertical, Library,
  ListPlus, Plus, Settings
} from 'lucide-react'
import { DEFAULT_DISTANCE_UNIT, exerciseRecords } from '@ego/core'
import { shiftIso } from '@ego/local/dates'
import { dayBarLabel, unitFor } from '@ego/local/gym/format'
import { exerciseCountLabel, planExercises, startLabel } from '@ego/local/gym/plans'
import { cachedExerciseSets, gymDay, type GymDay, type WorkoutExercise } from '@ego/local/repositories/gym'
import { CalendarDialog } from '../../components/DatePicker'
import { RestTimerButton, RestTimerSheet } from '../../components/gym/RestTimer'
import { PickerSheet, PlanNameSheet } from '../../components/gym/sheets'
import { GymGate, SetMarks, SetValues, trackPath, useWideWindow } from '../../components/gym/ui'
import { PopupMenu, anchorBelow, type MenuAnchor } from '../../components/ui/menu'
import { WorkoutPanel } from '../../components/gym/WorkoutDrawer'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'
import { useGym, useGymQuery } from '../../lib/gym/context'
import { useRestTimer } from '../../lib/gym/rest-timer'
import { color } from '../../lib/tokens'

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
  return <div className="flex">
    {grouped !== 'none' && <div className="relative w-4 shrink-0">
      <span
        className="absolute left-1/2 w-[3px] -translate-x-1/2 rounded-sm bg-foreground"
        style={{ top: grouped === 'first' ? 18 : 0, bottom: grouped === 'last' ? 18 : 0 }}
      />
    </div>}
    <button
      type="button"
      title="Open this exercise to add or edit sets"
      onClick={onPress}
      className="mb-3 flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-card text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
    >
      <span className="w-full border-b border-border px-4 pb-2.5 pt-3.5 text-[18px] font-medium">{exercise.name}</span>
      <span className="flex w-full flex-col px-4 py-1.5">
        {sets.length === 0 && <span className="py-1.5 text-[15px] text-muted-foreground">No sets yet</span>}
        {sets.map((set) => <span key={set.id} className="flex flex-col py-1.5">
          <span className="flex min-h-8 items-center">
            <span className="flex-1"><SetMarks record={records.has(set.id)} comment={set.comment} /></span>
            <SetValues set={set} type={exercise.type} unit={unit} />
          </span>
          {set.comment !== '' && <span className="mt-0.5 text-right text-[14px] text-muted-foreground">{set.comment}</span>}
        </span>)}
      </span>
    </button>
  </div>
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

function LoggedDayBody({ day, onOpen, onStartPlan }: {
  day: GymDay
  onOpen: (exerciseId: string) => void
  onStartPlan: () => void
}): React.ReactElement {
  const gym = useGym()
  const navigate = useNavigate()
  const records = useGymQuery((db) => recordIdsForDay(db, day, gym.version), [day.date]) ?? new Set<string>()
  if (day.exercises.length === 0) {
    const noLibrary = gym.categories.length === 0
    return <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
      <h2 className="text-[20px] font-semibold">{noLibrary ? 'No exercises yet' : 'Workout log empty'}</h2>
      <p className="mt-2 max-w-md text-[16px] leading-6 text-muted-foreground">
        {noLibrary
          ? 'Add the standard exercises to start, or create your own.'
          : 'Pick an exercise to log its first set. Use the arrows or the Left and Right keys to move between days.'}
      </p>
      <div className="mt-6 flex w-full max-w-sm flex-col gap-3">
        {noLibrary
          ? <Button size="lg" disabled={gym.writing} onClick={() => void gym.addLibrary()}><Library color={color.screen} size={19} />Add standard exercises</Button>
          : <Button size="lg" onClick={() => navigate('/gym/exercises')}><Plus color={color.screen} size={19} />Start new workout</Button>}
        {!noLibrary && gym.plans.length > 0 && <Button variant="outline" size="lg" onClick={onStartPlan}>
          <ClipboardList color={color.text} size={19} />Start from a plan
        </Button>}
      </div>
    </div>
  }
  return <ScreenBody className="pb-8">
    {day.exercises.map((item, index) => <ExerciseCard
      key={item.exercise.id}
      item={item}
      records={records}
      grouped={groupPosition(day, index)}
      onPress={() => onOpen(item.exercise.id)}
    />)}
  </ScreenBody>
}

function DayBody({ day, onOpen, onStartPlan }: {
  day: GymDay | null
  onOpen: (exerciseId: string) => void
  onStartPlan: () => void
}): React.ReactElement {
  const gym = useGym()
  if (!day || day.date !== gym.date) {
    return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  }
  return <LoggedDayBody day={day} onOpen={onOpen} onStartPlan={onStartPlan} />
}

/** Left and Right step a day, unless a field, a dialog, or a menu has the keyboard. */
function useDayKeys(step: (days: number) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (document.querySelector('[aria-modal="true"], [role="menu"]')) return
      if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])
}

/** FitNotes' home: one day's workout, a card per exercise, days an arrow apart. */
export default function GymLog(): React.ReactElement {
  const gym = useGym()
  const navigate = useNavigate()
  const timer = useRestTimer()
  const wide = useWideWindow()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [resting, setResting] = useState(false)
  const [picking, setPicking] = useState(false)
  const [choosingPlan, setChoosingPlan] = useState(false)
  const [naming, setNaming] = useState(false)
  const day = useGymQuery((db) => gymDay(db, gym.date), [gym.date])
  const shown = day && day.date === gym.date ? day : null
  const { date, setDate } = gym
  const step = useCallback((days: number): void => setDate(shiftIso(date, days)), [date, setDate])
  const open = (exerciseId: string): void => {
    void navigate(trackPath(exerciseId))
  }
  useDayKeys(step)

  const saveAsPlan = async (name: string): Promise<void> => {
    if (!shown) return
    const saved = await gym.savePlan(null, {
      name, exerciseOrder: shown.exercises.map((item) => item.exercise.id), supersets: shown.supersets
    })
    if (saved) setNaming(false)
  }

  return <Screen>
    <ScreenHeader title="Gym" right={<>
      {timer.running && <RestTimerButton onPress={() => setResting(true)} />}
      <IconButton label="Calendar" onClick={() => navigate('/gym/calendar')}><CalendarDays color={color.textSecondary} size={20} /></IconButton>
      <IconButton label="Add exercise" onClick={() => navigate('/gym/exercises')}><Plus color={color.text} size={22} /></IconButton>
      <IconButton label="More options" onClick={(event) => setMenu(anchorBelow(event.currentTarget))}><EllipsisVertical color={color.textSecondary} size={20} /></IconButton>
    </>} />
    <GymGate>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center border-b border-border">
            <button type="button" aria-label="Previous day" title="Previous day (Left)" onClick={() => step(-1)} className="flex h-12 w-14 items-center justify-center hover:bg-surface-900 active:bg-surface-900">
              <ChevronLeft color={color.text} size={24} />
            </button>
            <button type="button" title="Pick a day" onClick={() => setPicking(true)} className="flex h-12 flex-1 items-center justify-center hover:bg-surface-900 active:bg-surface-900">
              <span aria-live="polite" className="text-[16px] font-bold tracking-wide">{dayBarLabel(gym.date)}</span>
            </button>
            <button type="button" aria-label="Next day" title="Next day (Right)" onClick={() => step(1)} className="flex h-12 w-14 items-center justify-center hover:bg-surface-900 active:bg-surface-900">
              <ChevronRight color={color.text} size={24} />
            </button>
          </div>
          <DayBody day={day} onOpen={open} onStartPlan={() => setChoosingPlan(true)} />
        </div>
        {wide && <WorkoutPanel day={shown} currentId={null} onSelect={open} onAddExercise={() => navigate('/gym/exercises')} />}
      </div>
    </GymGate>
    <PopupMenu anchor={menu} title="Gym" onClose={() => setMenu(null)} items={[
      { label: 'Rest timer', Icon: AlarmClock, onPress: () => setResting(true) },
      { label: 'Plans', Icon: ClipboardList, onPress: () => navigate('/gym/plans') },
      { label: 'Start from a plan', Icon: ListPlus, disabled: gym.plans.length === 0, onPress: () => setChoosingPlan(true) },
      { label: 'Save day as plan', Icon: BookmarkPlus, disabled: !shown || shown.exercises.length === 0, onPress: () => setNaming(true) },
      { label: 'All exercises', Icon: Library, onPress: () => navigate('/gym/exercises') },
      { label: 'Settings', Icon: Settings, onPress: () => navigate('/settings') }
    ]} />
    <PickerSheet
      visible={choosingPlan}
      title={startLabel(gym.date)}
      options={gym.plans.map((plan) => ({
        value: plan.id, label: plan.name, detail: exerciseCountLabel(planExercises(plan, gym.exercises).length)
      }))}
      value={null}
      onPick={(id) => {
        const plan = gym.plans.find((item) => item.id === id)
        if (plan) void gym.startPlan(gym.date, plan)
      }}
      onClose={() => setChoosingPlan(false)}
    />
    <PlanNameSheet visible={naming} onClose={() => setNaming(false)} onSave={(name) => void saveAsPlan(name)} />
    <RestTimerSheet visible={resting} onClose={() => setResting(false)} />
    <CalendarDialog
      visible={picking}
      value={gym.date}
      onCancel={() => setPicking(false)}
      onConfirm={(iso) => {
        setPicking(false)
        gym.setDate(iso)
      }}
    />
  </Screen>
}
