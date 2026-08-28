import React, { useMemo, useState } from 'react'
import { ArrowRight, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type {
  DateRange, MoneySnapshot, MoneyTransaction, PeriodPreset, TransactionInput, TransactionKind
} from '../../../shared/types'
import { displayDate, filterTransactions, formatMoney, MoneyIcon, todayString } from '../../money/utils'
import type { MoneyActions } from './MoneyWorkspace'
import { buttonClass, EmptyState, inputClass, Modal, PageHeader, panelClass, PeriodControl, subtleButtonClass } from './Common'

function TransactionForm({ transaction, snapshot, actions, onClose }: { transaction?: MoneyTransaction; snapshot: MoneySnapshot; actions: MoneyActions; onClose: () => void }): React.ReactElement {
  const accounts = snapshot.accounts.filter((account) => !account.archivedAt || transaction?.accountId === account.id || transaction?.destinationAccountId === account.id)
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? 'expense')
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? '')
  const [destinationAccountId, setDestinationAccountId] = useState(transaction?.destinationAccountId ?? '')
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '')
  const [amount, setAmount] = useState(transaction ? String(transaction.amountCents / 100) : '')
  const [date, setDate] = useState(transaction?.date ?? todayString())
  const [notes, setNotes] = useState(transaction?.notes ?? '')
  const categories = snapshot.categories.filter((category) => category.kind === kind && (!category.archivedAt || transaction?.categoryId === category.id))
  const valid = accountId && Number(amount) > 0 && date && (kind === 'transfer' ? destinationAccountId && destinationAccountId !== accountId : categoryId)

  const changeKind = (value: TransactionKind): void => {
    setKind(value)
    setCategoryId('')
    setDestinationAccountId('')
  }
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!valid) return
    const input: TransactionInput = {
      kind,
      accountId,
      destinationAccountId: kind === 'transfer' ? destinationAccountId : null,
      categoryId: kind === 'transfer' ? null : categoryId,
      amountCents: Math.round(Number(amount) * 100),
      date,
      notes: notes.trim()
    }
    const saved = transaction ? await actions.updateTransaction(transaction.id, input) : await actions.createTransaction(input)
    if (saved) onClose()
  }
  return <form className="space-y-4" onSubmit={(event) => void submit(event)}>
    <div className="grid grid-cols-3 gap-2">{(['expense', 'income', 'transfer'] as TransactionKind[]).map((value) => <button key={value} type="button" onClick={() => changeKind(value)} className={`rounded-lg border px-2 py-2 text-sm capitalize ${kind === value ? value === 'income' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : value === 'expense' ? 'border-rose-500 bg-rose-500/10 text-rose-300' : 'border-accent-500 bg-accent-500/10 text-accent-300' : 'border-surface-700 text-surface-400'}`}>{value}</button>)}</div>
    <label className="block text-xs text-surface-400">{kind === 'transfer' ? 'From account' : 'Account'}<select className={`${inputClass} mt-1.5`} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select an account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
    {kind === 'transfer' ? <label className="block text-xs text-surface-400">To account<select className={`${inputClass} mt-1.5`} value={destinationAccountId} onChange={(event) => setDestinationAccountId(event.target.value)}><option value="">Select an account</option>{accounts.filter((account) => account.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label> : <label className="block text-xs text-surface-400">Category<select className={`${inputClass} mt-1.5`} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">{categories.length ? 'Select a category' : `Create an ${kind} category first`}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
    <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-surface-400">Amount in USD<input autoFocus type="number" min="0.01" step="0.01" className={`${inputClass} mt-1.5`} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label className="block text-xs text-surface-400">Date<input type="date" className={`${inputClass} mt-1.5`} value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
    <label className="block text-xs text-surface-400">Notes<textarea className={`${inputClass} mt-1.5 min-h-20 resize-none`} value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Optional details" /></label>
    <div className="flex justify-end gap-2"><button type="button" className={subtleButtonClass} onClick={onClose}>Cancel</button><button className={buttonClass} disabled={!valid || actions.busy}>Save transaction</button></div>
  </form>
}

function transactionTitle(transaction: MoneyTransaction, snapshot: MoneySnapshot): string {
  if (transaction.kind === 'transfer') {
    const destination = snapshot.accounts.find((account) => account.id === transaction.destinationAccountId)
    return destination?.name ?? 'Transfer'
  }
  return snapshot.categories.find((category) => category.id === transaction.categoryId)?.name ?? 'Archived category'
}

export default function TransactionsView({ snapshot, actions }: { snapshot: MoneySnapshot; actions: MoneyActions }): React.ReactElement {
  const [editing, setEditing] = useState<MoneyTransaction | 'new' | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [preset, setPreset] = useState<PeriodPreset>('all')
  const [custom, setCustom] = useState<DateRange>({ from: todayString(), to: todayString() })
  const transactions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return filterTransactions(snapshot.transactions, preset, custom).filter((transaction) => {
      const account = snapshot.accounts.find((item) => item.id === transaction.accountId)?.name ?? ''
      return !query || transaction.notes.toLowerCase().includes(query) || account.toLowerCase().includes(query) || transactionTitle(transaction, snapshot).toLowerCase().includes(query)
    })
  }, [snapshot, preset, custom, search])
  const groups = new Map<string, MoneyTransaction[]>()
  transactions.forEach((transaction) => groups.set(transaction.date, [...(groups.get(transaction.date) ?? []), transaction]))
  const selected = snapshot.transactions.find((transaction) => transaction.id === selectedId) ?? null
  const canCreate = snapshot.accounts.filter((account) => !account.archivedAt).length > 0 && !actions.readOnly
  const remove = async (transaction: MoneyTransaction): Promise<void> => {
    if (!window.confirm('Delete this transaction? Account balances will update immediately.')) return
    if (await actions.deleteTransaction(transaction.id)) setSelectedId(null)
  }
  return <div className="flex h-full flex-col"><PageHeader title="Transactions" subtitle={`${snapshot.transactions.length} recorded`} action={<button className={buttonClass} disabled={!canCreate || actions.busy} onClick={() => setEditing('new')}><Plus size={15} />Add transaction</button>} />
    <div className="border-b border-surface-800 px-6 py-3"><div className="flex flex-wrap items-center gap-3"><div className="relative min-w-48 flex-1"><Search size={14} className="absolute left-3 top-2.5 text-surface-500" /><input className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notes, accounts, or categories" /></div><PeriodControl preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} /></div></div>
    <div className="flex min-h-0 flex-1"><div className="min-w-0 flex-1 overflow-y-auto p-5">{transactions.length === 0 ? <EmptyState title={snapshot.transactions.length ? 'No matching transactions' : 'Record your first transaction'} detail={snapshot.accounts.length ? 'Add income, an expense, or a transfer between accounts.' : 'Create an account before recording transactions.'} actionLabel="Add transaction" onAction={() => setEditing('new')} /> : <div className="space-y-4">{Array.from(groups.entries()).map(([date, items]) => {
      const net = items.reduce((sum, item) => sum + (item.kind === 'income' ? item.amountCents : item.kind === 'expense' ? -item.amountCents : 0), 0)
      return <section key={date}><div className="mb-1 flex items-center justify-between px-2"><h2 className="text-xs font-medium uppercase tracking-wide text-surface-500">{displayDate(date)}</h2><span className={`text-xs ${net < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{formatMoney(net, true)}</span></div><div className={`${panelClass} divide-y divide-surface-800 overflow-hidden`}>{items.map((transaction) => {
        const category = snapshot.categories.find((item) => item.id === transaction.categoryId)
        const account = snapshot.accounts.find((item) => item.id === transaction.accountId)
        return <button key={transaction.id} onClick={() => setSelectedId(transaction.id)} className={`flex w-full items-center gap-3 p-3 text-left hover:bg-surface-800/60 ${selectedId === transaction.id ? 'bg-surface-800/70' : ''}`}><div className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ backgroundColor: category?.color ?? '#3c4b73' }}><MoneyIcon name={category?.icon ?? (transaction.kind === 'transfer' ? 'ArrowRight' : 'Tag')} size={16} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm text-surface-100">{transactionTitle(transaction, snapshot)}</div><div className="mt-0.5 flex items-center gap-1 text-xs text-surface-500"><span>{account?.name ?? 'Archived account'}</span>{transaction.kind === 'transfer' && <><ArrowRight size={10} /><span>{transactionTitle(transaction, snapshot)}</span></>}</div>{transaction.notes && <div className="mt-0.5 truncate text-xs italic text-surface-500">{transaction.notes}</div>}</div><span className={`font-medium ${transaction.kind === 'income' ? 'text-emerald-400' : transaction.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}`}>{transaction.kind === 'income' ? '+' : transaction.kind === 'expense' ? '-' : ''}{formatMoney(transaction.amountCents)}</span></button>
      })}</div></section>})}</div>}</div>
      {selected && <aside className="w-72 shrink-0 overflow-y-auto border-l border-surface-800 bg-surface-900/40 p-5"><div className="flex items-start justify-between"><div><div className="text-xs capitalize text-surface-500">{selected.kind}</div><h2 className="mt-1 text-lg font-medium">{transactionTitle(selected, snapshot)}</h2></div><span className={selected.kind === 'income' ? 'text-emerald-400' : selected.kind === 'expense' ? 'text-rose-400' : 'text-accent-400'}>{formatMoney(selected.amountCents)}</span></div><dl className="mt-6 space-y-4 text-sm"><div><dt className="text-xs text-surface-500">Date</dt><dd className="mt-1">{displayDate(selected.date)}</dd></div><div><dt className="text-xs text-surface-500">Account</dt><dd className="mt-1">{snapshot.accounts.find((account) => account.id === selected.accountId)?.name}</dd></div>{selected.destinationAccountId && <div><dt className="text-xs text-surface-500">Destination</dt><dd className="mt-1">{snapshot.accounts.find((account) => account.id === selected.destinationAccountId)?.name}</dd></div>}<div><dt className="text-xs text-surface-500">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-surface-300">{selected.notes || 'No notes'}</dd></div></dl><div className="mt-6 flex gap-2"><button className={`${subtleButtonClass} flex-1`} disabled={actions.readOnly} onClick={() => setEditing(selected)}><Pencil size={14} />Edit</button><button className="rounded-lg border border-rose-500/30 p-2 text-rose-400 hover:bg-rose-500/10 disabled:opacity-30" disabled={actions.readOnly} onClick={() => void remove(selected)}><Trash2 size={15} /></button></div></aside>}
    </div>{editing && <Modal title={editing === 'new' ? 'New transaction' : 'Edit transaction'} onClose={() => setEditing(null)}><TransactionForm transaction={editing === 'new' ? undefined : editing} snapshot={snapshot} actions={actions} onClose={() => setEditing(null)} /></Modal>}</div>
}
