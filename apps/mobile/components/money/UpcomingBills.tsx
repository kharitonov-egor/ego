import React, { useMemo } from 'react'
import { View } from 'react-native'
import type { MoneySnapshot } from '@ego/core'
import { parseIso } from '../../lib/dates'
import { dueLabel, monthlyTotal, recurringCharges, upcomingCharges } from '../../lib/recurring'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Text } from '../ui/text'
import { MoneyIcon, money } from './Common'
import { tabular } from './tokens'

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
      <CardDescription>{charges.length} monthly {charges.length === 1 ? 'charge' : 'charges'}, about {money(monthlyTotal(charges))} a month</CardDescription>
    </CardHeader>
    <CardContent className="px-2 pt-3">
      {soon.length === 0 && next && <Text className="px-3 pb-1 text-muted-foreground">
        Nothing due this week. Next is {next.title} on {shortDate(next.nextDate)}.
      </Text>}
      {soon.map((charge) => {
        const category = charge.categoryId ? categories.get(charge.categoryId) : undefined
        const label = dueLabel(charge, today, shortDate)
        return <View
          key={charge.key}
          accessible
          accessibilityLabel={`${charge.title}, ${money(charge.amountCents)}, ${label}`}
          className="min-h-16 flex-row items-center px-3 py-2"
        >
          <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#404040' }}>
            <MoneyIcon name={category?.icon ?? 'Receipt'} size={19} />
          </View>
          <View className="ml-3 flex-1">
            <Text numberOfLines={1} className="text-[17px] font-semibold">{charge.title}</Text>
            <Text className="text-[14px] text-muted-foreground">{label}</Text>
          </View>
          <Text className="ml-3 text-[17px] font-semibold" style={tabular}>{money(charge.amountCents)}</Text>
        </View>
      })}
    </CardContent>
  </Card>
}
