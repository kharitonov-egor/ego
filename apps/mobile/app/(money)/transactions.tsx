import React, { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ArrowRight, Plus, ScanLine, Search, Tags } from 'lucide-react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { MoneySnapshot, MoneyTransaction, PeriodPreset } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { Empty, MoneyIcon, MoneyScreen, PeriodChips, filteredTransactions, money } from '../../components/money/Common'
import TransactionEntry from '../../components/money/TransactionEntry'

function title(transaction: MoneyTransaction, snapshot: MoneySnapshot): string {
  if (transaction.kind === 'transfer') return snapshot.accounts.find((item) => item.id === transaction.destinationAccountId)?.name ?? 'Transfer'
  return snapshot.categories.find((item) => item.id === transaction.categoryId)?.name ?? 'Archived category'
}

export default function Transactions(): React.ReactElement {
  const state = useMoney()
  const router = useRouter()
  const params = useLocalSearchParams<{ new?: string }>()
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MoneyTransaction | 'new' | null>(null)
  useEffect(() => {
    if (params.new !== 'true') return
    setEditing('new')
    router.setParams({ new: undefined })
  }, [params.new, router])
  return <MoneyScreen>{(snapshot) => {
    const query = search.trim().toLowerCase()
    const transactions = filteredTransactions(snapshot, period).filter((item) => {
      const account = snapshot.accounts.find((accountItem) => accountItem.id === item.accountId)?.name ?? ''
      return !query || item.notes.toLowerCase().includes(query) || title(item, snapshot).toLowerCase().includes(query) || account.toLowerCase().includes(query)
    })
    const groups = new Map<string, MoneyTransaction[]>()
    transactions.forEach((item) => groups.set(item.date, [...(groups.get(item.date) ?? []), item]))
    return <View className="flex-1"><View className="mx-5 mt-3 flex-row gap-2"><View className="flex-1 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-4"><Search color="#b5b5bc" size={22} /><TextInput value={search} onChangeText={setSearch} placeholder="Search activity" placeholderTextColor="#707078" className="ml-3 flex-1 py-4 text-lg text-surface-100" /></View><Pressable accessibilityRole="button" accessibilityLabel="Manage categories" onPress={() => router.push('/(money)/categories')} className="h-14 w-14 items-center justify-center rounded-xl border border-surface-700 bg-surface-900"><Tags color="#b5b5bc" size={24} /></Pressable></View><PeriodChips value={period} onChange={setPeriod} /><ScrollView className="flex-1 px-5">{transactions.length === 0 ? <Empty title={snapshot.transactions.length ? 'No matching transactions' : 'Record your first transaction'} detail="Add income, an expense, or a transfer between two accounts." /> : <View className="gap-6">{Array.from(groups.entries()).map(([date, items]) => <View key={date}><View className="mb-3 flex-row justify-between"><Text className="text-[17px] font-semibold text-surface-300">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text><Text className="text-[17px] font-bold text-surface-200" style={{ fontVariant: ['tabular-nums'] }}>{money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}</Text></View><View className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/70">{items.map((item, index) => {
      const category = snapshot.categories.find((categoryItem) => categoryItem.id === item.categoryId)
      const account = snapshot.accounts.find((accountItem) => accountItem.id === item.accountId)
      const purchase = snapshot.purchases.find((purchaseItem) => purchaseItem.transactionId === item.id)
      return <Pressable accessibilityRole="button" key={item.id} onPress={() => purchase ? router.push({ pathname: '/(money)/purchases', params: { purchaseId: purchase.id } }) : setEditing(item)} className={`min-h-[92px] flex-row items-center px-4 py-4 ${index > 0 ? 'border-t border-surface-800' : ''}`}><View className="h-[52px] w-[52px] items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#707078' }}><MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={21} /></View><View className="ml-3 flex-1"><Text className="text-xl font-semibold text-surface-100">{purchase?.merchant ?? title(item, snapshot)}</Text><View className="mt-1 flex-row items-center"><Text className="text-base text-surface-400">{account?.name ?? 'Archived account'}</Text>{item.kind === 'transfer' && <><ArrowRight color="#909099" size={15} style={{ marginHorizontal: 5 }} /><Text className="text-base text-surface-400">{title(item, snapshot)}</Text></>}</View>{item.notes && !purchase && <Text numberOfLines={1} className="mt-1 text-base italic text-surface-400">{item.notes}</Text>}</View><Text className={`ml-3 text-xl font-bold ${item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}`} style={{ fontVariant: ['tabular-nums'] }}>{item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''}{money(item.amountCents)}</Text></Pressable>
    })}</View></View>)}</View>}<View className="h-24" /></ScrollView>{!editing && <><Pressable accessibilityRole="button" disabled={state.readOnly} onPress={() => router.push('/transaction-image')} className="absolute bottom-5 right-[88px] h-14 flex-row items-center rounded-2xl border border-surface-700 bg-surface-900 px-4"><ScanLine color="#b5b5bc" size={22} /><Text className="ml-2 text-base font-semibold text-surface-200">Scan receipt</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Add transaction" disabled={state.readOnly || snapshot.accounts.filter((item) => !item.archivedAt).length === 0} onPress={() => setEditing('new')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600"><Plus color="#fff" size={29} /></Pressable></>}{editing && <TransactionEntry key={editing === 'new' ? 'new' : editing.id} snapshot={snapshot} transaction={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</View>
  }}</MoneyScreen>
}
