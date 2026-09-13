import React from 'react'
import { ScrollView, Text, View } from 'react-native'
import { MoneyIcon, MoneyScreen, PeriodChips, filteredTransactions, money, today } from '../../components/money/Common'
import { CARD, CARD_PADDING, HERO_AMOUNT, SECTION_TITLE, tabular } from '../../components/money/tokens'
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
      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="overflow-hidden rounded-3xl bg-accent-600 px-5 pb-5 pt-6">
          <Text className="text-[14px] font-semibold uppercase tracking-wider text-white/70">Total balance</Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            className={`mt-1.5 ${HERO_AMOUNT} text-white`}
            style={tabular}
          >{money(closing)}</Text>
          <View className="mt-5 flex-row items-center justify-between">
            <View className="rounded-full bg-black/20 px-3.5 py-2">
              <Text className="text-[14px] font-semibold text-white" style={tabular}>{money(net, true)} {label.toLowerCase()}</Text>
            </View>
            <Text className="text-[14px] font-medium text-white/70">{accountCount} {accountCount === 1 ? 'account' : 'accounts'}</Text>
          </View>
        </View>

        <View className="mt-3 flex-row gap-3">
          <Summary label="Spent" cents={expenses} tone="expense" />
          <Summary label="Received" cents={income} tone="income" />
        </View>

        <View className={`mt-3 ${CARD} ${CARD_PADDING}`}>
          <View className="flex-row items-center justify-between">
            <Text className={SECTION_TITLE}>Cash flow</Text>
            <View className="flex-row items-center gap-3">
              <Legend color="#34d399" label="In" />
              <Legend color="#8a8a92" label="Out" />
            </View>
          </View>
          {monthEntries.length === 0
            ? <Text className="py-8 text-center text-[16px] text-surface-500">Record a transaction to see the chart.</Text>
            : <View className="mt-5 h-32 flex-row items-end gap-2.5">{monthEntries.map(([month, value]) => <View key={month} className="flex-1 items-center">
              <View className="h-24 w-full flex-row items-end justify-center gap-1">
                <View className="w-2/5 rounded-full bg-positive" style={{ height: `${Math.max(value.income ? 5 : 0, value.income / max * 100)}%` }} />
                <View className="w-2/5 rounded-full bg-surface-600" style={{ height: `${Math.max(value.expense ? 5 : 0, value.expense / max * 100)}%` }} />
              </View>
              <Text className="mt-2 text-[14px] font-semibold text-surface-500">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</Text>
            </View>)}</View>}
        </View>

        <View className={`mt-3 ${CARD} ${CARD_PADDING}`}>
          <Text className={SECTION_TITLE}>Average spending</Text>
          <View className="mt-4 flex-row">
            <Average label="Daily" cents={expenses / days} />
            <Average label="Weekly" cents={expenses / days * 7} />
            <Average label="Monthly" cents={expenses / days * 30.44} />
          </View>
        </View>

        <View className={`mt-3 ${CARD} ${CARD_PADDING}`}>
          <Text className={SECTION_TITLE}>Top categories</Text>
          {ranked.length === 0
            ? <Text className="py-7 text-center text-[16px] text-surface-500">No expenses in this period.</Text>
            : <View className="mt-4 gap-4">{ranked.slice(0, 6).map(({ category, amount }) => <View key={category.id}>
              <View className="flex-row items-center">
                <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: category.color }}>
                  <MoneyIcon name={category.icon} size={18} />
                </View>
                <Text numberOfLines={1} className="ml-3 flex-1 text-[16px] font-semibold text-surface-100">{category.name}</Text>
                <Text className="text-[16px] font-semibold text-surface-100" style={tabular}>{money(amount)}</Text>
              </View>
              <View className="ml-14 mt-2 h-1.5 overflow-hidden rounded-full bg-surface-800">
                <View className="h-full rounded-full" style={{ width: `${expenses ? amount / expenses * 100 : 0}%`, backgroundColor: category.color }} />
              </View>
            </View>)}</View>}
        </View>
      </ScrollView>
    </View>
  }}</MoneyScreen>
}

function Average({ label, cents }: { label: string; cents: number }): React.ReactElement {
  return <View className="flex-1 items-center px-1">
    <Text className="text-[14px] font-medium text-surface-500">{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit className="mt-1 text-[20px] font-bold text-surface-100" style={tabular}>{money(Math.round(cents))}</Text>
  </View>
}

function Summary({ label, cents, tone }: { label: string; cents: number; tone: 'expense' | 'income' }): React.ReactElement {
  const expense = tone === 'expense'
  return <View className={`flex-1 rounded-3xl border p-5 ${expense ? 'border-surface-800 bg-surface-900/80' : 'border-positive/25 bg-positive/10'}`}>
    <Text className="text-[14px] font-semibold uppercase tracking-wider text-surface-500">{label}</Text>
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      className={`mt-1.5 text-[24px] font-bold ${expense ? 'text-surface-100' : 'text-positive'}`}
      style={tabular}
    >{money(cents)}</Text>
  </View>
}

function Legend({ color, label }: { color: string; label: string }): React.ReactElement {
  return <View className="flex-row items-center">
    <View className="mr-1.5 h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    <Text className="text-[14px] font-medium text-surface-500">{label}</Text>
  </View>
}
