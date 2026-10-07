import React, { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import type { MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { averagesFor, bucketFlows, elapsedDays, flowOf, projectedSpend } from '@ego/local/cash-flow'
import { formatIso, isoToday, shiftIso } from '@ego/local/dates'
import { bucketSizeFor, chartBuckets, comparisonSpan, isStepped, type Comparison, type Span } from '@ego/local/periods'
import { localBalanceAt, localTransactionBounds, localTransactionsInRange } from '@ego/local/repositories/snapshot'
import { localMerchantNames } from '@ego/local/repositories/transactions'
import { transactionDetail, transactionTitle } from '@ego/local/transaction-title'
import { CashFlowChart, SERIES_COLOR, type SeriesVisibility } from '../../components/money/CashFlowChart'
import { MoneyIcon, MoneyScreen, money } from '../../components/money/Common'
import { PeriodBar } from '../../components/money/PeriodBar'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { SpendingCalendar } from '../../components/money/SpendingCalendar'
import { UpcomingBills } from '../../components/money/UpcomingBills'
import { Screen, ScreenBody } from '../../components/screen'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card'
import { Spinner } from '../../components/ui/spinner'
import { BlurSpan, Blurred } from '../../lib/blur'
import { useMoneyQuery } from '../../lib/money'
import { usePeriod } from '../../lib/period'
import { HERO_AMOUNT, amountColor, amountSign } from '../../lib/tokens'
import { FinanceHeader } from './header'

/** Transactions arrive newest first, so the earliest date is the last row, not a sort away. */
function earliestDate(snapshot: MoneySnapshot, transactionDate: string | null): string | undefined {
  let earliest = transactionDate ?? undefined
  for (const account of snapshot.accounts) {
    if (!earliest || account.openingDate < earliest) earliest = account.openingDate
  }
  return earliest
}

export default function Overview(): React.ReactElement {
  return <Screen>
    <FinanceHeader />
    <MoneyScreen>{(snapshot) => <OverviewBody snapshot={snapshot} />}</MoneyScreen>
  </Screen>
}

/** Everything the page shows for one period, loaded together so a period click swaps it in one render. */
interface PeriodView {
  preset: PeriodPreset
  current: boolean
  first: string
  span: Span
  comparison: Comparison | null
  transactions: MoneyTransaction[]
  comparisonTransactions: MoneyTransaction[]
  /** Null for a period that reaches today, where the live account balances apply. */
  pastBalance: number | null
  merchants: Map<string, string>
}

/** The phone's Home, in two columns once the window is wide enough: the period's money on the left, what to watch on the right. */
function OverviewBody({ snapshot }: { snapshot: MoneySnapshot }): React.ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const period = usePeriod()
  const [series, setSeries] = useState<SeriesVisibility>({ expense: true, income: true })
  const today = isoToday()
  const { period: preset, anchor, current, range } = period
  const from = `${location.pathname}${location.search}`
  const view = useMoneyQuery(async (db): Promise<PeriodView> => {
    const bounds = await localTransactionBounds(db)
    const first = earliestDate(snapshot, bounds.earliest) ?? today
    const latest = bounds.latest ?? today
    const start = range.from ?? first
    const end = range.to ?? (latest > today ? latest : today)
    const span: Span = start <= end ? { from: start, to: end } : { from: end, to: start }
    const comparison = isStepped(preset) ? comparisonSpan(preset, anchor, today) : null
    const [transactions, comparisonTransactions, pastBalance] = await Promise.all([
      localTransactionsInRange(db, span.from, span.to),
      comparison ? localTransactionsInRange(db, comparison.from, comparison.to) : Promise.resolve([]),
      span.to < today ? localBalanceAt(db, span.to) : Promise.resolve(null)
    ])
    const merchants = preset === 'today'
      ? await localMerchantNames(db, transactions.map((item) => item.id))
      : new Map<string, string>()
    return { preset, current, first, span, comparison, transactions, comparisonTransactions, pastBalance, merchants }
  }, [preset, anchor, current, range.from, range.to, today, snapshot.accounts])
  const recurringHistory = useMoneyQuery(
    (db) => localTransactionsInRange(db, shiftIso(today, -180), today), [today])

  const flow = useMemo(() => flowOf(view?.transactions ?? []), [view])
  const buckets = useMemo(() => view ? chartBuckets(view.span) : [], [view])
  const flows = useMemo(
    () => view ? bucketFlows(view.transactions, buckets, bucketSizeFor(view.span)) : [],
    [view, buckets]
  )
  const previous = useMemo(
    () => view?.comparison ? flowOf(view.comparisonTransactions) : null,
    [view]
  )

  if (!view || !recurringHistory) {
    return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  }

  const { span, comparison, transactions } = view
  const past = span.to < today
  const balance = view.pastBalance
    ?? snapshot.accounts.reduce((sum, account) => account.archivedAt ? sum : sum + account.balanceCents, 0)
  const accountCount = snapshot.accounts.filter((account) => !account.archivedAt).length
  const net = flow.incomeCents - flow.expenseCents
  const days = Math.max(1, elapsedDays(span, today))
  const projection = isStepped(view.preset) && view.preset !== 'today' && view.current
    ? projectedSpend(flow.expenseCents, span, today)
    : null

  return <>
    <PeriodBar since={preset === 'all' ? formatIso(view.first) : undefined} />
    <PeriodSwipe>
      <ScreenBody width="wide" className="pb-8 pt-1">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <button
              type="button"
              title="Opens your accounts"
              onClick={() => navigate('/money/accounts', { state: { from } })}
              className="rounded-3xl border border-border bg-card p-5 text-left transition-colors hover:bg-surface-900"
            >
              <span className="flex items-center justify-between">
                <span className="text-[14px] font-medium text-muted-foreground">{past ? `Balance on ${formatIso(span.to)}` : 'Total balance'}</span>
                <ChevronRight color="#737373" size={18} />
              </span>
              <Blurred><span className={`mt-1 block truncate tabular ${HERO_AMOUNT}`}>{money(balance)}</span></Blurred>
              <span className="mt-4 flex items-center justify-between">
                <Badge variant={net >= 0 ? 'positive' : 'secondary'}><Blurred><span className="tabular">{money(net, true)} net</span></Blurred></Badge>
                <span className="text-[14px] text-muted-foreground">{accountCount} {accountCount === 1 ? 'account' : 'accounts'}</span>
              </span>
            </button>

            <div className="flex gap-3">
              <FlowStat label="Spent" color={SERIES_COLOR.expense} cents={flow.expenseCents} previous={previous?.expenseCents} against={comparison?.label} />
              <FlowStat label="Received" color={SERIES_COLOR.income} cents={flow.incomeCents} previous={previous?.incomeCents} against={comparison?.label} />
            </div>

            {view.preset === 'today'
              ? <DayCard snapshot={snapshot} transactions={transactions} merchants={view.merchants} onOpen={(id) => navigate(`/money/transaction/${encodeURIComponent(id)}`, { state: { from } })} />
              : <Card className="overflow-hidden pt-2">
                <CashFlowChart
                  title="Cash flow"
                  buckets={buckets}
                  flows={flows}
                  today={today}
                  series={series}
                  onSeriesChange={setSeries}
                  onOpen={(bucket) => period.showPeriod(bucket.drill.period, bucket.drill.anchor)}
                />
              </Card>}

            {view.preset === 'month' && <SpendingCalendar month={span} transactions={transactions} today={today} onOpenDay={(iso) => period.showPeriod('today', iso)} />}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {view.current && <UpcomingBills snapshot={{ ...snapshot, transactions: recurringHistory }} today={today} />}

            {view.preset !== 'today' && <Card>
              <CardHeader>
                <CardTitle>Average spending</CardTitle>
                <CardDescription>{view.current && !past ? `Across the ${days} days so far` : `Across ${days} days`}</CardDescription>
              </CardHeader>
              <CardContent className="flex">
                {averagesFor(flow.expenseCents, days).map((average) => <div key={average.label} className="min-w-0 flex-1">
                  <p className="text-[14px] text-muted-foreground">{average.label}</p>
                  <Blurred><p className="mt-1 truncate text-[20px] font-bold tabular">{money(Math.round(average.cents))}</p></Blurred>
                </div>)}
              </CardContent>
              {projection !== null && <CardFooter>
                <p className="text-[14px] leading-5 text-muted-foreground">At this pace, spending reaches about <span className="font-semibold text-foreground"><BlurSpan>{money(projection)}</BlurSpan></span> by {formatIso(span.to)}.</p>
              </CardFooter>}
            </Card>}

            <TopCategories snapshot={snapshot} transactions={transactions} expenseCents={flow.expenseCents} onOpen={(categoryId) => navigate(`/money/transactions?categoryId=${encodeURIComponent(categoryId)}`)} />
          </div>
        </div>
      </ScreenBody>
    </PeriodSwipe>
  </>
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
  return <Card className="min-w-0 flex-1 p-4">
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
      <span className="text-[14px] font-medium text-muted-foreground">{label}</span>
    </div>
    <Blurred><p className="mt-1.5 truncate text-[24px] font-bold tabular">{money(cents)}</p></Blurred>
    {typeof change === 'string' && <p className="mt-1 line-clamp-2 text-[13px] text-muted-foreground">{change}</p>}
    {typeof change === 'number' && <div className="mt-1 flex items-start">
      {change > 0 && <ArrowUpRight color="#d4d4d4" size={15} className="mt-px shrink-0" />}
      {change < 0 && <ArrowDownRight color="#d4d4d4" size={15} className="mt-px shrink-0" />}
      <p className="ml-0.5 line-clamp-2 flex-1 text-[13px] text-muted-foreground">
        <span className="font-semibold text-surface-300">{change === 0 ? 'Same' : <BlurSpan>{`${Math.abs(change)}%`}</BlurSpan>}</span> vs {against}
      </p>
    </div>}
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
      ? <CardContent><p className="py-4 text-center text-muted-foreground">No expenses in this period.</p></CardContent>
      : <CardContent className="flex flex-col gap-1 px-2 pt-3">{ranked.map(({ category, amount }) => <button
        key={category.id}
        type="button"
        aria-label={`${category.name}, ${money(amount)}`}
        title="Opens these transactions in Activity"
        onClick={() => onOpen(category.id)}
        className="rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-surface-900"
      >
        <span className="flex items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: category.color }}>
            <MoneyIcon name={category.icon} size={17} />
          </span>
          <span className="ml-3 flex-1 truncate font-semibold">{category.name}</span>
          <Blurred><span className="font-semibold tabular">{money(amount)}</span></Blurred>
        </span>
        <span className="ml-[52px] mt-2 block h-1.5 overflow-hidden rounded-full bg-surface-800">
          <span className="block h-full rounded-full" style={{ width: `${expenseCents ? amount / expenseCents * 100 : 0}%`, backgroundColor: category.color }} />
        </span>
      </button>)}</CardContent>}
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
      return <button
        key={item.id}
        type="button"
        aria-label={`${title}, ${amountSign(item.kind)}${money(item.amountCents)}`}
        onClick={() => onOpen(item.id)}
        className="flex min-h-16 w-full items-center rounded-2xl px-3 py-2 text-left transition-colors hover:bg-surface-900"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#404040' }}>
          <MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={19} />
        </span>
        <span className="ml-3 flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[17px] font-semibold">{title}</span>
          <span className="truncate text-[14px] text-muted-foreground">{detail}</span>
        </span>
        <Blurred><span className="ml-3 font-semibold tabular" style={{ color: amountColor(item.kind) }}>{amountSign(item.kind)}{money(item.amountCents)}</span></Blurred>
      </button>
    })}</CardContent>
  </Card>
}
