import React from 'react'
import { ScrollView, Text, View } from 'react-native'
import { MoneyIcon, MoneyScreen, PeriodChips, filteredTransactions, money, today } from '../../components/money/Common'
import { usePeriod } from '../../lib/period-context'

export default function Overview(): React.ReactElement {
  const { range, label } = usePeriod()
  return <MoneyScreen>{(snapshot) => {
    const transactions = filteredTransactions(snapshot, range)
    const income = transactions.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amountCents, 0)
    const expenses = transactions.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
    const closing = snapshot.accounts.filter((item) => !item.archivedAt).reduce((sum, item) => sum + item.balanceCents, 0)
    const net = income - expenses
    const categoryTotals = new Map<string, number>()
    transactions.filter((item) => item.kind === 'expense' && item.categoryId).forEach((item) => categoryTotals.set(item.categoryId!, (categoryTotals.get(item.categoryId!) ?? 0) + item.amountCents))
    const ranked = snapshot.categories.map((category) => ({ category, amount: categoryTotals.get(category.id) ?? 0 })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount)
    const months = new Map<string, { income: number; expense: number }>()
    transactions.filter((item) => item.kind !== 'transfer').forEach((item) => { const key = item.date.slice(0, 7); const value = months.get(key) ?? { income: 0, expense: 0 }; value[item.kind === 'income' ? 'income' : 'expense'] += item.amountCents; months.set(key, value) })
    const monthEntries = Array.from(months.entries()).sort().slice(-6)
    const max = Math.max(1, ...monthEntries.flatMap(([, value]) => [value.income, value.expense]))
    const first = range.from ?? [...snapshot.transactions.map((item) => item.date), ...snapshot.accounts.map((item) => item.openingDate)].sort()[0] ?? today()
    const last = range.to ?? today()
    const days = Math.max(1, Math.floor((new Date(`${last}T00:00:00`).getTime() - new Date(`${first}T00:00:00`).getTime()) / 86400000) + 1)
    const accountCount = snapshot.accounts.filter((item) => !item.archivedAt).length
    return <View className="flex-1">
      <PeriodChips />
      <ScrollView className="flex-1 px-3" contentContainerStyle={{ paddingBottom: 20 }}>
        <View className="overflow-hidden rounded-2xl border border-accent-500/25 bg-surface-900 px-4 pb-3 pt-3.5">
          <View className="absolute left-0 top-0 h-0.5 w-full bg-accent-400" />
          <Text className="text-[12px] font-semibold text-surface-300">Total balance</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            className={`mt-0.5 text-[32px] font-bold tracking-tight ${closing < 0 ? 'text-rose-400' : 'text-surface-50'}`}
            style={{ fontVariant: ['tabular-nums'] }}
          >{money(closing)}</Text>
          <View className="mt-3 flex-row items-end justify-between border-t border-surface-800 pt-2.5">
            <View>
              <Text className="text-[11px] font-medium text-surface-400">{label} change</Text>
              <Text className={`mt-0.5 text-[15px] font-bold ${net < 0 ? 'text-rose-400' : 'text-emerald-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(net, true)}</Text>
            </View>
            <Text className="text-[11px] font-medium text-surface-400">{accountCount} {accountCount === 1 ? 'account' : 'accounts'}</Text>
          </View>
        </View>

        <View className="mt-2.5 flex-row gap-2">
          <Summary label="Spent" cents={expenses} tone="expense" />
          <Summary label="Received" cents={income} tone="income" />
        </View>

        <View className="mt-2.5 rounded-xl border border-surface-800 bg-surface-900/70 p-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-[13px] font-bold text-surface-100">Monthly cash flow</Text>
            <View className="flex-row items-center gap-2.5">
              <Legend color="#10b981" label="In" />
              <Legend color="#f43f5e" label="Out" />
            </View>
          </View>
          {monthEntries.length === 0
            ? <Text className="py-6 text-center text-[12px] text-surface-400">Record a transaction to see the chart.</Text>
            : <View className="mt-3 h-28 flex-row items-end gap-2">{monthEntries.map(([month, value]) => <View key={month} className="flex-1 items-center"><View className="h-20 w-full flex-row items-end justify-center gap-0.5"><View className="w-2/5 rounded-t bg-emerald-500" style={{ height: `${Math.max(value.income ? 4 : 0, value.income / max * 100)}%` }} /><View className="w-2/5 rounded-t bg-rose-500" style={{ height: `${Math.max(value.expense ? 4 : 0, value.expense / max * 100)}%` }} /></View><Text className="mt-1.5 text-[11px] font-semibold text-surface-400">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</Text></View>)}</View>}
        </View>

        <View className="mt-2.5 rounded-xl border border-surface-800 bg-surface-900/70 p-3">
          <Text className="text-[13px] font-bold text-surface-100">Average spending</Text>
          <View className="mt-2.5 flex-row"><Average label="Daily" cents={expenses / days} /><Average label="Weekly" cents={expenses / days * 7} /><Average label="Monthly" cents={expenses / days * 30.44} /></View>
        </View>

        <View className="mt-2.5 rounded-xl border border-surface-800 bg-surface-900/70 p-3">
          <Text className="text-[13px] font-bold text-surface-100">Top categories</Text>
          {ranked.length === 0
            ? <Text className="py-5 text-center text-[12px] text-surface-400">No expenses in this period.</Text>
            : <View className="mt-2.5 gap-3">{ranked.slice(0, 6).map(({ category, amount }) => <View key={category.id}><View className="flex-row items-center"><View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: category.color }}><MoneyIcon name={category.icon} size={14} /></View><Text numberOfLines={1} className="ml-2 flex-1 text-[13px] font-semibold text-surface-100">{category.name}</Text><Text className="text-[13px] font-bold text-surface-100" style={{ fontVariant: ['tabular-nums'] }}>{money(amount)}</Text></View><View className="ml-10 mt-1.5 h-1 overflow-hidden rounded-full bg-surface-800"><View className="h-full rounded-full" style={{ width: `${expenses ? amount / expenses * 100 : 0}%`, backgroundColor: category.color }} /></View></View>)}</View>}
        </View>
      </ScrollView>
    </View>
  }}</MoneyScreen>
}

function Average({ label, cents }: { label: string; cents: number }): React.ReactElement {
  return <View className="flex-1 items-center px-1"><Text className="text-[11px] font-semibold text-surface-400">{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit className="mt-0.5 text-[13px] font-bold text-rose-400" style={{ fontVariant: ['tabular-nums'] }}>{money(Math.round(cents))}</Text></View>
}

function Summary({ label, cents, tone }: { label: string; cents: number; tone: 'expense' | 'income' }): React.ReactElement {
  const expense = tone === 'expense'
  return <View className={`flex-1 rounded-xl border p-3 ${expense ? 'border-rose-500/25 bg-rose-500/10' : 'border-emerald-500/25 bg-emerald-500/10'}`}>
    <Text className="text-[12px] font-semibold text-surface-300">{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit className={`mt-0.5 text-[19px] font-bold ${expense ? 'text-rose-400' : 'text-emerald-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(cents)}</Text>
  </View>
}

function Legend({ color, label }: { color: string; label: string }): React.ReactElement {
  return <View className="flex-row items-center"><View className="mr-1 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} /><Text className="text-[11px] font-medium text-surface-400">{label}</Text></View>
}
