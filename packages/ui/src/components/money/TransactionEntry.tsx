import React, { useRef, useState } from 'react'
import { CalendarDays, Check, ChevronDown, Trash2 } from 'lucide-react'
import type { MoneyAccount, MoneyCategory, MoneySnapshot, MoneyTransaction, TransactionInput, TransactionKind } from '@ego/core'
import { amountToExpression } from '@ego/local/amount-input'
import { isoToday, relativeDayLabel } from '@ego/local/dates'
import { Blurred } from '../../lib/blur'
import { useMoney } from '../../lib/money'
import { color as palette } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { DateSheet } from '../DatePicker'
import { Button } from '../ui/button'
import { ConfirmDialog, Sheet } from '../ui/dialog'
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control'
import { Spinner } from '../ui/spinner'
import { AmountInput } from './AmountInput'
import { MoneyIcon, money } from './Common'
import { typedAmountCents } from './amount'

const KIND_OPTIONS: SegmentedOption<TransactionKind>[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' }
]

const AMOUNT_COLOR: Record<TransactionKind, string> = { expense: palette.expense, income: palette.positive, transfer: palette.text }

function Field({ label, name, icon, color, placeholder, onClick }: {
  label: string
  name?: string
  icon?: string
  color?: string
  placeholder: string
  onClick: () => void
}): React.ReactElement {
  return <button
    type="button"
    aria-label={`${label}: ${name ?? placeholder}`}
    onClick={onClick}
    className="flex min-h-[64px] min-w-0 flex-1 items-center rounded-2xl border border-border bg-card px-3 text-left transition-colors hover:bg-surface-900"
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#262626' }}>
      <MoneyIcon name={icon ?? 'Tag'} color={icon ? '#ffffff' : '#737373'} size={18} />
    </span>
    <span className="ml-2.5 flex min-w-0 flex-1 flex-col">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn('truncate text-[16px] font-semibold', name ? 'text-foreground' : 'text-surface-500')}>{name ?? placeholder}</span>
    </span>
  </button>
}

function AccountOption({ account, selected, onClick }: { account: MoneyAccount; selected: boolean; onClick: () => void }): React.ReactElement {
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn('mb-2 flex min-h-[64px] w-full items-center rounded-2xl border px-3 text-left transition-colors',
      selected ? 'border-surface-500 bg-surface-900' : 'border-border bg-card hover:bg-surface-900')}
  >
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} size={20} /></span>
    <span className="ml-3 flex min-w-0 flex-1 flex-col">
      <span className="truncate text-[17px] font-semibold">{account.name}</span>
      <Blurred><span className="text-[14px] text-muted-foreground tabular">{money(account.balanceCents)}</span></Blurred>
    </span>
    {selected && <Check color="#fafafa" size={22} />}
  </button>
}

function CategoryOption({ category, selected, onClick }: { category: MoneyCategory; selected: boolean; onClick: () => void }): React.ReactElement {
  return <button
    type="button"
    aria-label={category.name}
    aria-pressed={selected}
    onClick={onClick}
    className="group mb-4 flex w-1/4 flex-col items-center px-1"
  >
    <span className={cn('flex h-14 w-14 items-center justify-center rounded-full transition-transform group-hover:scale-105', selected && 'border-[3px] border-white')} style={{ backgroundColor: category.color }}>
      <MoneyIcon name={category.icon} size={24} />
    </span>
    <span className={cn('mt-1.5 line-clamp-2 text-center text-[14px] leading-[18px]', selected ? 'font-semibold text-foreground' : 'text-surface-300')}>{category.name}</span>
  </button>
}

interface TransactionEntryProps {
  snapshot: MoneySnapshot
  transaction?: MoneyTransaction
  onClose: () => void
  onSave?: (input: TransactionInput) => Promise<boolean>
  onDelete?: () => Promise<boolean>
  busy?: boolean
}

/**
 * The phone's full-screen entry, as a sheet. The keypad is a text field that takes the same sums;
 * Enter in it saves, and Ctrl+Enter saves from the note.
 */
export default function TransactionEntry({ snapshot, transaction, onClose, onSave, onDelete, busy = false }: TransactionEntryProps): React.ReactElement {
  const state = useMoney()
  const [saveFailed, setSaveFailed] = useState(false)
  const saving = useRef(false)
  const accounts = snapshot.accounts.filter((item) => !item.archivedAt || item.id === transaction?.accountId || item.id === transaction?.destinationAccountId)
  const openAccounts = accounts.filter((item) => !item.archivedAt)
  const lastUsedAccount = (): string => {
    const recent = snapshot.transactions.find((item) => openAccounts.some((account) => account.id === item.accountId))
    return recent?.accountId ?? openAccounts[0]?.id ?? ''
  }
  const lastUsedCategory = (value: TransactionKind): string => {
    const open = snapshot.categories.filter((item) => item.kind === value && !item.archivedAt)
    const recent = snapshot.transactions.find((item) => item.kind === value && open.some((category) => category.id === item.categoryId))
    return recent?.categoryId ?? ''
  }
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? 'expense')
  const [accountId, setAccountId] = useState(() => transaction?.accountId ?? lastUsedAccount())
  const [destinationId, setDestinationId] = useState(transaction?.destinationAccountId ?? '')
  const [categoryId, setCategoryId] = useState(() => transaction?.categoryId ?? lastUsedCategory(transaction?.kind ?? 'expense'))
  const [amount, setAmount] = useState(transaction ? amountToExpression(transaction.amountCents) : '')
  const [date, setDate] = useState(transaction?.date ?? isoToday())
  const [notes, setNotes] = useState(transaction?.notes ?? '')
  const [picking, setPicking] = useState<'account' | 'target' | null>(null)
  const [datePicking, setDatePicking] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const categories = snapshot.categories.filter((item) => item.kind === kind && (!item.archivedAt || item.id === transaction?.categoryId))
  const account = accounts.find((item) => item.id === accountId)
  const destination = accounts.find((item) => item.id === destinationId)
  const category = snapshot.categories.find((item) => item.id === categoryId)
  const target: MoneyAccount | MoneyCategory | undefined = kind === 'transfer' ? destination : category
  const cents = typedAmountCents(amount) ?? 0
  const valid = Boolean(accountId && cents > 0 && date && (kind === 'transfer' ? destinationId && destinationId !== accountId : categoryId))
  const working = state.busy || busy

  const changeKind = (value: TransactionKind): void => {
    if (value === kind) return
    setKind(value)
    setDestinationId('')
    setCategoryId(lastUsedCategory(value))
  }
  const save = async (): Promise<void> => {
    if (saving.current || !valid || working) return
    saving.current = true
    setSaveFailed(false)
    const input: TransactionInput = {
      kind, accountId, destinationAccountId: kind === 'transfer' ? destinationId : null,
      categoryId: kind === 'transfer' ? null : categoryId, amountCents: cents, date, notes: notes.trim()
    }
    try {
      const saved = onSave
        ? await onSave(input)
        : transaction ? await state.updateTransaction(transaction.id, input) : await state.createTransaction(input)
      if (saved) onClose()
      else setSaveFailed(true)
    } finally {
      saving.current = false
    }
  }
  const remove = async (): Promise<void> => {
    if (!transaction) return
    const saved = onDelete ? await onDelete() : await state.deleteTransaction(transaction.id)
    if (saved) onClose()
  }

  return <>
    <Sheet
      visible
      title={transaction ? 'Edit transaction' : 'New transaction'}
      onClose={onClose}
      footer={<div className="flex gap-3">
        {transaction && <Button variant="outline" size="lg" aria-label="Delete transaction" onClick={() => setConfirmingDelete(true)} className="border-destructive/40 text-destructive">
          <Trash2 color="#fb7185" size={18} />
          Delete
        </Button>}
        <Button size="lg" disabled={!valid || working} onClick={() => void save()} className="flex-1">
          {working ? <Spinner size={20} color="#0a0a0a" /> : <Check size={22} strokeWidth={2.75} />}
          Save transaction
        </Button>
      </div>}
    >
      <SegmentedControl options={KIND_OPTIONS} value={kind} onValueChange={changeKind} />

      <div className="flex flex-col items-center pb-2 pt-6">
        <AmountInput value={amount} onChange={setAmount} onSubmit={() => void save()} color={AMOUNT_COLOR[kind]} size={56} autoFocus />
        <button
          type="button"
          aria-label={`Date: ${relativeDayLabel(date)}`}
          onClick={() => setDatePicking(true)}
          className="mt-1 flex min-h-10 items-center gap-2 rounded-full border border-input bg-surface-900 px-4 transition-colors hover:bg-surface-800"
        >
          <CalendarDays color="#d4d4d4" size={16} />
          <span className="text-[15px] font-medium text-surface-200">{relativeDayLabel(date)}</span>
          <ChevronDown color="#a3a3a3" size={16} />
        </button>
      </div>

      <div className="mt-4 flex gap-2.5">
        <Field
          label={kind === 'transfer' ? 'From' : 'Account'}
          name={account?.name}
          icon={account?.icon}
          color={account?.color}
          placeholder="Choose"
          onClick={() => setPicking('account')}
        />
        <Field
          label={kind === 'transfer' ? 'To' : 'Category'}
          name={target?.name}
          icon={target?.icon}
          color={target?.color}
          placeholder="Choose"
          onClick={() => setPicking('target')}
        />
      </div>

      {saveFailed && <p aria-live="polite" className="mt-3 text-center text-[14px] leading-5 text-amber-300">
        Not saved yet. Your entry is kept here, so you can try again.
      </p>}
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
          event.preventDefault()
          void save()
        }}
        maxLength={500}
        rows={2}
        aria-label="Note"
        placeholder="Add a note, like Publix"
        className="mt-3 w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-[16px] text-foreground outline-none transition-colors placeholder:text-surface-500 hover:border-surface-600 focus:border-surface-400"
      />
    </Sheet>

    <Sheet visible={picking === 'account'} title={kind === 'transfer' ? 'From account' : 'Account'} onClose={() => setPicking(null)} dismissOnBackdrop>
      {accounts.map((item) => <AccountOption
        key={item.id}
        account={item}
        selected={accountId === item.id}
        onClick={() => { setAccountId(item.id); if (item.id === destinationId) setDestinationId(''); setPicking(null) }}
      />)}
    </Sheet>

    <Sheet visible={picking === 'target'} title={kind === 'transfer' ? 'To account' : kind === 'income' ? 'Income category' : 'Expense category'} onClose={() => setPicking(null)} dismissOnBackdrop>
      {kind === 'transfer'
        ? accounts.filter((item) => item.id !== accountId).map((item) => <AccountOption
          key={item.id}
          account={item}
          selected={destinationId === item.id}
          onClick={() => { setDestinationId(item.id); setPicking(null) }}
        />)
        : <div className="-mx-1 flex flex-wrap">{categories.map((item) => <CategoryOption
          key={item.id}
          category={item}
          selected={categoryId === item.id}
          onClick={() => { setCategoryId(item.id); setPicking(null) }}
        />)}</div>}
      {kind !== 'transfer' && categories.length === 0 && <p className="py-6 text-center text-amber-400">Create an active {kind} category first.</p>}
    </Sheet>

    <DateSheet visible={datePicking} value={date} onClose={() => setDatePicking(false)} onChange={setDate} />

    <ConfirmDialog
      visible={confirmingDelete} title="Delete transaction?" detail="This will update the account balances immediately."
      confirmLabel="Delete" destructive busy={working}
      onCancel={() => setConfirmingDelete(false)} onConfirm={() => void remove()}
    />
  </>
}
