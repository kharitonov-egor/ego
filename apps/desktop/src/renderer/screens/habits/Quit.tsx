import React, { useEffect, useMemo, useState } from 'react'
import { Ban, Pencil, Plus, Trophy } from 'lucide-react'
import type { HabitRecord } from '@ego/api-contracts'
import { momentLabel, runLabel, runSpoken, twoDigits } from '@ego/local/habits/format'
import { quitClock, splitDuration } from '@ego/local/habits/stats'
import { HabitIcon, HabitsError, HabitsGate, HabitsHeader } from '../../components/habits/ui'
import { Screen, ScreenBody } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Blurred } from '../../lib/blur'
import { useHabits } from '../../lib/habits/context'
import { cn } from '../../lib/utils'

/** Ticks once a second while Quit is open. */
function useNow(): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function Unit({ value, label }: { value: number; label: string }): React.ReactElement {
  return <span className="flex items-baseline">
    <span className="tabular text-[24px] font-semibold text-foreground">{twoDigits(value)}</span>
    <span className="ml-1 text-[15px] text-muted-foreground">{label}</span>
  </span>
}

function QuitCard({ habit, now }: { habit: HabitRecord; now: number }): React.ReactElement {
  const habits = useHabits()
  const clock = useMemo(() => quitClock(habit, habits.log), [habit, habits.log])
  const running = Math.max(0, now - clock.since)
  const { days, hours, minutes, seconds } = splitDuration(running)
  const best = Math.max(clock.bestEnded, running)

  return <Card className="border-0 p-5">
    <div className="flex items-center">
      <HabitIcon icon={habit.icon} size={48} />
      <div className="ml-3 min-w-0 flex-1">
        <Blurred><p className="line-clamp-2 break-words text-[18px] font-semibold text-foreground">{habit.name}</p></Blurred>
        <p className="mt-0.5 text-[14px] text-muted-foreground">
          {`${clock.restarted ? 'Restarted' : 'Clean since'} ${momentLabel(clock.since)}`}
        </p>
      </div>
      <button
        type="button"
        aria-label={`Edit ${habit.name}`}
        onClick={() => habits.openEditor({ kind: 'break', habit })}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface-800 active:bg-surface-800"
      ><Pencil color="#a3a3a3" size={19} /></button>
    </div>

    <div role="timer" aria-label={`${runSpoken(running)} clean`} className="mt-5 flex flex-col items-center">
      <span aria-hidden className="tabular text-[64px] font-bold leading-[70px] tracking-tight text-foreground">{days}</span>
      <span aria-hidden className="text-[15px] font-medium text-muted-foreground">{days === 1 ? 'day' : 'days'}</span>
      <div aria-hidden className="mt-4 flex gap-6">
        <Unit value={hours} label="h" />
        <Unit value={minutes} label="m" />
        <Unit value={seconds} label="s" />
      </div>
    </div>

    <div role="group" aria-label={`Best run, ${runSpoken(best)}`} className="mt-5 flex items-center border-t border-border pt-4">
      <Trophy color="#a3a3a3" size={16} />
      <span className="ml-2 flex-1 text-[15px] font-medium text-muted-foreground">Best run</span>
      <span className="tabular text-[16px] font-semibold text-foreground">{runLabel(best)}</span>
    </div>
  </Card>
}

function QuitBody(): React.ReactElement {
  const habits = useHabits()
  const now = useNow()
  const breaking = (habits.habits ?? []).filter((habit) => habit.kind === 'break')
  if (breaking.length === 0) {
    return <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-950 px-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Ban color="#a3a3a3" size={30} /></div>
      <h2 className="mt-4 text-[20px] font-semibold text-surface-100">Nothing to quit yet</h2>
      <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">
        Add a habit you want to break. A clock counts the time since you quit, down to the second.
      </p>
      <Button className="mt-5" onClick={() => habits.openEditor({ kind: 'break', habit: null })}>
        <Plus color="#0a0a0a" size={18} />Add a habit to break
      </Button>
    </div>
  }
  const several = breaking.length > 1
  return <ScreenBody width={several ? 'medium' : 'narrow'}>
    <HabitsError />
    <div className={cn('grid gap-3', several && 'lg:grid-cols-2')}>
      {breaking.map((habit) => <QuitCard key={habit.id} habit={habit} now={now} />)}
    </div>
    <p className="mt-4 text-center text-[13px] text-surface-500">To restart a clock, open it with the pencil.</p>
  </ScreenBody>
}

export default function HabitsQuit(): React.ReactElement {
  return <Screen>
    <HabitsHeader add="break" />
    <HabitsGate><QuitBody /></HabitsGate>
  </Screen>
}
