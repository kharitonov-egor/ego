import React, { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { MoneyIcon, MoneyScreen, PeriodChips, filteredTransactions, money, today } from '../../components/money/Common'

function delta(transaction: MoneyTransaction, accountId: string): number {
  if (transaction.kind === 'income' && transaction.accountId === accountId) return transaction.amountCents
  if (transaction.kind === 'expense' && transaction.accountId === accountId) return -transaction.amountCents
  if (transaction.kind === 'transfer' && transaction.accountId === accountId) return -transaction.amountCents
  if (transaction.kind === 'transfer' && transaction.destinationAccountId === accountId) return transaction.amountCents
  return 0
}

function periodStart(period: PeriodPreset): string | null {
  if (period === 'all' || period === 'custom') return null
  const now = new Date(`${today()}T00:00:00`)
  if (period === 'week') now.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  if (period === 'month') now.setDate(1)
  if (period === 'year') now.setMonth(0, 1)
  const offset = now.getTimezoneOffset()
  return period === 'today' ? today() : new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function balanceBefore(snapshot: MoneySnapshot, date: string | null): number {
  if (!date) return snapshot.accounts.reduce((sum, item) => sum + item.openingBalanceCents, 0)
  return snapshot.accounts.reduce((total, account) => {
    if (account.openingDate >= date) return total
    return total + snapshot.transactions.filter((item) => item.date < date).reduce((sum, item) => sum + delta(item, account.id), account.openingBalanceCents)
  }, 0)
}

export default function Overview(): React.ReactElement {
  const [period, setPeriod] = useState<PeriodPreset>('all')
  return <MoneyScreen>{(snapshot) => {
    const transactions = filteredTransactions(snapshot, period)
    const income = transactions.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amountCents, 0)
    const expenses = transactions.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
    const closing = snapshot.accounts.filter((item) => !item.archivedAt).reduce((sum, item) => sum + item.balanceCents, 0)
    const opening = balanceBefore(snapshot, periodStart(period))
    const net = closing - opening
    const categoryTotals = new Map<string, number>()
    transactions.filter((item) => item.kind === 'expense' && item.categoryId).forEach((item) => categoryTotals.set(item.categoryId!, (categoryTotals.get(item.categoryId!) ?? 0) + item.amountCents))
    const ranked = snapshot.categories.map((category) => ({ category, amount: categoryTotals.get(category.id) ?? 0 })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount)
    const months = new Map<string, { income: number; expense: number }>()
    transactions.filter((item) => item.kind !== 'transfer').forEach((item) => { const key = item.date.slice(0, 7); const value = months.get(key) ?? { income: 0, expense: 0 }; value[item.kind === 'income' ? 'income' : 'expense'] += item.amountCents; months.set(key, value) })
    const monthEntries = Array.from(months.entries()).sort().slice(-6)
    const max = Math.max(1, ...monthEntries.flatMap(([, value]) => [value.income, value.expense]))
    const first = periodStart(period) ?? [...snapshot.transactions.map((item) => item.date), ...snapshot.accounts.map((item) => item.openingDate)].sort()[0] ?? today()
    const days = Math.max(1, Math.floor((new Date(`${today()}T00:00:00`).getTime() - new Date(`${first}T00:00:00`).getTime()) / 86400000) + 1)
    const accountCount = snapshot.accounts.filter((item) => !item.archivedAt).length
    const periodLabel = period === 'all' ? 'All time' : period === 'today' ? 'Today' : `This ${period}`
    return <View className="flex-1">
      <PeriodChips value={period} onChange={setPeriod} />
      <ScrollView className="flex-1 px-5" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="overflow-hidden rounded-[28px] border border-accent-500/25 bg-surface-900 px-5 pb-5 pt-6">
          <View className="absolute left-0 top-0 h-1 w-full bg-accent-400" />
          <Text className="text-lg font-semibold text-surface-200">Total balance</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            className={`mt-1 text-6xl font-bold tracking-tight ${closing < 0 ? 'text-rose-400' : 'text-surface-50'}`}
            style={{ fontVariant: ['tabular-nums'] }}
          >{money(closing)}</Text>
          <View className="mt-5 flex-row items-end justify-between border-t border-surface-700 pt-4">
            <View>
              <Text className="text-base font-medium text-surface-300">{periodLabel} change</Text>
              <Text className={`mt-1 text-2xl font-bold ${net < 0 ? 'text-rose-400' : 'text-emerald-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(net, true)}</Text>
            </View>
            <Text className="text-base font-medium text-surface-300">{accountCount} {accountCount === 1 ? 'account' : 'accounts'}</Text>
          </View>
        </View>

        <View className="mt-4 flex-row gap-3">
          <Summary label="Spent" cents={expenses} tone="expense" />
          <Summary label="Received" cents={income} tone="income" />
        </View>

        <View className="mt-4 rounded-2xl border border-surface-800 bg-surface-900/70 p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-surface-100">Monthly cash flow</Text>
            <View className="flex-row items-center gap-3">
              <Legend color="#10b981" label="In" />
              <Legend color="#f43f5e" label="Out" />
            </View>
          </View>
          {monthEntries.length === 0
            ? <Text className="py-10 text-center text-[17px] text-surface-400">Record a transaction to see the chart.</Text>
            : <View className="mt-5 h-44 flex-row items-end gap-3">{monthEntries.map(([month, value]) => <View key={month} className="flex-1 items-center"><View className="h-32 w-full flex-row items-end justify-center gap-1"><View className="w-2/5 rounded-t bg-emerald-500" style={{ height: `${Math.max(value.income ? 4 : 0, value.income / max * 100)}%` }} /><View className="w-2/5 rounded-t bg-rose-500" style={{ height: `${Math.max(value.expense ? 4 : 0, value.expense / max * 100)}%` }} /></View><Text className="mt-2 text-base font-semibold text-surface-300">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</Text></View>)}</View>}
        </View>

        <View className="mt-4 rounded-2xl border border-surface-800 bg-surface-900/70 p-4">
          <Text className="text-2xl font-bold text-surface-100">Average spending</Text>
          <View className="mt-4 flex-row"><Average label="Daily" cents={expenses / days} /><Average label="Weekly" cents={expenses / days * 7} /><Average label="Monthly" cents={expenses / days * 30.44} /></View>
        </View>

        <View className="mt-4 rounded-2xl border border-surface-800 bg-surface-900/70 p-4">
          <Text className="text-2xl font-bold text-surface-100">Top categories</Text>
          {ranked.length === 0
            ? <Text className="py-8 text-center text-[17px] text-surface-400">No expenses in this period.</Text>
            : <View className="mt-4 gap-5">{ranked.slice(0, 6).map(({ category, amount }) => <View key={category.id}><View className="flex-row items-center"><View className="h-[52px] w-[52px] items-center justify-center rounded-full" style={{ backgroundColor: category.color }}><MoneyIcon name={category.icon} size={21} /></View><Text className="ml-3 flex-1 text-xl font-semibold text-surface-100">{category.name}</Text><Text className="text-xl font-bold text-surface-100" style={{ fontVariant: ['tabular-nums'] }}>{money(amount)}</Text></View><View className="ml-16 mt-2 h-2 overflow-hidden rounded-full bg-surface-800"><View className="h-full rounded-full" style={{ width: `${expenses ? amount / expenses * 100 : 0}%`, backgroundColor: category.color }} /></View></View>)}</View>}
        </View>
      </ScrollView>
    </View>
  }}</MoneyScreen>
}

function Average({ label, cents }: { label: string; cents: number }): React.ReactElement {
  return <View className="flex-1 items-center px-1"><Text className="text-base font-semibold text-surface-300">{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit className="mt-1 text-[17px] font-bold text-rose-400" style={{ fontVariant: ['tabular-nums'] }}>{money(Math.round(cents))}</Text></View>
}

function Summary({ label, cents, tone }: { label: string; cents: number; tone: 'expense' | 'income' }): React.ReactElement {
  const expense = tone === 'expense'
  return <View className={`flex-1 rounded-2xl border p-4 ${expense ? 'border-rose-500/25 bg-rose-500/10' : 'border-emerald-500/25 bg-emerald-500/10'}`}>
    <Text className="text-[17px] font-semibold text-surface-200">{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit className={`mt-1 text-3xl font-bold ${expense ? 'text-rose-400' : 'text-emerald-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{money(cents)}</Text>
  </View>
}

function Legend({ color, label }: { color: string; label: string }): React.ReactElement {
  return <View className="flex-row items-center"><View className="mr-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} /><Text className="text-base font-medium text-surface-300">{label}</Text></View>
}
