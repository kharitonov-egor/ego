import React, { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import { DateField } from '../DatePicker'
import { Button } from '../ui/button'
import { inputClass } from '../ui/input'
import { ChoicePill, Label, PrimaryButton } from './Common'

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

function SmallLabel({ children }: { children: string }): React.ReactElement {
  return <span className="mb-2 block text-[15px] font-medium text-surface-200">{children}</span>
}

/**
 * An item number shown tidy ("4.50"), but left as typed while it has the focus, so "4." can
 * become "4.5" without snapping back to "4.00" under the cursor.
 */
function DraftInput({ shown, onChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  shown: string
  onChange: (text: string) => void
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  return <input
    {...props}
    value={draft ?? shown}
    onFocus={() => setDraft(shown)}
    onBlur={() => setDraft(null)}
    onChange={(event) => {
      setDraft(event.target.value)
      onChange(event.target.value)
    }}
    inputMode="decimal"
    className={`${inputClass} tabular`}
  />
}

/** Enter in any field saves, as long as the receipt adds up to a valid purchase. */
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
  const valid = isPurchaseInput(input)
  const warnings = valid ? receiptReconciliationWarnings(input) : []
  const changeItem = (index: number, patch: Partial<ReceiptItemInput>): void => {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  const addItem = (): void => setItems((current) => [...current, {
    name: '', quantity: 1, unitPriceCents: null, grossPriceCents: 0, discountCents: 0, lineTotalCents: 0
  }])
  const totals: Array<[string, string, (value: string) => void]> = [
    ['Subtotal', subtotal, setSubtotal], ['Discount', discount, setDiscount], ['Tax', tax, setTax],
    ['Fees and tip', fees, setFees], ['Grand total', total, setTotal]
  ]

  return <form onSubmit={(event) => {
    event.preventDefault()
    if (!busy && valid) void onSave(input)
  }}>
    <Label text="Merchant" htmlFor="purchase-merchant"><input id="purchase-merchant" value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="Store name" className={inputClass} /></Label>
    <Label text="Purchase date"><DateField label="Purchase date" value={date} onChange={setDate} /></Label>
    <Label text="Account"><div className="flex flex-wrap gap-2">{accounts.map((account) => <ChoicePill key={account.id} label={account.name} icon={account.icon} color={account.color} selected={accountId === account.id} onClick={() => setAccountId(account.id)} />)}</div></Label>
    <Label text="Expense category"><div className="flex flex-wrap gap-2">{categories.map((category) => <ChoicePill key={category.id} label={category.name} icon={category.icon} color={category.color} selected={categoryId === category.id} onClick={() => setCategoryId(category.id)} />)}</div></Label>
    <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">{totals.map(([label, value, setter]) => <label key={label} className="block">
      <SmallLabel>{label}</SmallLabel>
      <input value={value} onChange={(event) => setter(event.target.value)} inputMode="decimal" className={`${inputClass} tabular`} />
    </label>)}</div>
    <p className="mt-2 text-[14px] leading-5 text-muted-foreground">Grand total becomes the account transaction amount.</p>
    {warnings.map((warning) => <p key={warning} className="mt-2 text-[15px] leading-5 text-attention">{warning}. Check the values before saving.</p>)}
    <div className="mb-2 mt-6 flex items-center justify-between">
      <h3 className="text-[18px] font-semibold text-foreground">Items</h3>
      <Button variant="outline" size="sm" onClick={addItem}><Plus color="#fafafa" size={16} />Add item</Button>
    </div>
    <div className="flex flex-col gap-3">{items.map((item, index) => <div key={index} className="rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center">
        <input value={item.name} onChange={(event) => changeItem(index, { name: event.target.value })} aria-label="Item name" placeholder="Item name" className={`${inputClass} flex-1`} />
        <button type="button" aria-label="Remove item" title="Remove item" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-800"><Trash2 color="#fb7185" size={18} /></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <label className="block"><SmallLabel>Quantity</SmallLabel><DraftInput shown={String(item.quantity)} onChange={(value) => changeItem(index, { quantity: Number(value) || 0 })} /></label>
        <label className="block"><SmallLabel>Unit price</SmallLabel><DraftInput shown={item.unitPriceCents === null ? '' : dollars(item.unitPriceCents)} onChange={(value) => changeItem(index, { unitPriceCents: value === '' ? null : cents(value) })} placeholder="Optional" /></label>
        <label className="block"><SmallLabel>Gross</SmallLabel><DraftInput shown={dollars(item.grossPriceCents)} onChange={(value) => changeItem(index, { grossPriceCents: cents(value) })} /></label>
        <label className="block"><SmallLabel>Discount</SmallLabel><DraftInput shown={dollars(item.discountCents)} onChange={(value) => changeItem(index, { discountCents: cents(value) })} /></label>
        <label className="block"><SmallLabel>Line price</SmallLabel><DraftInput shown={dollars(item.lineTotalCents)} onChange={(value) => changeItem(index, { lineTotalCents: cents(value) })} /></label>
      </div>
    </div>)}</div>
    <div className="mt-6"><PrimaryButton type="submit" label={purchase ? 'Save purchase' : 'Save purchase and expense'} disabled={busy || !valid} /></div>
  </form>
}
