import React, { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { ChevronLeft, ChevronRight, Tags, Trash2, TriangleAlert } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import {
  monthOf, summarizeBudget,
  type BudgetInput, type CategoryBudgetStatus, type MoneySnapshot
} from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { formatMonth, isoToday, shiftMonth } from '../../lib/dates'
import { AmountSheet } from '../../components/money/AmountSheet'
import { ConfirmDialog, Empty, MoneyIcon, MoneyScreen, money } from '../../components/money/Common'

const BAR_COLORS: Record<CategoryBudgetStatus['state'], string> = {
  over: '#e84d8a', close: '#ff9f43', under: '#2bb3a9', unplanned: '#505056'
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'bad' }): React.ReactElement {
  return <View className="flex-1">
    <Text className="text-base font-semibold text-surface-300">{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit className={`mt-2 text-2xl font-bold ${tone === 'bad' ? 'text-rose-400' : 'text-surface-100'}`} style={{ fontVariant: ['tabular-nums'] }}>{value}</Text>
  </View>
}

function CategoryRow({ status, disabled, onPress }: { status: CategoryBudgetStatus; disabled: boolean; onPress: () => void }): React.ReactElement {
  const width = `${Math.min(100, Math.round(status.usedRatio * 100))}%` as const
  const over = status.state === 'over'
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} className="min-h-[104px] border-t border-surface-800 px-4 py-5">
    <View className="flex-row items-center">
      <View className="h-[52px] w-[52px] items-center justify-center rounded-full" style={{ backgroundColor: status.color }}>
        <MoneyIcon name={status.icon} size={22} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-xl font-semibold text-surface-100">{status.name}</Text>
        <Text className="mt-1 text-[17px] text-surface-400">
          {status.allocatedCents === 0 ? 'No budget set' : `${money(status.spentCents)} of ${money(status.allocatedCents)}`}
        </Text>
      </View>
      <Text className={`ml-2 text-lg font-bold ${over ? 'text-rose-400' : status.state === 'close' ? 'text-amber-400' : 'text-surface-200'}`}>
        {status.allocatedCents === 0
          ? status.spentCents > 0 ? money(status.spentCents) : 'Set'
          : over ? `${money(-status.remainingCents)} over` : `${money(status.remainingCents)} left`}
      </Text>
    </View>
    <View className="mt-3 h-2 overflow-hidden rounded-full bg-surface-800">
      <View className="h-full rounded-full" style={{ width, backgroundColor: BAR_COLORS[status.state] }} />
    </View>
  </Pressable>
}

export default function Budget(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
  const [month, setMonth] = useState(() => monthOf(isoToday()))
  const [editing, setEditing] = useState<'income' | CategoryBudgetStatus | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  return <MoneyScreen>{(snapshot: MoneySnapshot) => {
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
      <View className="flex-row items-center justify-between px-5 py-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12} className="h-[52px] w-[52px] items-center justify-center rounded-full bg-surface-900">
          <ChevronLeft color="#e6e6e8" size={26} />
        </Pressable>
        <Text className="text-2xl font-bold text-surface-100">{formatMonth(month)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12} className="h-[52px] w-[52px] items-center justify-center rounded-full bg-surface-900">
          <ChevronRight color="#e6e6e8" size={26} />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-5">
        {summary.overspent.length > 0 && <View className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
          <View className="flex-row items-center"><TriangleAlert color="#fb7185" size={22} /><Text className="ml-2 text-xl font-semibold text-rose-300">Over budget</Text></View>
          {summary.overspent.map((item) => <Text key={item.categoryId} className="mt-2 text-[17px] leading-6 text-rose-200">
            {item.name} is {money(item.spentCents - item.allocatedCents)} past its {money(item.allocatedCents)} budget
          </Text>)}
        </View>}

        <Pressable disabled={state.readOnly} onPress={() => setEditing('income')} className="rounded-2xl border border-surface-800 bg-surface-900/70 p-4">
          <Text className="text-[17px] font-semibold text-surface-300">Planned income</Text>
          <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1 text-5xl font-bold text-surface-100" style={{ fontVariant: ['tabular-nums'] }}>{money(summary.plannedIncomeCents)}</Text>
          <Text className="mt-2 text-[17px] text-surface-400">{money(summary.actualIncomeCents)} received so far</Text>
        </Pressable>

        <View className="mt-3 flex-row gap-3 rounded-2xl border border-surface-800 bg-surface-900/70 p-4">
          <Stat label="Allocated" value={money(summary.allocatedCents)} />
          <Stat label="Left to allocate" value={money(summary.unallocatedCents)} tone={summary.unallocatedCents < 0 ? 'bad' : 'plain'} />
          <Stat label="Spent" value={money(summary.spentCents)} tone={summary.overspent.length > 0 ? 'bad' : 'plain'} />
        </View>

        {summary.unplannedSpentCents > 0 && <Text className="mt-3 px-1 text-[17px] leading-6 text-amber-400">
          {money(summary.unplannedSpentCents)} spent in categories with no budget this month.
        </Text>}

        <View className="mt-4 overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/70">
          <View className="flex-row items-center justify-between px-4 py-4"><Text className="text-2xl font-bold text-surface-100">Categories</Text><Pressable accessibilityRole="button" onPress={() => router.push('/(money)/categories')} className="flex-row items-center rounded-full bg-surface-800 px-4 py-3"><Tags color="#b5b5bc" size={20} /><Text className="ml-2 text-[17px] font-semibold text-surface-200">Manage</Text></Pressable></View>
          {summary.categories.length === 0
            ? <Text className="px-4 pb-4 text-[17px] text-surface-400">Create an expense category first.</Text>
            : summary.categories.map((status) => <CategoryRow key={status.categoryId} status={status} disabled={state.readOnly} onPress={() => setEditing(status)} />)}
        </View>

        {planned && <Pressable disabled={state.readOnly} onPress={() => setConfirmingClear(true)} className="mt-4 flex-row items-center justify-center rounded-xl border border-rose-500/30 py-3">
          <Trash2 color="#fb7185" size={20} />
          <Text className="ml-2 text-[17px] font-semibold text-rose-400">Clear this month</Text>
        </Pressable>}
        {snapshot.categories.filter((item) => item.kind === 'expense').length === 0 && <Empty title="Nothing to budget yet" detail="Add expense categories, then give each one a monthly amount." />}
        <View className="h-24" />
      </ScrollView>

      <AmountSheet
        visible={editing === 'income'}
        title="Planned income"
        detail={formatMonth(month)}
        valueCents={summary.plannedIncomeCents}
        color="#2bb3a9"
        onClose={() => setEditing(null)}
        onConfirm={saveIncome}
      />
      <AmountSheet
        visible={editing !== null && editing !== 'income'}
        title={editing !== null && editing !== 'income' ? editing.name : ''}
        detail={`Monthly budget for ${formatMonth(month)}`}
        valueCents={editing !== null && editing !== 'income' ? editing.allocatedCents : 0}
        color="#3b82f6"
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
