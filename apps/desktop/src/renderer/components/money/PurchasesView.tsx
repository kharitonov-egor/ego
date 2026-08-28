import React, { useEffect, useState } from 'react'
import { Pencil, ScanLine, Trash2 } from 'lucide-react'
import {
  type MoneyPurchase,
  type MoneySnapshot,
  type PurchaseInput,
  type ReceiptDraft,
  type ReceiptItemInput
} from '../../../shared/types'
import { displayDate, formatMoney } from '../../money/utils'
import type { MoneyActions } from './MoneyWorkspace'
import { buttonClass, inputClass, Modal, PageHeader, panelClass, subtleButtonClass } from './Common'

function amount(cents: number): string { return (cents / 100).toFixed(2) }
function cents(value: string): number { return Math.max(0, Math.round((Number(value) || 0) * 100)) }
function validPurchase(input: PurchaseInput): boolean {
  return Boolean(input.merchant && /^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) && input.accountId &&
    input.categoryId && input.totalCents > 0 && input.items.length && input.items.every((item) =>
      item.name.trim() && Number.isFinite(item.quantity) && item.quantity > 0))
}
function warnings(input: PurchaseInput): string[] {
  const result: string[] = []
  if (input.subtotalCents - input.discountCents + input.taxCents + input.feesCents !== input.totalCents) result.push('Receipt totals do not add up')
  if (input.items.reduce((sum, item) => sum + item.lineTotalCents, 0) !== input.subtotalCents) result.push('Item prices do not match the subtotal')
  return result
}

export function PurchaseForm({ purchase, draft, snapshot, actions, initialCategoryId, onClose }: { purchase?: MoneyPurchase; draft?: ReceiptDraft; snapshot: MoneySnapshot; actions: MoneyActions; initialCategoryId?: string | null; onClose: () => void }): React.ReactElement {
  const source = (purchase ?? draft) as MoneyPurchase | ReceiptDraft
  const linked = purchase ? snapshot.transactions.find((item) => item.id === purchase.transactionId) : undefined
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt || item.id === linked?.accountId)
  const categories = snapshot.categories.filter((item) => item.kind === 'expense' && (!item.archivedAt || item.id === linked?.categoryId))
  const [merchant, setMerchant] = useState(source.merchant)
  const [date, setDate] = useState(source.purchaseDate)
  const [accountId, setAccountId] = useState(linked?.accountId ?? accounts[0]?.id ?? '')
  const suggestedCategory = categories.some((item) => item.id === initialCategoryId) ? initialCategoryId : null
  const [categoryId, setCategoryId] = useState(linked?.categoryId ?? suggestedCategory ?? '')
  const [subtotal, setSubtotal] = useState(amount(source.subtotalCents))
  const [discount, setDiscount] = useState(amount(source.discountCents))
  const [tax, setTax] = useState(amount(source.taxCents))
  const [fees, setFees] = useState(amount(source.feesCents))
  const [total, setTotal] = useState(amount(source.totalCents))
  const [items, setItems] = useState<ReceiptItemInput[]>(source.items.map((item) => ({
    name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents,
    grossPriceCents: item.grossPriceCents, discountCents: item.discountCents,
    lineTotalCents: item.lineTotalCents
  })))
  const input: PurchaseInput = {
    merchant: merchant.trim(), purchaseDate: date, currency: 'USD', accountId, categoryId,
    subtotalCents: cents(subtotal), discountCents: cents(discount), taxCents: cents(tax),
    feesCents: cents(fees), totalCents: cents(total), items
  }
  const reconciliationWarnings = validPurchase(input) ? warnings(input) : []
  const changeItem = (index: number, patch: Partial<ReceiptItemInput>): void => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!validPurchase(input)) return
    const saved = purchase
      ? await actions.updatePurchase(purchase.id, input)
      : await actions.createPurchase(input)
    if (saved) onClose()
  }
  return <form className="space-y-4" onSubmit={(event) => void submit(event)}>
    <div className="grid grid-cols-2 gap-3"><label className="text-xs text-surface-400">Merchant<input className={`${inputClass} mt-1.5`} value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label><label className="text-xs text-surface-400">Purchase date<input type="date" className={`${inputClass} mt-1.5`} value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    <div className="grid grid-cols-2 gap-3"><label className="text-xs text-surface-400">Account<select className={`${inputClass} mt-1.5`} value={accountId} onChange={(event) => setAccountId(event.target.value)}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs text-surface-400">Expense category<select className={`${inputClass} mt-1.5`} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    <div className="grid grid-cols-5 gap-2">{[['Subtotal', subtotal, setSubtotal], ['Discount', discount, setDiscount], ['Tax', tax, setTax], ['Fees and tip', fees, setFees], ['Grand total', total, setTotal]].map(([label, value, setter]) => <label key={label as string} className="text-xs text-surface-400">{label as string}<input type="number" min="0" step="0.01" className={`${inputClass} mt-1.5`} value={value as string} onChange={(event) => (setter as (value: string) => void)(event.target.value)} /></label>)}</div>
    <p className="text-xs text-surface-500">Grand total becomes the account transaction amount.</p>
    {reconciliationWarnings.map((warning) => <p key={warning} className="text-xs text-amber-400">{warning}. Check the values before saving.</p>)}
    <div><div className="mb-2 flex items-center justify-between"><span className="text-sm text-surface-200">Items</span><button type="button" className={subtleButtonClass} onClick={() => setItems((current) => [...current, { name: '', quantity: 1, unitPriceCents: null, grossPriceCents: 0, discountCents: 0, lineTotalCents: 0 }])}>Add item</button></div><div className="space-y-2">{items.map((item, index) => <div key={index} className="rounded-xl border border-surface-800 p-3"><div className="flex gap-2"><input className={`${inputClass} flex-1`} value={item.name} onChange={(event) => changeItem(index, { name: event.target.value })} placeholder="Item name" /><button type="button" className="px-2 text-rose-400" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div><div className="mt-2 grid grid-cols-5 gap-2"><input title="Quantity" type="number" min="0.001" step="any" className={inputClass} value={item.quantity} onChange={(event) => changeItem(index, { quantity: Number(event.target.value) })} /><input title="Unit price" type="number" min="0" step="0.01" className={inputClass} value={item.unitPriceCents === null ? '' : amount(item.unitPriceCents)} placeholder="Unit" onChange={(event) => changeItem(index, { unitPriceCents: event.target.value ? cents(event.target.value) : null })} /><input title="Gross price" type="number" min="0" step="0.01" className={inputClass} value={amount(item.grossPriceCents)} onChange={(event) => changeItem(index, { grossPriceCents: cents(event.target.value) })} /><input title="Discount" type="number" min="0" step="0.01" className={inputClass} value={amount(item.discountCents)} onChange={(event) => changeItem(index, { discountCents: cents(event.target.value) })} /><input title="Line price" type="number" min="0" step="0.01" className={inputClass} value={amount(item.lineTotalCents)} onChange={(event) => changeItem(index, { lineTotalCents: cents(event.target.value) })} /></div></div>)}</div></div>
    <div className="flex justify-end gap-2"><button type="button" className={subtleButtonClass} onClick={onClose}>Cancel</button><button className={buttonClass} disabled={actions.busy || !validPurchase(input)}>{purchase ? 'Save purchase' : 'Save purchase and expense'}</button></div>
  </form>
}

export default function PurchasesView({ snapshot, actions, openPurchaseId, onAnalyze }: { snapshot: MoneySnapshot; actions: MoneyActions; openPurchaseId?: string | null; onAnalyze: () => void }): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(openPurchaseId ?? null)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (openPurchaseId) setSelectedId(openPurchaseId) }, [openPurchaseId])
  const selected = snapshot.purchases.find((item) => item.id === selectedId) ?? null
  const groups = new Map<string, MoneyPurchase[]>()
  snapshot.purchases.forEach((item) => groups.set(item.purchaseDate, [...(groups.get(item.purchaseDate) ?? []), item]))
  const remove = async (): Promise<void> => {
    if (!selected || !window.confirm('Delete this purchase and its linked expense?')) return
    if (await actions.deletePurchase(selected.id)) setSelectedId(null)
  }
  return <div className="flex h-full flex-col"><PageHeader title="Purchases" subtitle={`${snapshot.purchases.length} itemized`} action={<button className={buttonClass} disabled={actions.readOnly || actions.busy} onClick={onAnalyze}><ScanLine size={15} />Analyze image</button>} />
    <div className="flex min-h-0 flex-1"><div className="min-w-0 flex-1 overflow-y-auto p-5">{snapshot.purchases.length === 0 ? <div className={`${panelClass} flex min-h-64 flex-col items-center justify-center p-8 text-center`}><ScanLine size={24} className="text-surface-500" /><h2 className="mt-4 text-base font-medium text-surface-100">No itemized purchases</h2><p className="mt-1 text-sm text-surface-400">Analyze an itemized receipt here or in the mobile app.</p></div> : <div className="space-y-4">{Array.from(groups.entries()).map(([date, purchases]) => <section key={date}><h2 className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-surface-500">{displayDate(date)}</h2><div className={`${panelClass} divide-y divide-surface-800 overflow-hidden`}>{purchases.map((purchase) => <button key={purchase.id} onClick={() => setSelectedId(purchase.id)} className={`flex w-full items-center gap-3 p-3 text-left hover:bg-surface-800/60 ${selectedId === purchase.id ? 'bg-surface-800/70' : ''}`}><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400"><ScanLine size={17} /></div><div className="flex-1"><div className="text-sm text-surface-100">{purchase.merchant}</div><div className="mt-0.5 text-xs text-surface-500">{purchase.items.length} {purchase.items.length === 1 ? 'item' : 'items'}</div></div><span className="text-rose-400">{formatMoney(purchase.totalCents)}</span></button>)}</div></section>)}</div>}</div>{selected && <aside className="w-80 shrink-0 overflow-y-auto border-l border-surface-800 bg-surface-900/40 p-5"><div className="flex items-start justify-between"><div><div className="text-xs text-surface-500">{displayDate(selected.purchaseDate)}</div><h2 className="mt-1 text-lg font-medium">{selected.merchant}</h2></div><span className="text-rose-400">{formatMoney(selected.totalCents)}</span></div><div className="mt-5 divide-y divide-surface-800 overflow-hidden rounded-xl border border-surface-800">{selected.items.map((item) => <div key={item.id} className="flex items-center gap-3 px-3 py-2.5"><span className="min-w-0 flex-1 truncate text-sm text-surface-200">{item.name}</span><span className="text-sm text-surface-300">{formatMoney(item.lineTotalCents)}</span></div>)}</div><dl className="mt-5 space-y-2 text-xs">{[['Subtotal', selected.subtotalCents], ['Discount', -selected.discountCents], ['Tax', selected.taxCents], ['Fees', selected.feesCents]].map(([label, value]) => <div key={label as string} className="flex justify-between"><dt className="text-surface-500">{label as string}</dt><dd>{formatMoney(value as number, true)}</dd></div>)}</dl><div className="mt-6 flex gap-2"><button className={`${subtleButtonClass} flex-1`} disabled={actions.readOnly} onClick={() => setEditing(true)}><Pencil size={14} />Edit</button><button className="rounded-lg border border-rose-500/30 p-2 text-rose-400 disabled:opacity-30" disabled={actions.readOnly} onClick={() => void remove()}><Trash2 size={15} /></button></div></aside>}</div>{editing && selected && <Modal title="Edit purchase" onClose={() => setEditing(false)}><PurchaseForm purchase={selected} snapshot={snapshot} actions={actions} onClose={() => setEditing(false)} /></Modal>}</div>
}
