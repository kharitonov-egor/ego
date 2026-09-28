import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react-native'
import type { MoneySnapshot, MoneyTransaction } from '@ego/core'
import { MoneyIcon, MoneyScreen, money } from '../../components/money/Common'
import { CashFlowChart, SERIES_COLOR, type SeriesVisibility } from '../../components/money/CashFlowChart'
import { PeriodBar } from '../../components/money/PeriodBar'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { SpendingCalendar } from '../../components/money/SpendingCalendar'
import { UpcomingBills } from '../../components/money/UpcomingBills'
import { HERO_AMOUNT, amountColor, amountSign, tabular } from '../../components/money/tokens'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card'
import { Text } from '../../components/ui/text'
import { averagesFor, bucketFlows, elapsedDays, flowOf, projectedSpend } from '../../lib/cash-flow'
import { formatIso, isoToday, shiftIso } from '../../lib/dates'
import { bucketSizeFor, chartBuckets, comparisonSpan, isStepped, type Span } from '../../lib/periods'
import { usePeriod } from '../../lib/period-context'
import { useLedger } from '../../lib/ledger-context'
import { useMoneyQuery } from '../../lib/money-context'
import { localBalanceAt, localTransactionBounds, localTransactionsInRange } from '../../lib/repositories/snapshot'
import { localMerchantNames } from '../../lib/repositories/transactions'
import { transactionDetail, transactionTitle } from '../../lib/transaction-title'

/** Transactions arrive newest first, so the earliest date is the last row, not a sort away. */
function earliestDate(snapshot: MoneySnapshot, transactionDate: string | null): string | undefined {
  let earliest = transactionDate ?? undefined
  for (const account of snapshot.accounts) {
    if (!earliest || account.openingDate < earliest) earliest = account.openingDate
  }
  return earliest
}

export default function Overview(): React.ReactElement {
  return <MoneyScreen>{(snapshot) => <OverviewBody snapshot={snapshot} />}</MoneyScreen>
}

function OverviewBody({ snapshot }: { snapshot: MoneySnapshot }): React.ReactElement {
  const router = useRouter()
  const ledger = useLedger()
  const period = usePeriod()
  const [scrubbing, setScrubbing] = useState(false)
  const [series, setSeries] = useState<SeriesVisibility>({ expense: true, income: true })
  const today = isoToday()
  const bounds = useMoneyQuery(localTransactionBounds, [])
  const first = useMemo(() => earliestDate(snapshot, bounds?.earliest ?? null) ?? today, [bounds?.earliest, snapshot, today])
  const latest = bounds?.latest ?? today
  const from = period.range.from ?? first
  const to = period.range.to ?? (latest > today ? latest : today)
  const span: Span = from <= to ? { from, to } : { from: to, to: from }
  const preset = period.period
  const comparison = isStepped(preset) ? comparisonSpan(preset, period.anchor, today) : null
  const transactions = useMoneyQuery(
    (db) => localTransactionsInRange(db, span.from, span.to), [span.from, span.to])
  const comparisonTransactions = useMoneyQuery(
    (db) => comparison
      ? localTransactionsInRange(db, comparison.from, comparison.to)
      : Promise.resolve([]),
    [comparison?.from, comparison?.to])
  const recurringHistory = useMoneyQuery(
    (db) => period.current
      ? localTransactionsInRange(db, shiftIso(today, -180), today)
      : Promise.resolve([]),
    [period.current, today])
  const balanceOnDay = useMoneyQuery((db) => localBalanceAt(db, span.to), [span.to])

  const [merchants, setMerchants] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!ledger.db || period.period !== 'today' || !transactions) {
      setMerchants(new Map())
      return
    }
    let active = true
    void localMerchantNames(ledger.db, transactions.map((item) => item.id))
      .then((next) => { if (active) setMerchants(next) })
      .catch(() => undefined)
    return () => { active = false }
  }, [ledger.db, ledger.version, period.period, transactions])
  const flow = useMemo(() => flowOf(transactions ?? []), [transactions])
  const buckets = useMemo(() => chartBuckets({ from: span.from, to: span.to }), [span.from, span.to])
  const flows = useMemo(
    () => bucketFlows(transactions ?? [], buckets, bucketSizeFor({ from: span.from, to: span.to })),
    [transactions, buckets, span.from, span.to]
  )

  const previous = useMemo(
    () => comparison ? flowOf(comparisonTransactions ?? []) : null,
    [comparison, comparisonTransactions]
  )
  const past = span.to < today
  const balance = past
    ? balanceOnDay ?? 0
    : snapshot.accounts.reduce((sum, account) => account.archivedAt ? sum : sum + account.balanceCents, 0)
  const accountCount = snapshot.accounts.filter((account) => !account.archivedAt).length
  const net = flow.incomeCents - flow.expenseCents
  const days = Math.max(1, elapsedDays(span, today))
  const projection = isStepped(preset) && preset !== 'today' && period.current
    ? projectedSpend(flow.expenseCents, span, today)
    : null

  if (!bounds || !transactions || !comparisonTransactions || !recurringHistory || balanceOnDay === null) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#fafafa" /></View>
  }

  return <View className="flex-1">
    <PeriodBar since={preset === 'all' ? formatIso(first) : undefined} />
    <PeriodSwipe>
    <ScrollView scrollEnabled={!scrubbing} className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens your accounts"
        onPress={() => router.push('/(money)/accounts')}
        className="rounded-3xl border border-border bg-card p-5 active:bg-surface-900"
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-[14px] font-medium text-muted-foreground">{past ? `Balance on ${formatIso(span.to)}` : 'Total balance'}</Text>
          <ChevronRight color="#737373" size={18} />
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} className={`mt-1 ${HERO_AMOUNT}`}>{money(balance)}</Text>
        <View className="mt-4 flex-row items-center justify-between">
          <Badge variant={net >= 0 ? 'positive' : 'secondary'}><Text style={tabular}>{money(net, true)} net</Text></Badge>
          <Text className="text-[14px] text-muted-foreground">{accountCount} {accountCount === 1 ? 'account' : 'accounts'}</Text>
        </View>
      </Pressable>

      <View className="flex-row gap-3">
        <FlowStat label="Spent" color={SERIES_COLOR.expense} cents={flow.expenseCents} previous={previous?.expenseCents} against={comparison?.label} />
        <FlowStat label="Received" color={SERIES_COLOR.income} cents={flow.incomeCents} previous={previous?.incomeCents} against={comparison?.label} />
      </View>

      {preset === 'today'
        ? <DayCard snapshot={snapshot} transactions={transactions} merchants={merchants} onOpen={(id) => router.push({ pathname: '/(money)/transaction', params: { id } })} />
        : <Card className="overflow-hidden pt-2">
          <CashFlowChart
            title="Cash flow"
            buckets={buckets}
            flows={flows}
            today={today}
            series={series}
            onSeriesChange={setSeries}
            onScrubbingChange={setScrubbing}
            onOpen={(bucket) => period.showPeriod(bucket.drill.period, bucket.drill.anchor)}
          />
        </Card>}

      {preset === 'month' && <SpendingCalendar month={span} transactions={transactions} today={today} onOpenDay={(iso) => period.showPeriod('today', iso)} />}

      {period.current && <UpcomingBills snapshot={{ ...snapshot, transactions: recurringHistory }} today={today} />}

      {preset !== 'today' && <Card>
        <CardHeader>
          <CardTitle>Average spending</CardTitle>
          <CardDescription>{period.current && !past ? `Across the ${days} days so far` : `Across ${days} days`}</CardDescription>
        </CardHeader>
        <CardContent className="flex-row">
          {averagesFor(flow.expenseCents, days).map((average) => <View key={average.label} className="flex-1">
            <Text className="text-[14px] text-muted-foreground">{average.label}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1 text-[20px] font-bold">{money(Math.round(average.cents))}</Text>
          </View>)}
        </CardContent>
        {projection !== null && <CardFooter>
          <Text className="text-[14px] leading-5 text-muted-foreground">At this pace, spending reaches about <Text className="text-[14px] font-semibold">{money(projection)}</Text> by {formatIso(span.to)}.</Text>
        </CardFooter>}
      </Card>}

      <TopCategories snapshot={snapshot} transactions={transactions} expenseCents={flow.expenseCents} onOpen={(categoryId) => router.push({ pathname: '/(money)/transactions', params: { categoryId } })} />

    </ScrollView>
    </PeriodSwipe>
  </View>
}

function FlowStat({ label, color, cents, previous, against }: {
  label: string
  color: string
  cents: number
  previous?: number
  against?: string
}): React.ReactElement {
  const change = previous === undefined || !against ? null
    : previous === 0 ? (cents === 0 ? `Same as ${against}` : `Nothing in ${against}`)
      : Math.round((cents - previous) / previous * 100)
  return <Card className="flex-1 p-4">
    <View className="flex-row items-center gap-2">
      <View className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <Text className="text-[14px] font-medium text-muted-foreground">{label}</Text>
    </View>
    <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1.5 text-[24px] font-bold">{money(cents)}</Text>
    {typeof change === 'string' && <Text numberOfLines={2} className="mt-1 text-[13px] text-muted-foreground">{change}</Text>}
    {typeof change === 'number' && <View className="mt-1 flex-row items-start">
      {change > 0 && <ArrowUpRight color="#d4d4d4" size={15} style={{ marginTop: 1 }} />}
      {change < 0 && <ArrowDownRight color="#d4d4d4" size={15} style={{ marginTop: 1 }} />}
      <Text numberOfLines={2} className="ml-0.5 flex-1 text-[13px] text-muted-foreground">
        <Text className="text-[13px] font-semibold text-surface-300">{change === 0 ? 'Same' : `${Math.abs(change)}%`}</Text> vs {against}
      </Text>
    </View>}
  </Card>
}

function TopCategories({ snapshot, transactions, expenseCents, onOpen }: {
  snapshot: MoneySnapshot
  transactions: readonly MoneyTransaction[]
  expenseCents: number
  onOpen: (categoryId: string) => void
}): React.ReactElement {
  const ranked = useMemo(() => {
    const totals = new Map<string, number>()
    for (const item of transactions) {
      if (item.kind === 'expense' && item.categoryId) totals.set(item.categoryId, (totals.get(item.categoryId) ?? 0) + item.amountCents)
    }
    return snapshot.categories
      .map((category) => ({ category, amount: totals.get(category.id) ?? 0 }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6)
  }, [snapshot.categories, transactions])
  return <Card>
    <CardHeader><CardTitle>Top categories</CardTitle></CardHeader>
    {ranked.length === 0
      ? <CardContent><Text className="py-4 text-center text-muted-foreground">No expenses in this period.</Text></CardContent>
      : <CardContent className="gap-1 px-2 pt-3">{ranked.map(({ category, amount }) => <Pressable
        key={category.id}
        accessibilityRole="button"
        accessibilityLabel={`${category.name}, ${money(amount)}`}
        accessibilityHint="Opens these transactions in Activity"
        onPress={() => onOpen(category.id)}
        className="rounded-2xl px-3 py-2.5 active:bg-surface-900"
      >
        <View className="flex-row items-center">
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: category.color }}>
            <MoneyIcon name={category.icon} size={17} />
          </View>
          <Text numberOfLines={1} className="ml-3 flex-1 font-semibold">{category.name}</Text>
          <Text className="font-semibold" style={tabular}>{money(amount)}</Text>
        </View>
        <View className="ml-[52px] mt-2 h-1.5 overflow-hidden rounded-full bg-surface-800">
          <View className="h-full rounded-full" style={{ width: `${expenseCents ? amount / expenseCents * 100 : 0}%`, backgroundColor: category.color }} />
        </View>
      </Pressable>)}</CardContent>}
  </Card>
}

function DayCard({ snapshot, transactions, merchants, onOpen }: {
  snapshot: MoneySnapshot
  transactions: readonly MoneyTransaction[]
  merchants: ReadonlyMap<string, string>
  onOpen: (id: string) => void
}): React.ReactElement {
  const categories = useMemo(() => new Map(snapshot.categories.map((category) => [category.id, category])), [snapshot.categories])
  const accounts = useMemo(() => new Map(snapshot.accounts.map((account) => [account.id, account])), [snapshot.accounts])
  return <Card>
    <CardHeader>
      <CardTitle>{transactions.length === 0 ? 'Nothing recorded' : `${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}`}</CardTitle>
      {transactions.length === 0 && <CardDescription>Step back a day, or add one with the plus button.</CardDescription>}
    </CardHeader>
    <CardContent className="px-2 pt-3">{transactions.map((item) => {
      const category = item.categoryId ? categories.get(item.categoryId) : undefined
      const account = accounts.get(item.accountId)
      const destination = item.destinationAccountId ? accounts.get(item.destinationAccountId) : undefined
      const source = {
        kind: item.kind,
        notes: item.notes,
        merchant: merchants.get(item.id),
        categoryName: category?.name ?? null,
        accountName: account?.name ?? 'Archived account',
        destinationAccountName: destination?.name ?? null
      }
      const title = transactionTitle(source)
      const detail = item.kind === 'transfer' ? `${source.accountName} to ${destination?.name ?? 'another account'}` : transactionDetail(source)
      return <Pressable
        key={item.id}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${amountSign(item.kind)}${money(item.amountCents)}`}
        onPress={() => onOpen(item.id)}
        className="min-h-16 flex-row items-center rounded-2xl px-3 py-2 active:bg-surface-900"
      >
        <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#404040' }}>
          <MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={19} />
        </View>
        <View className="ml-3 flex-1">
          <Text numberOfLines={1} className="text-[17px] font-semibold">{title}</Text>
          <Text numberOfLines={1} className="text-[14px] text-muted-foreground">{detail}</Text>
        </View>
        <Text className="ml-3 font-semibold" style={{ ...tabular, color: amountColor(item.kind) }}>{amountSign(item.kind)}{money(item.amountCents)}</Text>
      </Pressable>
    })}</CardContent>
  </Card>
}
