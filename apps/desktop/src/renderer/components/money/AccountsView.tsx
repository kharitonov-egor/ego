import React, { useState } from 'react'
import { Archive, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { AccountInput, AccountKind, MoneyAccount, MoneySnapshot } from '../../../shared/types'
import { COLOR_OPTIONS, formatMoney, ICON_OPTIONS, MoneyIcon, todayString } from '../../money/utils'
import type { MoneyActions } from './MoneyWorkspace'
import { buttonClass, EmptyState, inputClass, Modal, PageHeader, panelClass, subtleButtonClass } from './Common'

const ACCOUNT_LABELS: Record<AccountKind, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash', 'credit-card': 'Credit card',
  investment: 'Investment', crypto: 'Crypto', other: 'Other'
}

function AccountForm({ account, onSave, onClose, busy }: { account?: MoneyAccount; onSave: (input: AccountInput) => Promise<boolean>; onClose: () => void; busy: boolean }): React.ReactElement {
  const [name, setName] = useState(account?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? 'checking')
  const [icon, setIcon] = useState(account?.icon ?? 'Landmark')
  const [color, setColor] = useState(account?.color ?? COLOR_OPTIONS[0])
  const [openingBalance, setOpeningBalance] = useState(account ? String(account.openingBalanceCents / 100) : '0')
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? todayString())
  const valid = name.trim() && openingDate && Number.isFinite(Number(openingBalance))

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!valid) return
    const saved = await onSave({ name: name.trim(), kind, icon, color, openingBalanceCents: Math.round(Number(openingBalance) * 100), openingDate })
    if (saved) onClose()
  }
  return <form className="space-y-4" onSubmit={(event) => void submit(event)}>
    <label className="block text-xs text-surface-400">Name<input autoFocus className={`${inputClass} mt-1.5`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Chase checking" /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs text-surface-400">Type<select className={`${inputClass} mt-1.5`} value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>{Object.entries(ACCOUNT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-xs text-surface-400">Opening date<input type="date" className={`${inputClass} mt-1.5`} value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} /></label>
    </div>
    <label className="block text-xs text-surface-400">Opening balance in USD<input type="number" step="0.01" className={`${inputClass} mt-1.5`} value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
    <div><span className="text-xs text-surface-400">Icon</span><div className="mt-2 flex flex-wrap gap-2">{ICON_OPTIONS.slice(0, 7).map((value) => <button type="button" key={value} onClick={() => setIcon(value)} className={`rounded-lg border p-2 ${icon === value ? 'border-accent-500 text-white' : 'border-surface-700 text-surface-400'}`}><MoneyIcon name={value} size={17} /></button>)}</div></div>
    <div><span className="text-xs text-surface-400">Color</span><div className="mt-2 flex gap-2">{COLOR_OPTIONS.map((value) => <button type="button" key={value} onClick={() => setColor(value)} className={`h-7 w-7 rounded-full border-2 ${color === value ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: value }} />)}</div></div>
    <div className="flex justify-end gap-2 pt-2"><button type="button" className={subtleButtonClass} onClick={onClose}>Cancel</button><button className={buttonClass} disabled={!valid || busy}>Save account</button></div>
  </form>
}

export default function AccountsView({ snapshot, actions, onAddTransaction }: { snapshot: MoneySnapshot; actions: MoneyActions; onAddTransaction: () => void }): React.ReactElement {
  const [editing, setEditing] = useState<MoneyAccount | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const accounts = snapshot.accounts.filter((account) => Boolean(account.archivedAt) === showArchived)
  const active = snapshot.accounts.filter((account) => !account.archivedAt)
  const total = active.reduce((sum, account) => sum + account.balanceCents, 0)
  const canWrite = !actions.readOnly && !actions.busy
  return <div className="flex h-full flex-col">
    <PageHeader title="Accounts" subtitle={`${active.length} active account${active.length === 1 ? '' : 's'}`} action={<div className="flex gap-2"><button className={subtleButtonClass} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show active' : 'Archived'}</button><button className={buttonClass} disabled={!canWrite} onClick={() => setEditing('new')}><Plus size={15} />Add account</button></div>} />
    <div className="flex-1 overflow-y-auto p-6">
      <div className={`${panelClass} mb-5 flex items-end justify-between p-5`}><div><div className="text-xs uppercase tracking-wider text-surface-500">All accounts</div><div className={`mt-1 text-3xl font-light ${total < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{formatMoney(total)}</div></div><button className={subtleButtonClass} onClick={onAddTransaction}>View transactions</button></div>
      {accounts.length === 0 ? <EmptyState title={showArchived ? 'No archived accounts' : 'Create your first account'} detail={showArchived ? 'Archived accounts will stay here with their transaction history.' : 'Add checking, savings, cash, credit, investments, or crypto. Start with the balance on your chosen opening date.'} actionLabel="Add account" onAction={() => setEditing('new')} archived={showArchived} /> : <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{accounts.map((account) => <article key={account.id} className={`${panelClass} flex items-center gap-4 p-4`}>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl text-white" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} /></div>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium text-surface-100">{account.name}</h2><p className="mt-0.5 text-xs text-surface-500">{ACCOUNT_LABELS[account.kind]} · Opened {account.openingDate}</p></div>
        <div className="text-right"><div className={`font-medium ${account.balanceCents < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{formatMoney(account.balanceCents)}</div><div className="mt-2 flex justify-end gap-1"><button title="Edit" disabled={!canWrite} className="p-1.5 text-surface-500 hover:text-white disabled:opacity-30" onClick={() => setEditing(account)}><Pencil size={14} /></button><button title={account.archivedAt ? 'Restore' : 'Archive'} disabled={!canWrite} className="p-1.5 text-surface-500 hover:text-white disabled:opacity-30" onClick={() => void actions.archiveAccount(account.id, !account.archivedAt)}>{account.archivedAt ? <RotateCcw size={14} /> : <Archive size={14} />}</button></div></div>
      </article>)}</div>}
    </div>
    {editing && <Modal title={editing === 'new' ? 'New account' : 'Edit account'} onClose={() => setEditing(null)}><AccountForm account={editing === 'new' ? undefined : editing} busy={actions.busy} onClose={() => setEditing(null)} onSave={(input) => editing === 'new' ? actions.createAccount(input) : actions.updateAccount(editing.id, input)} /></Modal>}
  </div>
}
