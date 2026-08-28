import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ArrowRight, Plus, ScanLine, Search } from 'lucide-react-native'
import { useRouter } from 'expo-router'
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
  const [period, setPeriod] = useState<PeriodPreset>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<MoneyTransaction | 'new' | null>(null)
  return <MoneyScreen>{(snapshot) => {
    const query = search.trim().toLowerCase()
    const transactions = filteredTransactions(snapshot, period).filter((item) => {
      const account = snapshot.accounts.find((accountItem) => accountItem.id === item.accountId)?.name ?? ''
      return !query || item.notes.toLowerCase().includes(query) || title(item, snapshot).toLowerCase().includes(query) || account.toLowerCase().includes(query)
    })
    const groups = new Map<string, MoneyTransaction[]>()
    transactions.forEach((item) => groups.set(item.date, [...(groups.get(item.date) ?? []), item]))
    return <View className="flex-1"><View className="mx-5 mt-3 flex-row items-center rounded-xl border border-surface-800 bg-surface-900 px-3"><Search color="#636f8f" size={16} /><TextInput value={search} onChangeText={setSearch} placeholder="Search transactions" placeholderTextColor="#3c4b73" className="ml-2 flex-1 py-3 text-sm text-surface-100" /></View><PeriodChips value={period} onChange={setPeriod} /><ScrollView className="flex-1 px-5">{transactions.length === 0 ? <Empty title={snapshot.transactions.length ? 'No matching transactions' : 'Record your first transaction'} detail="Add income, an expense, or a transfer between two accounts." /> : <View className="gap-5">{Array.from(groups.entries()).map(([date, items]) => <View key={date}><View className="mb-2 flex-row justify-between"><Text className="text-xs uppercase tracking-wider text-surface-500">{new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text><Text className="text-xs text-surface-500">{money(items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0), true)}</Text></View><View className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/70">{items.map((item, index) => {
      const category = snapshot.categories.find((categoryItem) => categoryItem.id === item.categoryId)
      const account = snapshot.accounts.find((accountItem) => accountItem.id === item.accountId)
      const purchase = snapshot.purchases.find((purchaseItem) => purchaseItem.transactionId === item.id)
      return <Pressable key={item.id} onPress={() => purchase ? router.push({ pathname: '/(money)/purchases', params: { purchaseId: purchase.id } }) : setEditing(item)} className={`flex-row items-center p-3 ${index > 0 ? 'border-t border-surface-800' : ''}`}><View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#3c4b73' }}><MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={17} /></View><View className="ml-3 flex-1"><Text className="text-sm text-surface-100" style={{ color: '#d8dbe3' }}>{purchase?.merchant ?? title(item, snapshot)}</Text><View className="mt-0.5 flex-row items-center"><Text className="text-xs text-surface-500" style={{ color: '#636f8f' }}>{account?.name ?? 'Archived account'}</Text>{item.kind === 'transfer' && <><ArrowRight color="#636f8f" size={10} style={{ marginHorizontal: 4 }} /><Text className="text-xs text-surface-500" style={{ color: '#636f8f' }}>{title(item, snapshot)}</Text></>}</View>{item.notes && !purchase && <Text numberOfLines={1} className="mt-0.5 text-xs italic text-surface-500" style={{ color: '#636f8f' }}>{item.notes}</Text>}</View><Text className={item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}>{item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''}{money(item.amountCents)}</Text></Pressable>
    })}</View></View>)}</View>}<View className="h-24" /></ScrollView>{!editing && <><Pressable disabled={state.readOnly} onPress={() => router.push('/transaction-image')} className="absolute bottom-5 right-24 h-14 w-14 items-center justify-center rounded-2xl border border-surface-700 bg-surface-900"><ScanLine color="#8a93ab" size={23} /></Pressable><Pressable disabled={state.readOnly || snapshot.accounts.filter((item) => !item.archivedAt).length === 0} onPress={() => setEditing('new')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600"><Plus color="#fff" size={25} /></Pressable></>}{editing && <TransactionEntry key={editing === 'new' ? 'new' : editing.id} snapshot={snapshot} transaction={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</View>
  }}</MoneyScreen>
}
