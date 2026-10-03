import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { parseIso, shiftIso } from '@ego/local/dates'
import { mondayOf, weekDates, type DayScore } from '@ego/local/habits/stats'
import { formatSpan } from '@ego/local/periods'
import { cn } from '../../lib/utils'
import { IconButton } from '../ui/button'
import { Ring } from './Ring'
import { useStepKeys } from './ui'

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const RING = 38

function weekLabel(monday: string, today: string): string {
  if (monday === mondayOf(today)) return 'This week'
  if (monday === shiftIso(mondayOf(today), -7)) return 'Last week'
  return formatSpan(monday, shiftIso(monday, 6), parseIso(today).getFullYear())
}

function DayPill({ date, today, selected, score, onPress }: {
  date: string
  today: string
  selected: boolean
  score: DayScore
  onPress: () => void
}): React.ReactElement {
  const future = date > today
  const finished = !future && score.total > 0 && score.done === score.total
  const share = future || score.total === 0 ? 0 : score.partial / score.total
  const letter = LETTERS[(parseIso(date).getDay() + 6) % 7]
  const numberColor = finished ? (selected ? 'text-white' : 'text-primary-foreground')
    : selected ? 'text-primary-foreground' : future ? 'text-surface-600' : 'text-foreground'
  const spoken = parseIso(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return <button
    type="button"
    aria-pressed={selected}
    aria-label={future ? spoken : `${spoken}, ${score.done} of ${score.total} done`}
    disabled={future}
    onClick={onPress}
    className={cn('flex flex-1 flex-col items-center rounded-2xl pb-2 pt-1.5 transition-colors',
      selected ? 'bg-primary' : 'enabled:hover:bg-surface-900 enabled:active:bg-surface-900')}
  >
    <span className={cn('text-[12px] font-semibold', selected ? 'text-surface-600' : date === today ? 'text-foreground' : 'text-surface-500')}>{letter}</span>
    <span className="relative mt-1 flex items-center justify-center" style={{ width: RING, height: RING }}>
      {finished
        ? <span className={cn('absolute inset-0 rounded-full', selected ? 'bg-surface-950' : 'bg-primary')} />
        : <Ring size={RING} share={share} track={selected ? '#d4d4d4' : '#262626'} fill={selected ? '#0a0a0a' : '#fafafa'} />}
      <span className={cn('relative text-[15px]', date === today || selected ? 'font-bold' : 'font-medium', numberColor)}>{parseIso(date).getDate()}</span>
    </span>
  </button>
}

/**
 * One week at a time. The arrows and the left and right arrow keys step a week, keeping the same
 * weekday, and never land after today.
 */
export function WeekStrip({ selected, today, scoreFor, onSelect }: {
  selected: string
  today: string
  scoreFor: (date: string) => DayScore
  onSelect: (date: string) => void
}): React.ReactElement {
  const monday = mondayOf(selected)
  const canGoForward = monday < mondayOf(today)
  const step = (delta: -1 | 1): void => {
    const next = shiftIso(selected, delta * 7)
    onSelect(next > today ? today : next)
  }
  useStepKeys(step, (delta) => delta === -1 || canGoForward)
  return <div>
    <div className="mb-1 flex items-center justify-between">
      <IconButton label="Previous week" onClick={() => step(-1)} className="h-10 w-10">
        <ChevronLeft color="#d4d4d4" size={20} />
      </IconButton>
      <span aria-live="polite" className="text-[15px] font-semibold text-surface-300">{weekLabel(monday, today)}</span>
      <IconButton label="Next week" disabled={!canGoForward} onClick={() => step(1)} className="h-10 w-10 disabled:opacity-30">
        <ChevronRight color="#d4d4d4" size={20} />
      </IconButton>
    </div>
    <div className="flex gap-1">
      {weekDates(selected).map((date) => <DayPill
        key={date}
        date={date}
        today={today}
        selected={date === selected}
        score={scoreFor(date)}
        onPress={() => onSelect(date)}
      />)}
    </div>
  </div>
}
