import React, { useCallback, useMemo } from 'react'
import { Check, ListChecks, Minus, Pencil, Plus } from 'lucide-react'
import type { HabitRecord } from '@ego/api-contracts'
import { formatIso, parseIso, shiftIso } from '@ego/local/dates'
import { dayScore, mondayOf, rowState, type RowState } from '@ego/local/habits/stats'
import { Ring } from '../../components/habits/Ring'
import { HabitIcon, HabitsError, HabitsGate, HabitsHeader } from '../../components/habits/ui'
import { WeekStrip } from '../../components/habits/WeekStrip'
import { Screen, ScreenBody } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { Blurred } from '../../lib/blur'
import { useHabits } from '../../lib/habits/context'
import { cn } from '../../lib/utils'

function dayTitle(date: string, today: string): string {
  if (date === today) return 'Today'
  if (date === shiftIso(today, -1)) return 'Yesterday'
  return parseIso(date).toLocaleDateString('en-US', { weekday: 'long' })
}

const MARK = 32

function subtitle(habit: HabitRecord, state: RowState, thisWeek: boolean): string | null {
  if (habit.period === 'week') {
    if (state.met) return thisWeek ? 'Done for this week' : 'Done that week'
    return `${state.progress} of ${state.target} ${thisWeek ? 'this week' : 'that week'}`
  }
  return habit.target > 1 ? `${Math.min(state.today, state.target)} of ${state.target} times` : null
}

/**
 * Filled with a check once the day is done. A weekly habit met on other days shows a hollow check,
 * and a count in progress shows its number inside the ring.
 */
function Mark({ habit, state }: { habit: HabitRecord; state: RowState }): React.ReactElement {
  const filled = habit.period === 'week' ? state.today > 0 : state.met
  if (filled) {
    return <span className="pointer-events-none flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary">
      <Check color="#0a0a0a" size={18} strokeWidth={3} />
    </span>
  }
  return <span className="pointer-events-none relative flex shrink-0 items-center justify-center" style={{ width: MARK, height: MARK }}>
    <Ring size={MARK} share={state.progress / state.target} track="#404040" fill="#fafafa" />
    {habit.period === 'week' && state.met
      ? <Check color="#fafafa" size={16} strokeWidth={3} />
      : habit.period === 'day' && habit.target > 1 && state.today > 0
        ? <span className="tabular text-[13px] font-bold text-foreground">{state.today}</span>
        : null}
  </span>
}

/**
 * The phone taps to add and holds to take back. Here a click adds, and a right-click, Delete, or
 * the minus that shows on hover takes one back. The click target covers the whole row, with the
 * row's own buttons above it.
 */
export function HabitRow({ habit, state, thisWeek, onTap, onTakeBack, onEdit }: {
  habit: HabitRecord
  state: RowState
  thisWeek: boolean
  onTap: () => void
  onTakeBack: () => void
  onEdit: () => void
}): React.ReactElement {
  const note = subtitle(habit, state, thisWeek)
  const settled = habit.period === 'week' ? state.today > 0 || state.met : state.met
  const toggles = habit.period === 'week' || habit.target === 1
  const counts = !toggles && state.today > 0
  return <div className="group relative flex min-h-[68px] items-center rounded-2xl bg-card py-3 pl-3 pr-2 transition-colors hover:bg-surface-900 active:bg-surface-900">
    <button
      type="button"
      role={toggles ? 'checkbox' : undefined}
      aria-checked={toggles ? state.today > 0 : undefined}
      aria-label={note ? `${habit.name}, ${note}` : habit.name}
      aria-description={toggles || state.met ? undefined : 'Adds one'}
      onClick={onTap}
      onContextMenu={(event) => {
        event.preventDefault()
        onTakeBack()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        event.preventDefault()
        onTakeBack()
      }}
      className="absolute inset-0 rounded-2xl"
    />
    <HabitIcon icon={habit.icon} />
    <div className="pointer-events-none ml-3 min-w-0 flex-1">
      <Blurred><p className={cn('line-clamp-2 break-words text-[17px] font-semibold', settled ? 'text-surface-400' : 'text-foreground')}>{habit.name}</p></Blurred>
      {note && <p className="tabular mt-0.5 text-[14px] text-muted-foreground">{note}</p>}
    </div>
    {counts && <button
      type="button"
      aria-label={`Take one back from ${habit.name}`}
      onClick={onTakeBack}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-surface-800 focus-visible:opacity-100 active:bg-surface-800 group-hover:opacity-100"
    ><Minus color="#a3a3a3" size={17} /></button>}
    <button
      type="button"
      aria-label={`Edit ${habit.name}`}
      onClick={onEdit}
      className="relative mx-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-800 active:bg-surface-800"
    ><Pencil color="#737373" size={17} /></button>
    <Mark habit={habit} state={state} />
  </div>
}

function HomeBody(): React.ReactElement {
  const habits = useHabits()
  const { date, today, log } = habits
  const building = useMemo(() => (habits.habits ?? []).filter((habit) => habit.kind === 'build'), [habits.habits])
  const due = building.filter((habit) => habit.startDate <= date)
  const scoreFor = useCallback((day: string) => dayScore(building, log, day), [building, log])
  const score = scoreFor(date)
  const share = score.total === 0 ? 0 : score.done / score.total

  return <ScreenBody>
    <HabitsError />
    <WeekStrip selected={date} today={today} scoreFor={scoreFor} onSelect={habits.setDate} />
    <div className="mt-5 flex items-end justify-between">
      <div className="flex-1">
        <h2 aria-live="polite" className="text-[26px] font-bold tracking-tight text-foreground">{dayTitle(date, today)}</h2>
        <p className="mt-0.5 text-[15px] text-muted-foreground">{formatIso(date)}</p>
      </div>
      {score.total > 0 && <span className="tabular text-[15px] font-semibold text-surface-300">
        {score.done === score.total ? 'All done' : `${score.done} of ${score.total} done`}
      </span>}
    </div>
    {score.total > 0 && <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={score.total}
      aria-valuenow={score.done}
      className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-800"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
    </div>}
    {date !== today && <button type="button" onClick={() => habits.setDate(today)} className="mt-3 text-[14px] font-semibold text-foreground underline">
      Back to today
    </button>}

    {building.length === 0
      ? <div className="mt-10 flex flex-col items-center px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><ListChecks color="#a3a3a3" size={30} /></div>
        <h3 className="mt-4 text-[20px] font-semibold text-surface-100">No habits yet</h3>
        <p className="mt-2 text-[16px] leading-6 text-surface-400">Add the things you want to do every day. Click one to check it off.</p>
        <Button className="mt-5" onClick={() => habits.openEditor({ kind: 'build', habit: null })}>
          <Plus color="#0a0a0a" size={18} />Add a habit
        </Button>
      </div>
      : <div className="mt-5 flex flex-col gap-2">
        {due.length === 0 && <p className="py-6 text-center text-[15px] text-muted-foreground">None of your habits had started on this day.</p>}
        {due.map((habit) => <HabitRow
          key={habit.id}
          habit={habit}
          state={rowState(habit, log, date)}
          thisWeek={mondayOf(date) === mondayOf(today)}
          onTap={() => void habits.tap(habit, date)}
          onTakeBack={() => void habits.takeBack(habit, date)}
          onEdit={() => habits.openEditor({ kind: 'build', habit })}
        />)}
        <p className="mt-3 text-center text-[13px] text-surface-500">Click to check off. Right-click to take one back.</p>
      </div>}
  </ScreenBody>
}

export default function HabitsHome(): React.ReactElement {
  return <Screen>
    <HabitsHeader add="build" />
    <HabitsGate><HomeBody /></HabitsGate>
  </Screen>
}
