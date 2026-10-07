import React, { useEffect, useState } from 'react'
import type { AccountRecord, CategoryRecord } from '@ego/api-contracts'
import type { TransactionKind } from '@ego/core'
import { clearFilters, toggleIn, type ActivityView } from '@ego/local/activity-view'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { MoneyIcon } from './Common'

const KIND_LABELS: Record<TransactionKind, string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers'
}

const KINDS: TransactionKind[] = ['income', 'expense', 'transfer']

function Choice({ label, selected, onClick, icon, color }: {
  label: string
  selected: boolean
  onClick: () => void
  icon?: string
  color?: string
}): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    onClick={onClick}
    className={cn('flex min-h-11 items-center rounded-full border px-4 text-[15px] transition-colors',
      selected ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-input bg-surface-900 text-surface-200 hover:bg-surface-800')}
  >
    {icon && <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#737373' }}>
      <MoneyIcon name={icon} size={13} />
    </span>}
    {label}
  </button>
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return <div className="mb-6">
    <h3 className="mb-2.5 text-[15px] font-medium text-surface-200">{title}</h3>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
}

export default function FilterSheet({ visible, view, accounts, categories, onApply, onClose }: {
  visible: boolean
  view: ActivityView
  accounts: AccountRecord[]
  categories: CategoryRecord[]
  onApply: (next: ActivityView) => void
  onClose: () => void
}): React.ReactElement {
  const [draft, setDraft] = useState<ActivityView>(view)

  useEffect(() => {
    if (visible) setDraft(view)
  }, [view, visible])

  const usable = (record: { archivedAt: string | null; id: string }, chosen: string[]): boolean =>
    !record.archivedAt || chosen.includes(record.id)

  return <Sheet
    visible={visible}
    title="Filters"
    onClose={onClose}
    wide
    footer={<div className="flex gap-3">
      <Button variant="outline" size="lg" onClick={() => setDraft(clearFilters(draft))} className="flex-1">Clear filters</Button>
      <Button size="lg" onClick={() => onApply(draft)} className="flex-1">Show results</Button>
    </div>}
  >
    <Group title="Type">
      {KINDS.map((kind) => <Choice
        key={kind}
        label={KIND_LABELS[kind]}
        selected={draft.kinds.includes(kind)}
        onClick={() => setDraft({ ...draft, kinds: toggleIn(draft.kinds, kind) })}
      />)}
    </Group>

    <Group title="Account">
      {accounts.filter((account) => usable(account, draft.accountIds)).map((account) => <Choice
        key={account.id}
        label={account.name}
        icon={account.icon}
        color={account.color}
        selected={draft.accountIds.includes(account.id)}
        onClick={() => setDraft({ ...draft, accountIds: toggleIn(draft.accountIds, account.id) })}
      />)}
    </Group>

    <Group title="Category">
      {categories.filter((category) => usable(category, draft.categoryIds)).map((category) => <Choice
        key={category.id}
        label={category.name}
        icon={category.icon}
        color={category.color}
        selected={draft.categoryIds.includes(category.id)}
        onClick={() => setDraft({ ...draft, categoryIds: toggleIn(draft.categoryIds, category.id) })}
      />)}
    </Group>
  </Sheet>
}
