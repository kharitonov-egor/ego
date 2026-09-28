import React, { useMemo, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Plus, Trash2 } from 'lucide-react-native'
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
import { ChoicePill, Label, PrimaryButton, inputClass } from './Common'
import { DateField } from './DatePicker'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

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
    <Label text="Merchant"><TextInput value={merchant} onChangeText={setMerchant} placeholder="Store name" placeholderTextColor="#737373" className={inputClass} /></Label>
    <Label text="Purchase date"><DateField label="Purchase date" value={date} onChange={setDate} /></Label>
    <Label text="Account"><View className="flex-row flex-wrap gap-2">{accounts.map((account) => <ChoicePill key={account.id} label={account.name} icon={account.icon} color={account.color} selected={accountId === account.id} onPress={() => setAccountId(account.id)} />)}</View></Label>
    <Label text="Expense category"><View className="flex-row flex-wrap gap-2">{categories.map((category) => <ChoicePill key={category.id} label={category.name} icon={category.icon} color={category.color} selected={categoryId === category.id} onPress={() => setCategoryId(category.id)} />)}</View></Label>
    <View className="flex-row flex-wrap gap-2">{[
      ['Subtotal', subtotal, setSubtotal], ['Discount', discount, setDiscount], ['Tax', tax, setTax],
      ['Fees and tip', fees, setFees], ['Grand total', total, setTotal]
    ].map(([label, value, setter]) => <View key={label as string} className="w-[48%]"><Text className="mb-2 text-[15px] font-medium text-surface-200">{label as string}</Text><TextInput value={value as string} onChangeText={setter as (value: string) => void} keyboardType="decimal-pad" className={inputClass} /></View>)}</View>
    <Text className="mt-2 text-[14px] leading-5 text-muted-foreground">Grand total becomes the account transaction amount.</Text>
    {warnings.map((warning) => <Text key={warning} className="mt-2 text-[15px] leading-5 text-attention">{warning}. Check the values before saving.</Text>)}
    <View className="mb-2 mt-6 flex-row items-center justify-between">
      <Text className="text-[18px] font-semibold text-foreground">Items</Text>
      <Button variant="outline" size="sm" onPress={addItem}><Plus color="#fafafa" size={16} /><UiText>Add item</UiText></Button>
    </View>
    <View className="gap-3">{items.map((item, index) => <View key={index} className="rounded-2xl border border-border bg-card p-3">
      <View className="flex-row items-center"><TextInput value={item.name} onChangeText={(value) => changeItem(index, { name: value })} placeholder="Item name" placeholderTextColor="#737373" className={`${inputClass} flex-1`} /><Pressable accessibilityRole="button" accessibilityLabel="Remove item" onPress={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-2 h-12 w-12 items-center justify-center rounded-xl active:bg-surface-800"><Trash2 color="#fb7185" size={18} /></Pressable></View>
      <View className="mt-2 flex-row gap-2"><View className="flex-1"><Text className="mb-2 text-[15px] font-medium text-surface-200">Quantity</Text><TextInput value={String(item.quantity)} onChangeText={(value) => changeItem(index, { quantity: Number(value) || 0 })} keyboardType="decimal-pad" className={inputClass} /></View><View className="flex-1"><Text className="mb-2 text-[15px] font-medium text-surface-200">Unit price</Text><TextInput value={item.unitPriceCents === null ? '' : dollars(item.unitPriceCents)} onChangeText={(value) => changeItem(index, { unitPriceCents: value === '' ? null : cents(value) })} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor="#a3a3a3" className={inputClass} /></View></View>
      <View className="mt-2 flex-row flex-wrap gap-2"><View className="w-[48%]"><Text className="mb-2 text-[15px] font-medium text-surface-200">Gross</Text><TextInput value={dollars(item.grossPriceCents)} onChangeText={(value) => changeItem(index, { grossPriceCents: cents(value) })} keyboardType="decimal-pad" className={inputClass} /></View><View className="w-[48%]"><Text className="mb-2 text-[15px] font-medium text-surface-200">Discount</Text><TextInput value={dollars(item.discountCents)} onChangeText={(value) => changeItem(index, { discountCents: cents(value) })} keyboardType="decimal-pad" className={inputClass} /></View><View className="w-[48%]"><Text className="mb-2 text-[15px] font-medium text-surface-200">Line price</Text><TextInput value={dollars(item.lineTotalCents)} onChangeText={(value) => changeItem(index, { lineTotalCents: cents(value) })} keyboardType="decimal-pad" className={inputClass} /></View></View>
    </View>)}</View>
    <View className="mt-6"><PrimaryButton label={purchase ? 'Save purchase' : 'Save purchase and expense'} onPress={() => void onSave(input)} disabled={busy || !isPurchaseInput(input)} /></View>
  </View>
}
