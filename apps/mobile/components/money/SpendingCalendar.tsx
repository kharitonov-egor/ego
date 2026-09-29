import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { MoneyTransaction } from '@ego/core'
import { heatLevels } from '../../lib/cash-flow'
import { WEEKDAYS, parseIso, shiftIso } from '../../lib/dates'
import { daysBetween, type Span } from '../../lib/periods'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Text } from '../ui/text'
import { SERIES_COLOR } from './CashFlowChart'
import { money } from './Common'
import { color } from './tokens'
import { BlurSpan } from '../../lib/blur'

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
      <CardDescription>Brighter days cost more. Tap one to see it.</CardDescription>
    </CardHeader>
    <CardContent className="pt-4">
      <View className="flex-row">{MONDAY_FIRST.map((weekday) => <Text key={weekday} className="flex-1 text-center text-[13px] font-medium text-muted-foreground">{WEEKDAYS[weekday]}</Text>)}</View>
      <View className="mt-1.5 gap-1.5">{weeks.map((week, row) => <View key={row} className="flex-row gap-1.5">{week.map((cell, column) => {
        if (cell === null) return <View key={column} className="aspect-square flex-1" />
        const day = days[cell]
        const future = day.iso > today
        const active = day.iso === selected
        return <Pressable
          key={column}
          accessibilityRole="button"
          accessibilityState={{ selected: active, disabled: future }}
          accessibilityLabel={`${DAY_TITLE.format(parseIso(day.iso))}, ${future ? 'not yet' : `spent ${money(day.cents)}`}`}
          disabled={future}
          onPress={() => setSelected(active ? null : day.iso)}
          className="aspect-square flex-1 items-center justify-center rounded-lg"
          style={{
            backgroundColor: future ? 'transparent' : SHADES[levels[cell]],
            borderWidth: active || day.iso === today ? 2 : future ? 1 : 0,
            borderColor: active ? '#fafafa' : day.iso === today ? '#737373' : '#262626'
          }}
        >
          <Text className={`text-[14px] font-semibold ${future ? 'text-surface-600' : levels[cell] === 0 ? 'text-muted-foreground' : 'text-white'}`}>{day.day}</Text>
        </Pressable>
      })}</View>)}</View>

      {chosen
        ? <View className="mt-4 flex-row items-center rounded-2xl bg-surface-900 py-2 pl-4 pr-2">
          <View className="flex-1">
            <Text className="font-semibold">{DAY_TITLE.format(parseIso(chosen.iso))}</Text>
            <Text className="text-[14px] text-muted-foreground">
              {chosen.count === 0
                ? 'No spending'
                : <><BlurSpan tint={color.textMuted}>{money(chosen.cents)}</BlurSpan> across {chosen.count} {chosen.count === 1 ? 'purchase' : 'purchases'}</>}
            </Text>
          </View>
          <Button variant="secondary" size="sm" onPress={() => onOpenDay(chosen.iso)}>
            <Text>Open</Text>
            <ChevronRight color="#fafafa" size={16} />
          </Button>
        </View>
        : <View className="mt-4 flex-row items-center justify-end gap-1.5">
          <Text className="mr-1 text-[13px] text-muted-foreground">Less</Text>
          {SHADES.map((shade) => <View key={shade} className="h-3.5 w-3.5 rounded" style={{ backgroundColor: shade }} />)}
          <Text className="ml-1 text-[13px] text-muted-foreground">More</Text>
        </View>}
    </CardContent>
  </Card>
}
