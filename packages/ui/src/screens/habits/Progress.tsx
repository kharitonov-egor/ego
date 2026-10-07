import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { CalendarDays, ChevronLeft, ChevronRight, Flame, Trophy, X } from 'lucide-react'
import { formatMonth, shiftMonth } from '@ego/local/dates'
import { habitRates, monthSummary, streaks } from '@ego/local/habits/stats'
import { MonthCalendar } from '../../components/habits/MonthCalendar'
import { HabitIcon, HabitsError, HabitsGate, HabitsHeader, HabitsMessage, StatTile, plural, useStepKeys } from '../../components/habits/ui'
import { Screen, ScreenBody } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { BlurBlob, BlurSpan, Blurred, useBlur } from '../../lib/blur'
import { useHabits } from '../../lib/habits/context'
import { cn } from '../../lib/utils'

function percent(done: number, possible: number): number {
  return possible === 0 ? 0 : Math.round((done / possible) * 100)
}

function Bar({ share, thin = false }: { share: number; thin?: boolean }): React.ReactElement {
  return <div className={cn(thin ? 'h-1' : 'h-2', 'overflow-hidden rounded-full bg-surface-800')}>
    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
  </div>
}

/** The phone's single column, split in two on a wide window: the month on the left, streaks and habits on the right. */
function ProgressBody(): React.ReactElement {
  const habits = useHabits()
  const { blurred } = useBlur()
  const navigate = useNavigate()
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

  const step = (delta: -1 | 1): void => setMonth((value) => shiftMonth(value, delta))
  const canStep = (delta: -1 | 1): boolean => building.length > 0 && (delta === -1 ? month > first : month < current)
  useStepKeys(step, canStep)

  if (building.length === 0) {
    return <HabitsMessage
      Icon={CalendarDays}
      title="Nothing to show yet"
      detail="Add a habit on Home. Each day you check things off lights up here."
    />
  }

  const rate = percent(summary.done, summary.possible)

  return <ScreenBody width="wide">
    <HabitsError />
    <div className="flex items-center justify-between">
      <IconButton label="Previous month" disabled={!canStep(-1)} onClick={() => step(-1)} className="h-11 w-11 disabled:opacity-30">
        <ChevronLeft color="#fafafa" size={22} />
      </IconButton>
      <h2 aria-live="polite" className="text-[20px] font-bold tracking-tight text-foreground">{formatMonth(month)}</h2>
      <IconButton label="Next month" disabled={!canStep(1)} onClick={() => step(1)} className="h-11 w-11 disabled:opacity-30">
        <ChevronRight color="#fafafa" size={22} />
      </IconButton>
    </div>

    <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <Card className="border-0">
          <CardContent>
            <div className="flex items-end justify-between">
              <span className="tabular text-[40px] font-bold tracking-tight text-foreground">{`${rate}%`}</span>
              <span className="tabular mb-2 text-[15px] text-muted-foreground">
                {summary.possible === 0 ? 'Nothing due yet' : `${summary.done} of ${summary.possible} targets met`}
              </span>
            </div>
            <div
              className="mt-3"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={rate}
              aria-label={`${rate} percent of ${focused ? focused.name : 'habits'} done in ${formatMonth(month)}`}
            >
              <Bar share={summary.possible === 0 ? 0 : summary.done / summary.possible} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-0">
          <CardContent>
            {focused && <button
              type="button"
              aria-label={`Showing ${focused.name}. Show all habits`}
              onClick={() => setFocus(null)}
              className="mb-4 inline-flex items-center rounded-full bg-primary py-1.5 pl-3 pr-2.5 hover:bg-primary/90"
            >
              {blurred ? <BlurBlob size={14} tint="#0a0a0a" /> : <span aria-hidden className="text-[14px] leading-none text-primary-foreground">{focused.icon}</span>}
              <Blurred><span className="ml-1.5 max-w-[16rem] truncate text-[14px] font-semibold text-primary-foreground">{focused.name}</span></Blurred>
              <X color="#0a0a0a" size={15} className="ml-1.5" />
            </button>}
            <MonthCalendar
              days={summary.days}
              today={today}
              selected={habits.date}
              onOpenDay={(date) => {
                habits.setDate(date)
                navigate('/habits/home')
              }}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          <StatTile Icon={Flame} label="Current streak" value={plural(runs.current, runs.unit)} />
          <StatTile Icon={Trophy} label="Best streak" value={plural(runs.best, runs.unit)} />
        </div>
        <p className="-mt-1 px-1 text-[13px] leading-5 text-surface-500">
          {runs.unit === 'week'
            ? focused ? <>Weeks in a row with <BlurSpan>{focused.name}</BlurSpan> on target.</> : 'Weeks in a row with every weekly habit on target.'
            : focused ? <>Days in a row with <BlurSpan>{focused.name}</BlurSpan> done.</> : 'Days in a row with every daily habit done.'}
        </p>

        <Card className="overflow-hidden border-0">
          <CardHeader className="pb-3"><CardTitle>This month by habit</CardTitle></CardHeader>
          {rates.map(({ habit, done, possible, unit }) => {
            const selected = habit.id === focus
            return <button
              key={habit.id}
              type="button"
              aria-pressed={selected}
              aria-label={`${habit.name}, ${done} of ${possible} ${unit}s, ${percent(done, possible)} percent`}
              title={selected ? 'Show every habit on the calendar' : 'Show only this habit on the calendar'}
              onClick={() => setFocus(selected ? null : habit.id)}
              className={cn('flex w-full items-center border-t border-surface-800 px-5 py-3 text-left transition-colors hover:bg-surface-900 active:bg-surface-900', selected && 'bg-surface-900')}
            >
              <HabitIcon icon={habit.icon} size={40} />
              <div className="ml-3 min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <Blurred><span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">{habit.name}</span></Blurred>
                  <span className="tabular ml-3 shrink-0 text-[14px] text-muted-foreground">
                    {possible === 0
                      ? unit === 'week' ? 'No full week yet' : 'Not started'
                      : `${done}/${possible} ${unit}s · ${percent(done, possible)}%`}
                  </span>
                </div>
                <div className="mt-2"><Bar thin share={possible === 0 ? 0 : done / possible} /></div>
              </div>
            </button>
          })}
        </Card>
      </div>
    </div>
  </ScreenBody>
}

export default function HabitsProgress(): React.ReactElement {
  return <Screen>
    <HabitsHeader />
    <HabitsGate><ProgressBody /></HabitsGate>
  </Screen>
}
