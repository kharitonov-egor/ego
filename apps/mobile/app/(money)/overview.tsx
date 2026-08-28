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
    return <View className="flex-1"><PeriodChips value={period} onChange={setPeriod} /><ScrollView className="flex-1 px-5"><View className="items-center rounded-3xl border border-surface-800 bg-surface-900/60 py-5"><Text className="text-xs text-surface-500">Balance change</Text><Text className={`mt-1 text-3xl font-light ${net < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{money(net, true)}</Text><Text className="mt-2 text-xs text-surface-500">{money(opening)} to {money(closing)}</Text></View><View className="mt-3 flex-row gap-3"><View className="flex-1 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4"><Text className="text-xs text-surface-400">Expenses</Text><Text className="mt-1 text-xl text-rose-400">{money(expenses)}</Text></View><View className="flex-1 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4"><Text className="text-xs text-surface-400">Income</Text><Text className="mt-1 text-xl text-emerald-400">{money(income)}</Text></View></View><View className="mt-3 rounded-2xl border border-surface-800 bg-surface-900/60 p-4"><Text className="text-sm font-medium text-surface-200">Monthly cash flow</Text>{monthEntries.length === 0 ? <Text className="py-10 text-center text-sm text-surface-500">Record a transaction to see the chart.</Text> : <View className="mt-5 h-40 flex-row items-end gap-3">{monthEntries.map(([month, value]) => <View key={month} className="flex-1 items-center"><View className="h-28 w-full flex-row items-end justify-center gap-1"><View className="w-2/5 rounded-t bg-emerald-500" style={{ height: `${Math.max(value.income ? 4 : 0, value.income / max * 100)}%` }} /><View className="w-2/5 rounded-t bg-rose-500" style={{ height: `${Math.max(value.expense ? 4 : 0, value.expense / max * 100)}%` }} /></View><Text className="mt-2 text-[10px] text-surface-500">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</Text></View>)}</View>}</View><View className="mt-3 flex-row gap-2"><Average label="Day" cents={expenses / days} /><Average label="Week" cents={expenses / days * 7} /><Average label="Month" cents={expenses / days * 30.44} /></View><View className="mb-8 mt-3 rounded-2xl border border-surface-800 bg-surface-900/60 p-4"><Text className="text-sm font-medium text-surface-200">Top categories</Text>{ranked.length === 0 ? <Text className="py-8 text-center text-sm text-surface-500">No expenses in this period.</Text> : <View className="mt-4 gap-4">{ranked.slice(0, 6).map(({ category, amount }) => <View key={category.id}><View className="flex-row items-center"><View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: category.color }}><MoneyIcon name={category.icon} size={14} /></View><Text className="ml-2 flex-1 text-sm text-surface-300">{category.name}</Text><Text className="text-sm text-surface-200">{money(amount)}</Text></View><View className="ml-10 mt-2 h-1.5 overflow-hidden rounded-full bg-surface-800"><View className="h-full rounded-full" style={{ width: `${expenses ? amount / expenses * 100 : 0}%`, backgroundColor: category.color }} /></View></View>)}</View>}</View></ScrollView></View>
  }}</MoneyScreen>
}

function Average({ label, cents }: { label: string; cents: number }): React.ReactElement {
  return <View className="flex-1 rounded-xl bg-surface-900 p-3"><Text className="text-center text-[10px] uppercase text-surface-500">{label}</Text><Text className="mt-1 text-center text-xs text-rose-400">{money(Math.round(cents))}</Text></View>
}
