import React, { useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { CalendarDays, Plus, Trash2 } from 'lucide-react-native'
import {
  isPurchaseInput,
  receiptReconciliationWarnings,
  type MoneyCategory,
  type MoneyPurchase,
  type MoneySnapshot,
  type PurchaseInput,
  type ReceiptDraft,
  type ReceiptItemInput
} from '@ego/core'
import { Label, PrimaryButton, inputClass } from './Common'
import { CalendarDialog } from './DatePicker'
import { formatIso } from '../../lib/dates'

function dollars(cents: number): string {
  return (cents / 100).toFixed(2)
}

function cents(value: string): number {
  return Math.max(0, Math.round((Number(value) || 0) * 100))
}

function lastUsedExpenseCategory(snapshot: MoneySnapshot, categories: MoneyCategory[]): string {
  const recent = snapshot.transactions.find((item) => categories.some((category) => category.id === item.categoryId))
  return recent?.categoryId ?? categories[0]?.id ?? ''
}

export function draftForPurchase(purchase: MoneyPurchase): ReceiptDraft {
  return {
    merchant: purchase.merchant, purchaseDate: purchase.purchaseDate, currency: purchase.currency,
    subtotalCents: purchase.subtotalCents, discountCents: purchase.discountCents,
    taxCents: purchase.taxCents, feesCents: purchase.feesCents, totalCents: purchase.totalCents,
    items: purchase.items.map((item) => ({
      name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents,
      grossPriceCents: item.grossPriceCents, discountCents: item.discountCents,
      lineTotalCents: item.lineTotalCents
    }))
  }
}

export default function PurchaseEditor({
  snapshot, draft, purchase, busy, initialAccountId, initialCategoryId, onSave
}: {
  snapshot: MoneySnapshot
  draft: ReceiptDraft
  purchase?: MoneyPurchase
  busy: boolean
  initialAccountId?: string
  initialCategoryId?: string | null
  onSave: (input: PurchaseInput) => Promise<void>
}): React.ReactElement {
  const linked = purchase ? snapshot.transactions.find((item) => item.id === purchase.transactionId) : undefined
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt || item.id === linked?.accountId)
  const categories = snapshot.categories.filter((item) => item.kind === 'expense' && (!item.archivedAt || item.id === linked?.categoryId))
  const [merchant, setMerchant] = useState(draft.merchant)
  const [date, setDate] = useState(draft.purchaseDate)
  const suggestedAccount = accounts.some((item) => item.id === initialAccountId) ? initialAccountId : null
  const [accountId, setAccountId] = useState(linked?.accountId ?? suggestedAccount ?? accounts[0]?.id ?? '')
  const suggestedCategory = categories.some((item) => item.id === initialCategoryId) ? initialCategoryId : null
  const [categoryId, setCategoryId] = useState(linked?.categoryId ?? suggestedCategory ?? lastUsedExpenseCategory(snapshot, categories))
  const [subtotal, setSubtotal] = useState(dollars(draft.subtotalCents))
  const [discount, setDiscount] = useState(dollars(draft.discountCents))
  const [tax, setTax] = useState(dollars(draft.taxCents))
  const [fees, setFees] = useState(dollars(draft.feesCents))
  const [total, setTotal] = useState(dollars(draft.totalCents))
  const [items, setItems] = useState<ReceiptItemInput[]>(draft.items)
  const [datePicking, setDatePicking] = useState(false)

  const input = useMemo<PurchaseInput>(() => ({
    merchant: merchant.trim(), purchaseDate: date, currency: draft.currency,
    subtotalCents: cents(subtotal), discountCents: cents(discount), taxCents: cents(tax),
    feesCents: cents(fees), totalCents: cents(total), items, accountId, categoryId
  }), [accountId, categoryId, date, discount, draft.currency, fees, items, merchant, subtotal, tax, total])
  const warnings = isPurchaseInput(input) ? receiptReconciliationWarnings(input) : []
  const changeItem = (index: number, patch: Partial<ReceiptItemInput>): void => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  const addItem = (): void => setItems((current) => [...current, {
    name: '', quantity: 1, unitPriceCents: null, grossPriceCents: 0, discountCents: 0, lineTotalCents: 0
  }])

  return <View>
    <Label text="Merchant"><TextInput value={merchant} onChangeText={setMerchant} placeholder="Store name" placeholderTextColor="#707078" className={inputClass} /></Label>
    <Label text="Purchase date"><Pressable onPress={() => setDatePicking(true)} className={`${inputClass} flex-row items-center justify-between`}><Text className="text-[13px] text-surface-100">{formatIso(date)}</Text><CalendarDays color="#b5b5bc" size={15} /></Pressable></Label>
    <CalendarDialog visible={datePicking} value={date} onCancel={() => setDatePicking(false)} onConfirm={(iso) => { setDate(iso); setDatePicking(false) }} />
    <Label text="Account"><View className="gap-2">{accounts.map((account) => <Pressable key={account.id} onPress={() => setAccountId(account.id)} className={`rounded-lg border px-2.5 py-2 ${accountId === account.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className="text-[13px]" style={{ color: accountId === account.id ? '#91c4ff' : '#b5b5bc' }}>{account.name}</Text></Pressable>)}</View></Label>
    <Label text="Expense category"><View className="flex-row flex-wrap gap-2">{categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} className={`rounded-full border px-2.5 py-1.5 ${categoryId === category.id ? 'border-accent-500 bg-accent-500/15' : 'border-surface-800 bg-surface-900'}`}><Text className="text-[12px]" style={{ color: categoryId === category.id ? '#91c4ff' : '#b5b5bc' }}>{category.name}</Text></Pressable>)}</View></Label>
    <View className="flex-row flex-wrap gap-2">{[
      ['Subtotal', subtotal, setSubtotal], ['Discount', discount, setDiscount], ['Tax', tax, setTax],
      ['Fees and tip', fees, setFees], ['Grand total', total, setTotal]
    ].map(([label, value, setter]) => <View key={label as string} className="w-[48%]"><Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">{label as string}</Text><TextInput value={value as string} onChangeText={setter as (value: string) => void} keyboardType="decimal-pad" className={inputClass} /></View>)}</View>
    <Text className="mt-1.5 text-[11px] leading-4 text-surface-400">Grand total becomes the account transaction amount.</Text>
    {warnings.map((warning) => <Text key={warning} className="mt-1.5 text-[11px] leading-4 text-amber-400">{warning}. Check the values before saving.</Text>)}
    <View className="mb-1.5 mt-4 flex-row items-center justify-between"><Text className="text-[14px] font-bold text-surface-100">Items</Text><Pressable onPress={addItem} className="flex-row items-center rounded-lg border border-surface-700 px-2.5 py-1.5"><Plus color="#b5b5bc" size={13} /><Text className="ml-1 text-[11px] font-semibold text-surface-300">Add item</Text></Pressable></View>
    <View className="gap-2">{items.map((item, index) => <View key={index} className="rounded-lg border border-surface-800 bg-surface-900/60 p-2.5">
      <View className="flex-row items-center"><TextInput value={item.name} onChangeText={(value) => changeItem(index, { name: value })} placeholder="Item name" placeholderTextColor="#707078" className={`${inputClass} flex-1`} /><Pressable onPress={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-2 p-2"><Trash2 color="#fb7185" size={14} /></Pressable></View>
      <View className="mt-2 flex-row gap-2"><View className="flex-1"><Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Quantity</Text><TextInput value={String(item.quantity)} onChangeText={(value) => changeItem(index, { quantity: Number(value) || 0 })} keyboardType="decimal-pad" className={inputClass} /></View><View className="flex-1"><Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Unit price</Text><TextInput value={item.unitPriceCents === null ? '' : dollars(item.unitPriceCents)} onChangeText={(value) => changeItem(index, { unitPriceCents: value === '' ? null : cents(value) })} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor="#707078" className={inputClass} /></View></View>
      <View className="mt-2 flex-row flex-wrap gap-2"><View className="w-[48%]"><Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Gross</Text><TextInput value={dollars(item.grossPriceCents)} onChangeText={(value) => changeItem(index, { grossPriceCents: cents(value) })} keyboardType="decimal-pad" className={inputClass} /></View><View className="w-[48%]"><Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Discount</Text><TextInput value={dollars(item.discountCents)} onChangeText={(value) => changeItem(index, { discountCents: cents(value) })} keyboardType="decimal-pad" className={inputClass} /></View><View className="w-[48%]"><Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Line price</Text><TextInput value={dollars(item.lineTotalCents)} onChangeText={(value) => changeItem(index, { lineTotalCents: cents(value) })} keyboardType="decimal-pad" className={inputClass} /></View></View>
    </View>)}</View>
    <View className="mt-4"><PrimaryButton label={purchase ? 'Save purchase' : 'Save purchase and expense'} onPress={() => void onSave(input)} disabled={busy || !isPurchaseInput(input)} /></View>
  </View>
}
