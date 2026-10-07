import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { isoFromParts, isoToday, shiftMonth } from '@ego/local/dates'
import { gymCalendar } from '@ego/local/repositories/gym'
import { Dot, GymGate } from '../../components/gym/ui'
import { Screen, ScreenHeader } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { useGym, useGymQuery } from '../../lib/gym/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const FUTURE_MONTHS = 6
const PAST_MONTHS = 12

/** Weeks start on Monday, the way the FitNotes calendar lays them out. */
function mondayGrid(month: string): (number | null)[][] {
  const [year, index] = month.split('-').map(Number)
  const leading = (new Date(year, index - 1, 1).getDay() + 6) % 7
  const days = new Date(year, index, 0).getDate()
  const cells: (number | null)[] = [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, day) => day + 1)]
  while (cells.length % 7 !== 0) cells.push(null)
  return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
}

function monthTitle(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return new Date(year, index - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()
}

function monthsBetween(first: string, last: string): string[] {
  const months: string[] = []
  for (let month = first; month <= last; month = shiftMonth(month, 1)) months.push(month)
  return months
}

const MonthBlock = React.memo(function MonthBlock({ month, selected, today, colors, onPick }: {
  month: string
  selected: string
  today: string
  colors: Map<string, string[]>
  onPick: (iso: string) => void
}): React.ReactElement {
  const [year, index] = month.split('-').map(Number)
  return <section data-month={month} className="pb-3">
    <h2 className="flex h-14 items-center justify-center text-[18px] font-semibold">{monthTitle(month)}</h2>
    <div className="flex h-8 items-center">
      {WEEKDAYS.map((day) => <span key={day} className="flex-1 text-center text-[13px] font-medium text-muted-foreground">{day}</span>)}
    </div>
    {mondayGrid(month).map((week, row) => <div key={row} className="flex h-14">
      {week.map((day, column) => {
        if (day === null) return <span key={column} className="flex-1" />
        const iso = isoFromParts(year, index - 1, day)
        const dots = colors.get(iso) ?? []
        const isSelected = iso === selected
        const isToday = iso === today
        return <button
          key={column}
          type="button"
          aria-pressed={isSelected}
          aria-label={`${new Date(year, index - 1, day).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${dots.length > 0 ? ', workout logged' : ''}`}
          onClick={() => onPick(iso)}
          className="group flex flex-1 flex-col items-center pt-1.5"
        >
          <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-[17px] transition-colors',
            isSelected ? 'bg-primary font-bold text-primary-foreground' : isToday ? 'font-bold text-foreground group-hover:bg-surface-800' : 'text-surface-400 group-hover:bg-surface-800')}>{day}</span>
          <span className="mt-1 flex h-2 gap-[3px]">
            {dots.slice(0, 5).map((dot, dotIndex) => <Dot key={dotIndex} color={dot} size={7} />)}
          </span>
        </button>
      })}
    </div>)}
  </section>
})

/**
 * Every month with workouts, a few rows of them at a time on a wide window. A dot per muscle group
 * trained marks each workout day, in the category's color.
 */
function CalendarBody(): React.ReactElement {
  const gym = useGym()
  const navigate = useNavigate()
  const days = useGymQuery((db) => gymCalendar(db), [])
  const scroller = useRef<HTMLDivElement>(null)
  const today = isoToday()
  const [visible, setVisible] = useState(0)

  const colors = useMemo(() => new Map((days ?? []).map((day) => [day.date, day.colors])), [days])
  const months = useMemo(() => {
    const current = today.slice(0, 7)
    const earliest = days && days.length > 0 ? days[0].date.slice(0, 7) : current
    const back = shiftMonth(current, -PAST_MONTHS)
    return monthsBetween(earliest < back ? earliest : back, shiftMonth(current, FUTURE_MONTHS))
  }, [days, today])
  const ready = days !== null

  const pick = useCallback((iso: string) => {
    gym.setDate(iso)
    navigate('/gym')
  }, [gym.setDate, navigate])

  const blockOf = (month: string): HTMLElement | null =>
    scroller.current?.querySelector<HTMLElement>(`[data-month="${month}"]`) ?? null

  // The chosen month sits at the bottom, so the weeks before it fill the window rather than empty future months.
  useEffect(() => {
    if (!ready) return
    blockOf(gym.date.slice(0, 7))?.scrollIntoView({ block: 'end' })
  }, [ready])

  useEffect(() => {
    const root = scroller.current
    if (!root || !ready) return
    const onScroll = (): void => {
      const top = root.getBoundingClientRect().top
      const index = months.findIndex((month) => (blockOf(month)?.getBoundingClientRect().bottom ?? 0) > top + 24)
      if (index !== -1) setVisible(index)
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [months, ready])

  /** One row of months, however many fit across the window. */
  const scrollRow = (direction: -1 | 1): void => {
    const first = blockOf(months[visible])
    if (!first) return
    const rowTop = first.getBoundingClientRect().top
    const perRow = months.filter((month) => Math.abs((blockOf(month)?.getBoundingClientRect().top ?? -1) - rowTop) < 2).length
    const target = months[Math.max(0, Math.min(months.length - 1, visible + direction * Math.max(1, perRow)))]
    blockOf(target)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  if (!days) return <div className="flex-1" />
  const legend = gym.categories.filter((category) => category.exerciseCount > 0)

  return <div className="flex min-h-0 flex-1 flex-col">
    {legend.length > 0 && <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 border-b border-border px-5 py-1">
      {legend.map((category) => <span key={category.id} className="flex h-10 items-center gap-1.5">
        <Dot color={category.color} size={8} />
        <span className="text-[14px] text-muted-foreground">{category.name}</span>
      </span>)}
    </div>}
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-x-8 px-6">
        {months.map((month) => <MonthBlock key={month} month={month} selected={gym.date} today={today} colors={colors} onPick={pick} />)}
      </div>
    </div>
    <div className="flex shrink-0 items-center border-t border-border bg-card">
      <button type="button" aria-label="Earlier months" title="Earlier months" onClick={() => scrollRow(-1)} className="flex h-14 w-16 items-center justify-center hover:bg-surface-800 active:bg-surface-800">
        <ChevronLeft color={color.text} size={24} />
      </button>
      <span className="flex-1 text-center text-[15px] font-bold tracking-wide text-surface-200">{`${days.length} ${days.length === 1 ? 'WORKOUT' : 'WORKOUTS'}`}</span>
      <button type="button" aria-label="Later months" title="Later months" onClick={() => scrollRow(1)} className="flex h-14 w-16 items-center justify-center hover:bg-surface-800 active:bg-surface-800">
        <ChevronRight color={color.text} size={24} />
      </button>
    </div>
  </div>
}

export default function GymCalendar(): React.ReactElement {
  const gym = useGym()
  const navigate = useNavigate()
  return <Screen>
    <ScreenHeader title="Calendar" back="/gym" right={<IconButton label="Go to today" onClick={() => {
      gym.setDate(isoToday())
      navigate('/gym')
    }}><CalendarCheck color={color.textSecondary} size={20} /></IconButton>} />
    <GymGate><CalendarBody /></GymGate>
  </Screen>
}
