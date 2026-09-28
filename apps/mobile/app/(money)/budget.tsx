import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native'
import { ChevronLeft, ChevronRight, Tags, Trash2, TriangleAlert } from 'lucide-react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  monthOf, summarizeBudget,
  type BudgetInput, type CategoryBudgetStatus, type MoneySnapshot
} from '@ego/core'
import { useMoney, useMoneyQuery } from '../../lib/money-context'
import { localSnapshot } from '../../lib/repositories/snapshot'
import { formatMonth, isoToday, shiftMonth } from '../../lib/dates'
import { AmountSheet } from '../../components/money/AmountSheet'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { usePeriod } from '../../lib/period-context'
import { ConfirmDialog, Empty, MoneyIcon, MoneyScreen, money } from '../../components/money/Common'
import { color, tabular } from '../../components/money/tokens'
import { Button } from '../../components/ui/button'
import { Card, CardHeader, CardTitle } from '../../components/ui/card'
import { Text } from '../../components/ui/text'

/** Status colors, each paired with words in the row, so the bar never carries the meaning alone. */
const BAR_COLORS: Record<CategoryBudgetStatus['state'], string> = {
  over: color.destructive, close: color.attention, under: color.positive, unplanned: '#525252'
}

function Stat({ label, value, bad = false }: { label: string; value: string; bad?: boolean }): React.ReactElement {
  return <View className="flex-1">
    <Text className="text-[14px] text-muted-foreground">{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit className={`mt-1 text-[20px] font-bold ${bad ? 'text-destructive' : ''}`}>{value}</Text>
  </View>
}

function CategoryRow({ status, disabled, onPress }: { status: CategoryBudgetStatus; disabled: boolean; onPress: () => void }): React.ReactElement {
  const width = `${Math.min(100, Math.round(status.usedRatio * 100))}%` as const
  const over = status.state === 'over'
  const right = status.allocatedCents === 0
    ? status.spentCents > 0 ? money(status.spentCents) : 'Set budget'
    : over ? `${money(-status.remainingCents)} over` : `${money(status.remainingCents)} left`
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${status.name}, ${status.allocatedCents === 0 ? 'no budget' : `${money(status.spentCents)} of ${money(status.allocatedCents)}`}, ${right}`}
    disabled={disabled}
    onPress={onPress}
    className="border-t border-surface-800 px-5 py-3.5 active:bg-surface-900"
  >
    <View className="flex-row items-center">
      <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: status.color }}>
        <MoneyIcon name={status.icon} size={19} />
      </View>
      <View className="ml-3 flex-1">
        <Text numberOfLines={1} className="text-[17px] font-semibold">{status.name}</Text>
        <Text className="text-[14px] text-muted-foreground" style={tabular}>
          {status.allocatedCents === 0 ? 'No budget set' : `${money(status.spentCents)} of ${money(status.allocatedCents)}`}
        </Text>
      </View>
      <Text className={`ml-3 text-[15px] font-semibold ${over ? 'text-destructive' : status.state === 'close' ? 'text-attention' : status.allocatedCents === 0 && status.spentCents === 0 ? 'text-muted-foreground' : ''}`} style={tabular}>{right}</Text>
    </View>
    <View className="ml-14 mt-2.5 h-2 overflow-hidden rounded-full bg-surface-800">
      <View className="h-full rounded-full" style={{ width, backgroundColor: BAR_COLORS[status.state] }} />
    </View>
  </Pressable>
}

function relativeMonth(month: string): string | null {
  const current = monthOf(isoToday())
  if (month === current) return 'This month'
  if (month === shiftMonth(current, -1)) return 'Last month'
  if (month === shiftMonth(current, 1)) return 'Next month'
  return null
}

const MONTH = /^\d{4}-\d{2}$/

export default function Budget(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
  const params = useLocalSearchParams<{ month?: string }>()
  const period = usePeriod()
  const [month, setMonth] = useState(() => monthOf(period.anchor))
  /** Opening the tab lands on the month the other tabs show; stepping here stays local, so future months can be planned. */
  useFocusEffect(useCallback(() => { setMonth(monthOf(period.anchor)) }, [period.anchor]))
  useEffect(() => {
    if (!params.month) return
    if (MONTH.test(params.month)) setMonth(params.month)
    router.setParams({ month: undefined })
  }, [params.month, router])
  const [editing, setEditing] = useState<'income' | CategoryBudgetStatus | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const monthData = useMoneyQuery((db) => localSnapshot(db, new Date().toISOString(), {
    accounts: false,
    budgetMonth: month,
    purchases: false,
    transactionFrom: `${month}-01`,
    transactionTo: `${month}-31`
  }), [month])

  return <MoneyScreen>{(baseSnapshot: MoneySnapshot) => {
    if (!monthData) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#fafafa" /></View>
    const snapshot: MoneySnapshot = {
      ...baseSnapshot,
      budgets: monthData.budgets,
      transactions: monthData.transactions
    }
    const summary = summarizeBudget(snapshot, month)
    const planned = snapshot.budgets.some((item) => item.month === month)
    const allocations = summary.categories
      .filter((item) => item.allocatedCents > 0)
      .map((item) => ({ categoryId: item.categoryId, amountCents: item.allocatedCents }))

    const save = async (input: BudgetInput): Promise<void> => {
      if (await state.saveBudget(input)) setEditing(null)
    }
    const saveIncome = (cents: number): void => {
      void save({ month, plannedIncomeCents: cents, allocations })
    }
    const saveAllocation = (categoryId: string, cents: number): void => {
      void save({
        month,
        plannedIncomeCents: summary.plannedIncomeCents,
        allocations: [...allocations.filter((item) => item.categoryId !== categoryId),
          ...(cents > 0 ? [{ categoryId, amountCents: cents }] : [])]
      })
    }
    const clear = async (): Promise<void> => {
      if (await state.deleteBudget(month)) setConfirmingClear(false)
    }

    return <View className="flex-1">
      <View className="flex-row items-center px-4 pb-3 pt-2">
        <Button variant="ghost" size="icon" accessibilityLabel="Previous month" onPress={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft color="#fafafa" size={22} />
        </Button>
        <View className="flex-1 items-center">
          <Text accessibilityLiveRegion="polite" className="text-[22px] font-bold tracking-tight">{formatMonth(month)}</Text>
          <View className="mt-0.5 min-h-[20px] flex-row items-center gap-2">
            {relativeMonth(month) && <Text className="text-[14px] text-muted-foreground">{relativeMonth(month)}</Text>}
            {month !== monthOf(isoToday()) && <Pressable accessibilityRole="button" onPress={() => setMonth(monthOf(isoToday()))} hitSlop={10}>
              <Text className="text-[14px] font-semibold underline">Back to this month</Text>
            </Pressable>}
          </View>
        </View>
        <Button variant="ghost" size="icon" accessibilityLabel="Next month" onPress={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight color="#fafafa" size={22} />
        </Button>
      </View>

      <PeriodSwipe onStep={(delta) => setMonth(shiftMonth(month, delta))}>
      <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 12 }}>
        {summary.overspent.length > 0 && <View className="rounded-3xl border border-destructive/30 bg-destructive/10 p-5">
          <View className="flex-row items-center"><TriangleAlert color="#fb7185" size={18} /><Text className="ml-2 text-[17px] font-semibold text-destructive">Over budget</Text></View>
          {summary.overspent.map((item) => <Text key={item.categoryId} className="mt-1.5 text-[15px] leading-5 text-rose-200">
            {item.name} is {money(item.spentCents - item.allocatedCents)} past its {money(item.allocatedCents)} budget
          </Text>)}
        </View>}

        <Pressable accessibilityRole="button" accessibilityHint="Changes the planned income" disabled={state.readOnly} onPress={() => setEditing('income')} className="rounded-3xl border border-border bg-card p-5 active:bg-surface-900">
          <Text className="text-[14px] font-medium text-muted-foreground">Planned income</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1 text-[36px] font-bold tracking-tight">{money(summary.plannedIncomeCents)}</Text>
          <Text className="mt-1 text-[15px] text-muted-foreground">{money(summary.actualIncomeCents)} received so far</Text>
        </Pressable>

        <Card className="flex-row gap-3 p-5">
          <Stat label="Allocated" value={money(summary.allocatedCents)} />
          <Stat label="Left to plan" value={money(summary.unallocatedCents)} bad={summary.unallocatedCents < 0} />
          <Stat label="Spent" value={money(summary.spentCents)} bad={summary.overspent.length > 0} />
        </Card>

        {summary.unplannedSpentCents > 0 && <Text className="px-1 text-[15px] leading-5 text-attention">
          {money(summary.unplannedSpentCents)} spent in categories with no budget this month.
        </Text>}

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between pb-4">
            <CardTitle>Categories</CardTitle>
            <Button variant="secondary" size="sm" onPress={() => router.push('/(money)/categories')}>
              <Tags color="#fafafa" size={15} />
              <Text>Manage</Text>
            </Button>
          </CardHeader>
          {summary.categories.length === 0
            ? <Text className="px-5 pb-5 text-muted-foreground">Create an expense category first.</Text>
            : summary.categories.map((status) => <CategoryRow key={status.categoryId} status={status} disabled={state.readOnly} onPress={() => setEditing(status)} />)}
        </Card>

        {planned && <Button variant="outline" size="lg" disabled={state.readOnly} onPress={() => setConfirmingClear(true)} className="border-destructive/40">
          <Trash2 color="#fb7185" size={17} />
          <Text className="text-destructive">Clear this month</Text>
        </Button>}
        {snapshot.categories.filter((item) => item.kind === 'expense').length === 0 && <Empty title="Nothing to budget yet" detail="Add expense categories, then give each one a monthly amount." />}
      </ScrollView>
      </PeriodSwipe>

      <AmountSheet
        visible={editing === 'income'}
        title="Planned income"
        detail={formatMonth(month)}
        valueCents={summary.plannedIncomeCents}
        color="#34d399"
        onClose={() => setEditing(null)}
        onConfirm={saveIncome}
      />
      <AmountSheet
        visible={editing !== null && editing !== 'income'}
        title={editing !== null && editing !== 'income' ? editing.name : ''}
        detail={`Monthly budget for ${formatMonth(month)}`}
        valueCents={editing !== null && editing !== 'income' ? editing.allocatedCents : 0}
        color="#fafafa"
        onClose={() => setEditing(null)}
        onConfirm={(cents) => { if (editing !== null && editing !== 'income') saveAllocation(editing.categoryId, cents) }}
      />
      <ConfirmDialog
        visible={confirmingClear}
        title="Clear this month?"
        detail="The planned income and every allocation for this month are removed. Transactions stay."
        confirmLabel="Clear" destructive busy={state.busy}
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => void clear()}
      />
    </View>
  }}</MoneyScreen>
}
