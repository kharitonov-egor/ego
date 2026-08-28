import React, { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ArrowRight, Plus, Search, Trash2 } from 'lucide-react-native'
import type { MoneySnapshot, MoneyTransaction, PeriodPreset, TransactionInput, TransactionKind } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import {
  Chips, ConfirmDialog, Empty, Label, MoneyIcon, MoneyScreen, PeriodChips, PrimaryButton, Sheet,
  filteredTransactions, inputClass, money, today
} from '../../components/money/Common'

function TransactionForm({ snapshot, transaction, onClose }: { snapshot: MoneySnapshot; transaction?: MoneyTransaction; onClose: () => void }): React.ReactElement {
  const state = useMoney()
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt || item.id === transaction?.accountId || item.id === transaction?.destinationAccountId)
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? 'expense')
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? '')
  const [destinationId, setDestinationId] = useState(transaction?.destinationAccountId ?? '')
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '')
  const [amount, setAmount] = useState(transaction ? String(transaction.amountCents / 100) : '')
  const [date, setDate] = useState(transaction?.date ?? today())
  const [notes, setNotes] = useState(transaction?.notes ?? '')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const categories = snapshot.categories.filter((item) => item.kind === kind && (!item.archivedAt || item.id === transaction?.categoryId))
  const valid = Boolean(accountId && Number(amount) > 0 && date && (kind === 'transfer' ? destinationId && destinationId !== accountId : categoryId))
  const changeKind = (value: TransactionKind): void => { setKind(value); setDestinationId(''); setCategoryId('') }
  const save = async (): Promise<void> => {
    const input: TransactionInput = { kind, accountId, destinationAccountId: kind === 'transfer' ? destinationId : null, categoryId: kind === 'transfer' ? null : categoryId, amountCents: Math.round(Number(amount) * 100), date, notes: notes.trim() }
    const saved = transaction ? await state.updateTransaction(transaction.id, input) : await state.createTransaction(input)
    if (saved) onClose()
  }
  const remove = async (): Promise<void> => {
    if (!transaction) return
    const saved = await state.deleteTransaction(transaction.id)
    if (saved) onClose()
  }
  return <View><Label text="Type"><Chips values={['expense', 'income', 'transfer'] as const} value={kind} onChange={changeKind} /></Label><Label text={kind === 'transfer' ? 'From account' : 'Account'}><View className="gap-2">{accounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id)} className={`flex-row items-center rounded-xl border px-3 py-2.5 ${accountId === account.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><View className="h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} size={15} /></View><Text className={`ml-2 text-sm ${accountId === account.id ? 'text-accent-400' : 'text-surface-300'}`}>{account.name}</Text></Pressable>)}</View></Label>{kind === 'transfer' ? <Label text="To account"><View className="gap-2">{accounts.filter((item) => item.id !== accountId).map((account) => <Pressable key={account.id} onPress={() => setDestinationId(account.id)} className={`rounded-xl border px-3 py-3 ${destinationId === account.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className={destinationId === account.id ? 'text-accent-400' : 'text-surface-300'}>{account.name}</Text></Pressable>)}</View></Label> : <Label text="Category"><View className="flex-row flex-wrap gap-2">{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} className={`flex-row items-center rounded-full border px-3 py-2 ${categoryId === category.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><MoneyIcon name={category.icon} color={category.color} size={14} /><Text className={`ml-1.5 text-xs ${categoryId === category.id ? 'text-accent-400' : 'text-surface-400'}`}>{category.name}</Text></Pressable>)}</View>{categories.length === 0 && <Text className="mt-2 text-xs text-amber-400">Create an active {kind} category first.</Text>}</Label>}<Label text="Amount in USD"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#3c4b73" className={inputClass} /></Label><Label text="Date"><TextInput value={date} onChangeText={setDate} autoCapitalize="none" placeholder="YYYY-MM-DD" placeholderTextColor="#3c4b73" className={inputClass} /></Label><Label text="Notes"><TextInput value={notes} onChangeText={setNotes} multiline maxLength={500} placeholder="Optional details" placeholderTextColor="#3c4b73" className={`${inputClass} min-h-20`} /></Label><PrimaryButton label="Save transaction" onPress={() => void save()} disabled={!valid || state.busy} />{transaction && <Pressable onPress={() => setConfirmingDelete(true)} className="mt-3 flex-row items-center justify-center rounded-xl border border-rose-500/30 py-3"><Trash2 color="#fb7185" size={16} /><Text className="ml-2 text-sm text-rose-400">Delete transaction</Text></Pressable>}<ConfirmDialog visible={confirmingDelete} title="Delete transaction?" detail="This will update the account balances immediately." confirmLabel="Delete" destructive busy={state.busy} hideNavigation={false} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()} /></View>
}

function title(transaction: MoneyTransaction, snapshot: MoneySnapshot): string {
  if (transaction.kind === 'transfer') return snapshot.accounts.find((item) => item.id === transaction.destinationAccountId)?.name ?? 'Transfer'
  return snapshot.categories.find((item) => item.id === transaction.categoryId)?.name ?? 'Archived category'
}

export default function Transactions(): React.ReactElement {
  const state = useMoney()
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
      return <Pressable key={item.id} onPress={() => setEditing(item)} className={`flex-row items-center p-3 ${index > 0 ? 'border-t border-surface-800' : ''}`}><View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: category?.color ?? '#3c4b73' }}><MoneyIcon name={category?.icon ?? (item.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={17} /></View><View className="ml-3 flex-1"><Text className="text-sm text-surface-100">{title(item, snapshot)}</Text><View className="mt-0.5 flex-row items-center"><Text className="text-xs text-surface-500">{account?.name ?? 'Archived account'}</Text>{item.kind === 'transfer' && <><ArrowRight color="#636f8f" size={10} style={{ marginHorizontal: 4 }} /><Text className="text-xs text-surface-500">{title(item, snapshot)}</Text></>}</View>{item.notes && <Text numberOfLines={1} className="mt-0.5 text-xs italic text-surface-500">{item.notes}</Text>}</View><Text className={item.kind === 'income' ? 'text-emerald-400' : item.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}>{item.kind === 'income' ? '+' : item.kind === 'expense' ? '-' : ''}{money(item.amountCents)}</Text></Pressable>
    })}</View></View>)}</View>}<View className="h-24" /></ScrollView>{!editing && <Pressable disabled={state.readOnly || snapshot.accounts.filter((item) => !item.archivedAt).length === 0} onPress={() => setEditing('new')} className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-2xl bg-accent-600"><Plus color="#fff" size={25} /></Pressable>}<Sheet visible={Boolean(editing)} title={editing === 'new' ? 'New transaction' : 'Transaction'} onClose={() => setEditing(null)}>{editing && <TransactionForm key={editing === 'new' ? 'new' : editing.id} snapshot={snapshot} transaction={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</Sheet></View>
  }}</MoneyScreen>
}
