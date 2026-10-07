import React, { useMemo } from 'react'
import type { MoneySnapshot } from '@ego/core'
import { parseIso } from '@ego/local/dates'
import { dueLabel, monthlyTotal, recurringCharges, upcomingCharges } from '@ego/local/recurring'
import { BlurSpan, Blurred } from '../../lib/blur'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { MoneyIcon, money } from './Common'

const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const shortDate = (iso: string): string => SHORT_DATE.format(parseIso(iso))

/** Monthly charges found in the history, with the ones due this week listed. Hidden until one exists. */
export function UpcomingBills({ snapshot, today }: { snapshot: MoneySnapshot; today: string }): React.ReactElement | null {
  const charges = useMemo(() => recurringCharges(snapshot.transactions, today), [snapshot.transactions, today])
  const categories = useMemo(() => new Map(snapshot.categories.map((category) => [category.id, category])), [snapshot.categories])
  if (charges.length === 0) return null
  const soon = upcomingCharges(charges, today, 7)
  const next = charges.find((charge) => charge.nextDate > today)
  return <Card>
    <CardHeader>
      <CardTitle>Upcoming bills</CardTitle>
      <CardDescription>{charges.length} monthly {charges.length === 1 ? 'charge' : 'charges'}, about <BlurSpan>{money(monthlyTotal(charges))}</BlurSpan> a month</CardDescription>
    </CardHeader>
    <CardContent className="px-2 pt-3">
      {soon.length === 0 && next && <p className="px-3 pb-1 text-muted-foreground">
        Nothing due this week. Next is {next.title} on {shortDate(next.nextDate)}.
      </p>}
      {soon.map((charge) => {
        const category = charge.categoryId ? categories.get(charge.categoryId) : undefined
        const label = dueLabel(charge, today, shortDate)
        return <div
          key={charge.key}
          aria-label={`${charge.title}, ${money(charge.amountCents)}, ${label}`}
          className="flex min-h-16 items-center px-3 py-2"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#404040' }}>
            <MoneyIcon name={category?.icon ?? 'Receipt'} size={19} />
          </span>
          <span className="ml-3 flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[17px] font-semibold">{charge.title}</span>
            <span className="text-[14px] text-muted-foreground">{label}</span>
          </span>
          <Blurred><span className="ml-3 text-[17px] font-semibold tabular">{money(charge.amountCents)}</span></Blurred>
        </div>
      })}
    </CardContent>
  </Card>
}
