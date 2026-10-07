import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { Pencil, Plus } from 'lucide-react'
import type { CategoryInput, CategoryKind, MoneyCategory } from '@ego/core'
import { localSnapshot } from '@ego/local/repositories/snapshot'
import {
  COLORS, ColorPicker, EntityPreview, IconPicker, Label, MoneyIcon, MoneyScreen,
  PrimaryButton, filteredTransactions, money
} from '../../components/money/Common'
import { PeriodBar } from '../../components/money/PeriodBar'
import { PeriodSwipe } from '../../components/money/PeriodSwipe'
import { Screen } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { ConfirmDialog, Sheet } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Spinner } from '../../components/ui/spinner'
import { BlurSpan, Blurred } from '../../lib/blur'
import { useMoney, useMoneyQuery } from '../../lib/money'
import { usePeriod } from '../../lib/period'
import { cn } from '../../lib/utils'
import { FinanceHeader } from './header'

const KIND_OPTIONS = [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] as const

function CategoryForm({ category, defaultKind, onClose, onArchive }: {
  category?: MoneyCategory
  defaultKind: CategoryKind
  onClose: () => void
  onArchive: (category: MoneyCategory) => void
}): React.ReactElement {
  const moneyState = useMoney()
  const [name, setName] = useState(category?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>(category?.kind ?? defaultKind)
  const [icon, setIcon] = useState(category?.icon ?? 'Tag')
  const [color, setColor] = useState(category?.color ?? COLORS[kind === 'income' ? 1 : 3])
  const valid = Boolean(name.trim()) && !moneyState.busy
  const save = async (): Promise<void> => {
    const input: CategoryInput = { name: name.trim(), kind, icon, color }
    const saved = category ? await moneyState.updateCategory(category.id, input) : await moneyState.createCategory(input)
    if (saved) onClose()
  }
  return <form onSubmit={(event) => {
    event.preventDefault()
    if (valid) void save()
  }}>
    <EntityPreview shape="circle" name={name} placeholder="New category" icon={icon} color={color} detail={kind === 'income' ? 'Income category' : 'Expense category'} />
    <Label text="Name" htmlFor="category-name"><input id="category-name" autoFocus={!category} value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'income' ? 'Salary' : 'Groceries'} className={inputClass} /></Label>
    <Label text="Type"><SegmentedControl options={KIND_OPTIONS} value={kind} onValueChange={setKind} /></Label>
    <Label text="Icon"><IconPicker value={icon} color={color} onChange={setIcon} /></Label>
    <Label text="Color"><ColorPicker value={color} onChange={setColor} /></Label>
    <PrimaryButton type="submit" label={category ? 'Save category' : 'Create category'} disabled={!valid} />
    {category && <Button variant="outline" size="lg" onClick={() => onArchive(category)} className="mt-3 w-full">
      {category.archivedAt ? 'Restore category' : 'Archive category'}
    </Button>}
  </form>
}

function alpha(color: string, opacity: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${opacity}` : color
}

/** A click opens the category's transactions. A right-click, or the pencil on hover, edits it. */
function CategoryNode({ category, amount, total, onOpen, onEdit }: {
  category: MoneyCategory
  amount: number
  total: number
  onOpen: () => void
  onEdit: () => void
}): React.ReactElement {
  const percent = total > 0 ? Math.round(amount / total * 100) : 0
  return <div className="group pointer-events-auto relative flex h-[126px] w-1/4 flex-col items-center px-1 pt-1.5">
    <button
      type="button"
      aria-label={`${category.name}, ${money(amount)}, ${percent} percent`}
      title="Click for transactions. Right-click to edit."
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault()
        onEdit()
      }}
      className="flex w-full flex-col items-center rounded-2xl pb-1 transition-colors hover:bg-surface-900"
    >
      <span className="line-clamp-2 flex h-10 items-center text-center text-[14px] font-semibold leading-[18px] text-surface-300">{category.name}</span>
      <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: amount > 0 ? category.color : alpha(category.color, '33') }}>
        <MoneyIcon name={category.icon} color={amount > 0 ? '#ffffff' : category.color} size={19} />
      </span>
      <Blurred><span className="mt-2 max-w-full truncate text-center text-[14px] font-bold text-surface-100 tabular">{money(amount)}</span></Blurred>
      <Blurred><span className="text-center text-[14px] text-surface-500 tabular">{percent}%</span></Blurred>
    </button>
    <button
      type="button"
      aria-label={`Edit ${category.name}`}
      title="Edit"
      onClick={onEdit}
      className="absolute right-1 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-surface-800 opacity-0 transition-opacity hover:bg-surface-700 focus-visible:opacity-100 group-hover:opacity-100"
    ><Pencil color="#d4d4d4" size={13} /></button>
  </div>
}

function CategoryRow({ categories, totals, total, onOpen, onEdit }: {
  categories: MoneyCategory[]
  totals: Map<string, number>
  total: number
  onOpen: (category: MoneyCategory) => void
  onEdit: (category: MoneyCategory) => void
}): React.ReactElement {
  return <div className="flex">
    {categories.map((category) => <CategoryNode key={category.id} category={category} amount={totals.get(category.id) ?? 0} total={total} onOpen={() => onOpen(category)} onEdit={() => onEdit(category)} />)}
    {Array.from({ length: Math.max(0, 4 - categories.length) }, (_, index) => <div key={`empty-${index}`} className="w-1/4" />)}
  </div>
}

function CategoryDonut({ mode, categories, totals, total, oppositeTotal, onToggle }: {
  mode: CategoryKind
  categories: MoneyCategory[]
  totals: Map<string, number>
  total: number
  oppositeTotal: number
  onToggle: () => void
}): React.ReactElement {
  const radius = 68
  const circumference = 2 * Math.PI * radius
  const active = categories.filter((category) => (totals.get(category.id) ?? 0) > 0)
  const gap = active.length > 1 ? 4 : 0
  let offset = 0
  const segments = active.map((category) => {
    const length = total > 0 ? (totals.get(category.id) ?? 0) / total * circumference : 0
    const visible = Math.max(0, length - gap)
    const segment = <circle
      key={category.id}
      cx="86"
      cy="86"
      r={radius}
      fill="none"
      stroke={category.color}
      strokeWidth="11"
      strokeDasharray={`${visible} ${circumference - visible}`}
      strokeDashoffset={-offset}
      strokeLinecap="round"
      transform="rotate(-90 86 86)"
    />
    offset += length
    return segment
  })
  const income = mode === 'income'
  const amount = money(total)
  return <button
    type="button"
    aria-label={`Showing ${mode}. Click to show ${income ? 'expenses' : 'income'}.`}
    onClick={onToggle}
    className="pointer-events-auto relative flex h-[172px] w-[172px] flex-col items-center justify-center rounded-full transition-colors hover:bg-surface-900/60"
  >
    <svg width={172} height={172} viewBox="0 0 172 172" className="absolute inset-0"><circle cx="86" cy="86" r={radius} fill="none" stroke="#262626" strokeWidth="11" />{segments}</svg>
    <span className="text-[14px] font-semibold capitalize text-surface-300">{mode}</span>
    <Blurred><span
      className={cn('mt-0.5 font-bold tabular', income ? 'text-positive' : 'text-surface-50')}
      style={{ fontSize: amount.length > 10 ? 18 : amount.length > 8 ? 21 : 24 }}
    >{amount}</span></Blurred>
    <span className="mt-1 max-w-[118px] text-center text-[14px] leading-[18px] text-surface-400">{income ? 'Expenses' : 'Income'} <BlurSpan>{money(oppositeTotal)}</BlurSpan></span>
  </button>
}

export default function Categories(): React.ReactElement {
  const state = useMoney()
  const navigate = useNavigate()
  const { range } = usePeriod()
  const periodData = useMoneyQuery((db) => localSnapshot(db, new Date().toISOString(), {
    accounts: false,
    budgets: false,
    purchases: false,
    transactionFrom: range.from,
    transactionTo: range.to
  }), [range.from, range.to])
  const [mode, setMode] = useState<CategoryKind>('expense')
  const [editing, setEditing] = useState<MoneyCategory | 'new' | null>(null)
  const [archived, setArchived] = useState(false)
  const [confirming, setConfirming] = useState<MoneyCategory | null>(null)
  return <Screen>
    <FinanceHeader />
    <MoneyScreen>{(baseSnapshot) => {
      if (!periodData) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      const snapshot = { ...baseSnapshot, transactions: periodData.transactions }
      const transactions = filteredTransactions(snapshot, range)
      const totals = new Map<string, number>()
      for (const item of transactions) {
        if (item.kind !== 'transfer' && item.categoryId) totals.set(item.categoryId, (totals.get(item.categoryId) ?? 0) + item.amountCents)
      }
      const totalFor = (kind: CategoryKind): number => transactions.filter((item) => item.kind === kind).reduce((sum, item) => sum + item.amountCents, 0)
      const total = totalFor(mode)
      const oppositeTotal = totalFor(mode === 'expense' ? 'income' : 'expense')
      const categories = snapshot.categories.filter((item) => item.kind === mode && Boolean(item.archivedAt) === archived)
      const top = categories.slice(0, 4)
      const sides = categories.slice(4, 8)
      const rest = categories.slice(8)
      const archive = (category: MoneyCategory): void => setConfirming(category)
      const openCategory = (category: MoneyCategory): void => {
        void navigate(`/money/transactions?categoryId=${encodeURIComponent(category.id)}`)
      }
      const confirmArchive = async (): Promise<void> => {
        if (!confirming) return
        const saved = await state.archiveCategory(confirming.id, !confirming.archivedAt)
        if (saved) setConfirming(null)
      }
      const restRows = Array.from({ length: Math.ceil(rest.length / 4) }, (_, index) => rest.slice(index * 4, index * 4 + 4))
      const side = (category: MoneyCategory | undefined, place: string): React.ReactNode => category && <div className={cn('pointer-events-none absolute z-10 flex w-full', place)}>
        <CategoryNode category={category} amount={totals.get(category.id) ?? 0} total={total} onOpen={() => openCategory(category)} onEdit={() => setEditing(category)} />
      </div>
      return <>
        <PeriodBar />
        <PeriodSwipe>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl px-6 pb-24">
              <div className="flex items-center justify-between pb-2 pt-1">
                <div>
                  <h2 className={cn('text-[20px] font-semibold', mode === 'expense' ? 'text-surface-100' : 'text-positive')}>{mode === 'expense' ? 'Expense categories' : 'Income categories'}</h2>
                  <p className="mt-0.5 text-[14px] text-surface-400">Click for transactions · Right-click to edit</p>
                </div>
                <button type="button" onClick={() => setArchived((value) => !value)} className="flex min-h-11 items-center rounded-full border border-surface-700 bg-surface-900 px-4 text-[14px] font-semibold text-surface-300 transition-colors hover:bg-surface-800">{archived ? 'Show active' : 'Archived'}</button>
              </div>
              <CategoryRow categories={top} totals={totals} total={total} onOpen={openCategory} onEdit={setEditing} />
              <div className="relative h-[264px]">
                {side(sides[0], 'left-0 top-2')}
                {side(sides[1], 'right-0 top-2 justify-end')}
                {side(sides[2], 'bottom-0 left-0')}
                {side(sides[3], 'bottom-0 right-0 justify-end')}
                <div className="pointer-events-none absolute left-0 right-0 top-[44px] z-20 flex justify-center">
                  <CategoryDonut mode={mode} categories={categories} totals={totals} total={total} oppositeTotal={oppositeTotal} onToggle={() => { setMode((value) => value === 'expense' ? 'income' : 'expense'); setArchived(false) }} />
                </div>
              </div>
              {restRows.map((row, index) => <CategoryRow key={index} categories={row} totals={totals} total={total} onOpen={openCategory} onEdit={setEditing} />)}
              {categories.length === 0 && <p className="px-8 pb-6 text-center text-[14px] leading-5 text-surface-400">No {archived ? 'archived' : 'active'} {mode} categories. Click + to create one.</p>}
            </div>
          </div>
        </PeriodSwipe>
        {!editing && !confirming && <button
          type="button"
          aria-label="Add category"
          disabled={state.readOnly}
          onClick={() => setEditing('new')}
          className="absolute bottom-5 right-6 flex min-h-12 items-center rounded-2xl bg-primary px-5 text-[16px] font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary/90"
        ><Plus color="#0a0a0a" size={19} className="mr-1.5" />Category</button>}
        <Sheet visible={Boolean(editing)} title={editing === 'new' ? `New ${mode} category` : 'Edit category'} onClose={() => setEditing(null)}>{editing && <CategoryForm key={editing === 'new' ? `new-${mode}` : editing.id} category={editing === 'new' ? undefined : editing} defaultKind={mode} onClose={() => setEditing(null)} onArchive={(category) => { setEditing(null); archive(category) }} />}</Sheet>
        <ConfirmDialog visible={Boolean(confirming)} title={confirming?.archivedAt ? 'Restore category?' : 'Archive category?'} detail="Past transactions will keep this category." confirmLabel={confirming?.archivedAt ? 'Restore' : 'Archive'} busy={state.busy} onCancel={() => setConfirming(null)} onConfirm={() => void confirmArchive()} />
      </>
    }}</MoneyScreen>
  </Screen>
}
