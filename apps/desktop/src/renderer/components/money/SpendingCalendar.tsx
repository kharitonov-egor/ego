import React, { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { MoneyTransaction } from '@ego/core'
import { heatLevels } from '@ego/local/cash-flow'
import { WEEKDAYS, parseIso, shiftIso } from '@ego/local/dates'
import { daysBetween, type Span } from '@ego/local/periods'
import { BlurSpan } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { SERIES_COLOR } from './CashFlowChart'
import { money } from './Common'

/** One hue, darker to brighter, on the card surface: a sequential scale, not five categories. */
const SHADES = ['#1c1c1c', `${SERIES_COLOR.expense}40`, `${SERIES_COLOR.expense}73`, `${SERIES_COLOR.expense}b3`, SERIES_COLOR.expense]
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
const DAY_TITLE = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

interface Day {
  iso: string
  day: number
  cents: number
  count: number
}

export function SpendingCalendar({ month, transactions, today, onOpenDay }: {
  month: Span
  transactions: readonly MoneyTransaction[]
  today: string
  onOpenDay: (iso: string) => void
}): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => setSelected(null), [month.from])

  const days = useMemo((): Day[] => {
    const totals = new Map<string, { cents: number; count: number }>()
    for (const item of transactions) {
      if (item.kind !== 'expense') continue
      const entry = totals.get(item.date) ?? { cents: 0, count: 0 }
      entry.cents += item.amountCents
      entry.count += 1
      totals.set(item.date, entry)
    }
    return Array.from({ length: daysBetween(month.from, month.to) + 1 }, (_, index) => {
      const iso = shiftIso(month.from, index)
      const entry = totals.get(iso)
      return { iso, day: index + 1, cents: entry?.cents ?? 0, count: entry?.count ?? 0 }
    })
  }, [month.from, month.to, transactions])
  const levels = useMemo(() => heatLevels(days.map((day) => day.cents)), [days])

  const leading = (parseIso(month.from).getDay() + 6) % 7
  const cells: (number | null)[] = [...Array.from({ length: leading }, () => null), ...days.map((_, index) => index)]
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
  const chosen = days.find((day) => day.iso === selected)

  return <Card>
    <CardHeader>
      <CardTitle>Spending by day</CardTitle>
      <CardDescription>Brighter days cost more. Click one to see it.</CardDescription>
    </CardHeader>
    <CardContent className="pt-4">
      <div className="grid grid-cols-7">{MONDAY_FIRST.map((weekday) => <span key={weekday} className="text-center text-[13px] font-medium text-muted-foreground">{WEEKDAYS[weekday]}</span>)}</div>
      <div className="mt-1.5 flex flex-col gap-1.5">{weeks.map((week, row) => <div key={row} className="grid grid-cols-7 gap-1.5">{week.map((cell, column) => {
        if (cell === null) return <span key={column} className="aspect-square" />
        const day = days[cell]
        const future = day.iso > today
        const active = day.iso === selected
        return <button
          key={column}
          type="button"
          aria-pressed={active}
          aria-label={`${DAY_TITLE.format(parseIso(day.iso))}, ${future ? 'not yet' : `spent ${money(day.cents)}`}`}
          disabled={future}
          onClick={() => setSelected(active ? null : day.iso)}
          onDoubleClick={() => onOpenDay(day.iso)}
          className="flex aspect-square items-center justify-center rounded-lg transition-[filter] hover:brightness-125 disabled:hover:brightness-100"
          style={{
            backgroundColor: future ? 'transparent' : SHADES[levels[cell]],
            borderWidth: active || day.iso === today ? 2 : future ? 1 : 0,
            borderStyle: 'solid',
            borderColor: active ? '#fafafa' : day.iso === today ? '#737373' : '#262626'
          }}
        >
          <span className={cn('text-[14px] font-semibold', future ? 'text-surface-600' : levels[cell] === 0 ? 'text-muted-foreground' : 'text-white')}>{day.day}</span>
        </button>
      })}</div>)}</div>

      {chosen
        ? <div className="mt-4 flex items-center rounded-2xl bg-surface-900 py-2 pl-4 pr-2">
          <div className="flex flex-1 flex-col">
            <span className="font-semibold">{DAY_TITLE.format(parseIso(chosen.iso))}</span>
            <span className="text-[14px] text-muted-foreground">
              {chosen.count === 0
                ? 'No spending'
                : <><BlurSpan>{money(chosen.cents)}</BlurSpan> across {chosen.count} {chosen.count === 1 ? 'purchase' : 'purchases'}</>}
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onOpenDay(chosen.iso)}>
            Open
            <ChevronRight color="#fafafa" size={16} />
          </Button>
        </div>
        : <div className="mt-4 flex items-center justify-end gap-1.5">
          <span className="mr-1 text-[13px] text-muted-foreground">Less</span>
          {SHADES.map((shade) => <span key={shade} className="h-3.5 w-3.5 rounded" style={{ backgroundColor: shade }} />)}
          <span className="ml-1 text-[13px] text-muted-foreground">More</span>
        </div>}
    </CardContent>
  </Card>
}
