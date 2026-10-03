import React, { useState } from 'react'
import type { AnalyzedTransactionDraft, CategoryKind, MoneySnapshot, TransactionInput } from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { useMoney } from '../../lib/money'
import { DateField } from '../DatePicker'
import { inputClass } from '../ui/input'
import { SegmentedControl } from '../ui/segmented-control'
import { ChoicePill, Label, PrimaryButton } from './Common'
import PurchaseEditor from './PurchaseEditor'

const KIND_OPTIONS = [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] as const

function dollars(cents: number): string { return (cents / 100).toFixed(2) }
function cents(value: string): number { return Math.max(0, Math.round((Number(value) || 0) * 100)) }
function notesFor(counterparty: string, notes: string): string {
  return [counterparty.trim(), notes.trim()].filter(Boolean).join('\n').slice(0, 500)
}

/** What the model read from a receipt, laid out to check and correct before it becomes a transaction. */
export default function AnalyzedTransactionEditor({
  snapshot, draft, initialAccountId, onSaved
}: {
  snapshot: MoneySnapshot
  draft: AnalyzedTransactionDraft
  initialAccountId?: string
  onSaved: (target: 'transactions' | 'purchases') => void
}): React.ReactElement {
  const money = useMoney()
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt)
  const recentAccount = snapshot.transactions.find((item) => accounts.some((account) => account.id === item.accountId))
  const [kind, setKind] = useState<CategoryKind>(draft.kind)
  const [accountId, setAccountId] = useState(accounts.some((item) => item.id === initialAccountId) ? initialAccountId ?? '' : recentAccount?.accountId ?? accounts[0]?.id ?? '')
  const [categoryId, setCategoryId] = useState(draft.categoryId ?? '')
  const [counterparty, setCounterparty] = useState(draft.counterparty)
  const [amount, setAmount] = useState(dollars(draft.amountCents))
  const [date, setDate] = useState(draft.date ?? isoToday())
  const [notes, setNotes] = useState(draft.notes)
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
    return <div>
      <SegmentedControl options={KIND_OPTIONS} value={kind} onValueChange={changeKind} className="mb-5" />
      <PurchaseEditor snapshot={snapshot} draft={draft.receipt} busy={money.busy} initialAccountId={initialAccountId} initialCategoryId={draft.categoryId} onSave={async (input) => { if (await money.createPurchase(input)) onSaved('purchases') }} />
    </div>
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
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (valid && !money.busy) void save()
  }}>
    <SegmentedControl options={KIND_OPTIONS} value={kind} onValueChange={changeKind} className="mb-5" />
    <Label text="Counterparty" htmlFor="analyzed-counterparty"><input id="analyzed-counterparty" value={counterparty} onChange={(event) => setCounterparty(event.target.value)} maxLength={120} placeholder="Person or business" className={inputClass} /></Label>
    <div className="flex gap-2">
      <div className="flex-1"><Label text="Amount in USD" htmlFor="analyzed-amount"><input id="analyzed-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" className={`${inputClass} tabular`} /></Label></div>
      <div className="flex-1"><Label text="Date"><DateField value={date} onChange={setDate} /></Label></div>
    </div>
    <Label text="Account"><div className="flex flex-wrap gap-2">{accounts.map((account) => <ChoicePill key={account.id} label={account.name} icon={account.icon} color={account.color} selected={accountId === account.id} onClick={() => setAccountId(account.id)} />)}</div></Label>
    <Label text={`${kind === 'income' ? 'Income' : 'Expense'} category`}>
      <div className="flex flex-wrap gap-2">{categories.map((category) => <ChoicePill key={category.id} label={category.name} icon={category.icon} color={category.color} selected={categoryId === category.id} onClick={() => setCategoryId(category.id)} />)}</div>
      {categories.length === 0 && <p className="mt-1.5 text-[14px] text-attention">Create an active {kind} category before saving.</p>}
    </Label>
    <Label text="Notes" htmlFor="analyzed-notes"><textarea id="analyzed-notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={360} placeholder="Visible details from the image" className={`${inputClass} min-h-20 resize-none`} /></Label>
    {draft.receipt && <p className="mb-2 text-[14px] leading-5 text-attention">Changing this itemized expense to income will save one transaction without its item list.</p>}
    <PrimaryButton type="submit" label={`Save ${kind}`} disabled={money.busy || !valid} />
  </form>
}
