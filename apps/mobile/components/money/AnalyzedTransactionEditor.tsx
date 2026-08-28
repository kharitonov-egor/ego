import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { CalendarDays } from 'lucide-react-native'
import type { AnalyzedTransactionDraft, CategoryKind, MoneySnapshot, TransactionInput } from '@ego/core'
import { useMoney } from '../../lib/money-context'
import { formatIso, isoToday } from '../../lib/dates'
import { CalendarDialog } from './DatePicker'
import { Label, PrimaryButton, inputClass } from './Common'
import PurchaseEditor from './PurchaseEditor'

function dollars(cents: number): string { return (cents / 100).toFixed(2) }
function cents(value: string): number { return Math.max(0, Math.round((Number(value) || 0) * 100)) }
function notesFor(counterparty: string, notes: string): string {
  return [counterparty.trim(), notes.trim()].filter(Boolean).join('\n').slice(0, 500)
}

export default function AnalyzedTransactionEditor({
  snapshot, draft, onSaved
}: {
  snapshot: MoneySnapshot
  draft: AnalyzedTransactionDraft
  onSaved: (target: 'transactions' | 'purchases') => void
}): React.ReactElement {
  const money = useMoney()
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt)
  const recentAccount = snapshot.transactions.find((item) => accounts.some((account) => account.id === item.accountId))
  const [kind, setKind] = useState<CategoryKind>(draft.kind)
  const [accountId, setAccountId] = useState(recentAccount?.accountId ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? '')
  const [counterparty, setCounterparty] = useState(draft.counterparty)
  const [amount, setAmount] = useState(dollars(draft.amountCents))
  const [date, setDate] = useState(draft.date ?? isoToday())
  const [notes, setNotes] = useState(draft.notes)
  const [datePicking, setDatePicking] = useState(false)
  const categories = snapshot.categories.filter((item) => item.kind === kind && !item.archivedAt)
  const itemized = Boolean(draft.receipt) && kind === 'expense'
  const changeKind = (value: CategoryKind): void => {
    setKind(value)
    const suggested = value === draft.kind && snapshot.categories.some((item) =>
      item.id === draft.categoryId && item.kind === value && !item.archivedAt)
      ? draft.categoryId ?? ''
      : ''
    setCategoryId(suggested)
  }

  if (itemized && draft.receipt) {
    return <View>
      <View className="mb-4 flex-row gap-2">{(['expense', 'income'] as CategoryKind[]).map((value) => <Pressable key={value} onPress={() => changeKind(value)} className={`flex-1 rounded-xl border px-3 py-3 ${kind === value ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className={`text-center text-sm capitalize ${kind === value ? 'text-accent-300' : 'text-surface-400'}`} style={{ color: kind === value ? '#93c5fd' : '#8a93ab' }}>{value}</Text></Pressable>)}</View>
      <PurchaseEditor snapshot={snapshot} draft={draft.receipt} busy={money.busy} initialCategoryId={draft.categoryId} onSave={async (input) => { if (await money.createPurchase(input)) onSaved('purchases') }} />
    </View>
  }

  const amountCents = cents(amount)
  const valid = Boolean(accountId && categoryId && amountCents > 0 && date && counterparty.trim())
  const save = async (): Promise<void> => {
    const input: TransactionInput = {
      kind, accountId, destinationAccountId: null, categoryId,
      amountCents, date, notes: notesFor(counterparty, notes)
    }
    if (await money.createTransaction(input)) onSaved('transactions')
  }
  return <View>
    <View className="mb-4 flex-row gap-2">{(['expense', 'income'] as CategoryKind[]).map((value) => <Pressable key={value} onPress={() => changeKind(value)} className={`flex-1 rounded-xl border px-3 py-3 ${kind === value ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className={`text-center text-sm capitalize ${kind === value ? 'text-accent-300' : 'text-surface-400'}`} style={{ color: kind === value ? '#93c5fd' : '#8a93ab' }}>{value}</Text></Pressable>)}</View>
    <Label text="Counterparty"><TextInput value={counterparty} onChangeText={setCounterparty} maxLength={120} placeholder="Person or business" placeholderTextColor="#3c4b73" className={inputClass} /></Label>
    <View className="flex-row gap-3"><View className="flex-1"><Label text="Amount in USD"><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#3c4b73" className={inputClass} /></Label></View><View className="flex-1"><Label text="Date"><Pressable onPress={() => setDatePicking(true)} className={`${inputClass} flex-row items-center justify-between`}><Text className="text-sm text-surface-100">{formatIso(date)}</Text><CalendarDays color="#8a93ab" size={16} /></Pressable></Label></View></View>
    <CalendarDialog visible={datePicking} value={date} onCancel={() => setDatePicking(false)} onConfirm={(iso) => { setDate(iso); setDatePicking(false) }} />
    <Label text="Account"><View className="gap-2">{accounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id)} className={`rounded-xl border px-3 py-3 ${accountId === account.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className={accountId === account.id ? 'text-accent-300' : 'text-surface-300'} style={{ color: accountId === account.id ? '#93c5fd' : '#8a93ab' }}>{account.name}</Text></Pressable>)}</View></Label>
    <Label text={`${kind === 'income' ? 'Income' : 'Expense'} category`}><View className="flex-row flex-wrap gap-2">{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} className={`rounded-full border px-3 py-2 ${categoryId === category.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className={categoryId === category.id ? 'text-accent-300' : 'text-surface-400'} style={{ color: categoryId === category.id ? '#93c5fd' : '#8a93ab' }}>{category.name}</Text></Pressable>)}</View>{categories.length === 0 && <Text className="mt-2 text-xs text-amber-400">Create an active {kind} category before saving.</Text>}</Label>
    <Label text="Notes"><TextInput value={notes} onChangeText={setNotes} multiline maxLength={360} placeholder="Visible details from the image" placeholderTextColor="#3c4b73" className={`${inputClass} min-h-20`} /></Label>
    {draft.receipt && <Text className="mb-3 text-xs text-amber-400">Changing this itemized expense to income will save one transaction without its item list.</Text>}
    <PrimaryButton label={`Save ${kind}`} onPress={() => void save()} disabled={money.busy || !valid} />
  </View>
}
