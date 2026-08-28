import React, { useMemo, useState } from 'react'
import { Archive, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { CategoryInput, CategoryKind, DateRange, MoneyCategory, MoneySnapshot, PeriodPreset } from '../../../shared/types'
import { COLOR_OPTIONS, filterTransactions, formatMoney, ICON_OPTIONS, MoneyIcon, todayString } from '../../money/utils'
import type { MoneyActions } from './MoneyWorkspace'
import { buttonClass, EmptyState, inputClass, Modal, PageHeader, panelClass, PeriodControl, subtleButtonClass } from './Common'

function CategoryForm({ category, actions, onClose }: { category?: MoneyCategory; actions: MoneyActions; onClose: () => void }): React.ReactElement {
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? 'expense')
  const [icon, setIcon] = useState(category?.icon ?? 'Tag')
  const [color, setColor] = useState(category?.color ?? COLOR_OPTIONS[3])
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const input: CategoryInput = { name: name.trim(), kind, icon, color }
    const saved = category ? await actions.updateCategory(category.id, input) : await actions.createCategory(input)
    if (saved) onClose()
  }
  return <form className="space-y-4" onSubmit={(event) => void submit(event)}>
    <label className="block text-xs text-surface-400">Name<input autoFocus className={`${inputClass} mt-1.5`} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Food" /></label>
    <div className="grid grid-cols-2 gap-2">{(['expense', 'income'] as CategoryKind[]).map((value) => <button type="button" key={value} onClick={() => setKind(value)} className={`rounded-lg border px-3 py-2 text-sm capitalize ${kind === value ? 'border-accent-500 bg-accent-500/10 text-white' : 'border-surface-700 text-surface-400'}`}>{value}</button>)}</div>
    <div><span className="text-xs text-surface-400">Icon</span><div className="mt-2 grid grid-cols-9 gap-2">{ICON_OPTIONS.map((value) => <button type="button" key={value} onClick={() => setIcon(value)} className={`rounded-lg border p-2 ${icon === value ? 'border-accent-500 text-white' : 'border-surface-700 text-surface-400'}`}><MoneyIcon name={value} size={16} /></button>)}</div></div>
    <div><span className="text-xs text-surface-400">Color</span><div className="mt-2 flex gap-2">{COLOR_OPTIONS.map((value) => <button type="button" key={value} onClick={() => setColor(value)} className={`h-7 w-7 rounded-full border-2 ${color === value ? 'border-white' : 'border-transparent'}`} style={{ backgroundColor: value }} />)}</div></div>
    <div className="flex justify-end gap-2"><button type="button" className={subtleButtonClass} onClick={onClose}>Cancel</button><button className={buttonClass} disabled={!name.trim() || actions.busy}>Save category</button></div>
  </form>
}

export default function CategoriesView({ snapshot, actions }: { snapshot: MoneySnapshot; actions: MoneyActions }): React.ReactElement {
  const [editing, setEditing] = useState<MoneyCategory | 'new' | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [preset, setPreset] = useState<PeriodPreset>('all')
  const [custom, setCustom] = useState<DateRange>({ from: todayString(), to: todayString() })
  const filtered = useMemo(() => filterTransactions(snapshot.transactions, preset, custom), [snapshot.transactions, preset, custom])
  const amounts = new Map<string, number>()
  filtered.filter((transaction) => transaction.kind === 'expense' && transaction.categoryId).forEach((transaction) => amounts.set(transaction.categoryId!, (amounts.get(transaction.categoryId!) ?? 0) + transaction.amountCents))
  const categories = snapshot.categories.filter((category) => Boolean(category.archivedAt) === showArchived)
  const expenseCategories = categories.filter((category) => category.kind === 'expense').sort((a, b) => (amounts.get(b.id) ?? 0) - (amounts.get(a.id) ?? 0))
  const incomeCategories = categories.filter((category) => category.kind === 'income')
  const total = expenseCategories.reduce((sum, category) => sum + (amounts.get(category.id) ?? 0), 0)
  let cursor = 0
  const segments = expenseCategories.filter((category) => amounts.get(category.id)).map((category) => {
    const start = cursor
    cursor += ((amounts.get(category.id) ?? 0) / total) * 100
    return `${category.color} ${start}% ${cursor}%`
  })
  const canWrite = !actions.readOnly && !actions.busy
  const card = (category: MoneyCategory): React.ReactElement => {
    const amount = amounts.get(category.id) ?? 0
    return <article key={category.id} className={`${panelClass} flex items-center gap-3 p-3`}><div className="flex h-10 w-10 items-center justify-center rounded-full text-white" style={{ backgroundColor: category.color }}><MoneyIcon name={category.icon} size={18} /></div><div className="min-w-0 flex-1"><div className="truncate text-sm text-surface-100">{category.name}</div><div className="mt-0.5 text-xs text-surface-500">{category.kind === 'expense' ? `${formatMoney(amount)} · ${total ? Math.round(amount / total * 100) : 0}%` : 'Income'}</div></div><button disabled={!canWrite} className="p-1.5 text-surface-500 hover:text-white disabled:opacity-30" onClick={() => setEditing(category)}><Pencil size={13} /></button><button disabled={!canWrite} className="p-1.5 text-surface-500 hover:text-white disabled:opacity-30" onClick={() => void actions.archiveCategory(category.id, !category.archivedAt)}>{category.archivedAt ? <RotateCcw size={13} /> : <Archive size={13} />}</button></article>
  }
  return <div className="flex h-full flex-col"><PageHeader title="Categories" subtitle="Income and expense groups" action={<div className="flex gap-2"><button className={subtleButtonClass} onClick={() => setShowArchived(!showArchived)}>{showArchived ? 'Show active' : 'Archived'}</button><button className={buttonClass} disabled={!canWrite} onClick={() => setEditing('new')}><Plus size={15} />Add category</button></div>} />
    <div className="flex-1 overflow-y-auto p-6"><div className="mb-5 flex justify-end"><PeriodControl preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} /></div>
      {categories.length === 0 ? <EmptyState title={showArchived ? 'No archived categories' : 'Create your first category'} detail="Categories keep income and expenses organized. Add one before recording a transaction." actionLabel="Add category" onAction={() => setEditing('new')} archived={showArchived} /> : <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className={`${panelClass} flex flex-col items-center justify-center p-6`}><div className="relative h-48 w-48 rounded-full" style={{ background: total ? `conic-gradient(${segments.join(',')})` : '#161e35' }}><div className="absolute inset-8 flex flex-col items-center justify-center rounded-full bg-surface-950"><span className="text-xs text-surface-500">Expenses</span><span className="mt-1 text-xl text-rose-400">{formatMoney(total)}</span></div></div></div>
        <div className="space-y-5"><section><h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-surface-500">Expenses</h2><div className="grid gap-2 xl:grid-cols-2">{expenseCategories.map(card)}</div></section>{incomeCategories.length > 0 && <section><h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-surface-500">Income</h2><div className="grid gap-2 xl:grid-cols-2">{incomeCategories.map(card)}</div></section>}</div>
      </div>}
    </div>{editing && <Modal title={editing === 'new' ? 'New category' : 'Edit category'} onClose={() => setEditing(null)}><CategoryForm category={editing === 'new' ? undefined : editing} actions={actions} onClose={() => setEditing(null)} /></Modal>}</div>
}
