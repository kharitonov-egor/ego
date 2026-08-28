import React, { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Trash2, TriangleAlert } from 'lucide-react'
import { monthOf, summarizeBudget } from '@ego/core'
import type { BudgetInput, CategoryBudgetStatus, MoneySnapshot } from '../../../shared/types'
import { formatMoney, MoneyIcon, todayString } from '../../money/utils'
import type { MoneyActions } from './MoneyWorkspace'
import { buttonClass, inputClass, PageHeader, panelClass, subtleButtonClass } from './Common'

const BAR_COLORS: Record<CategoryBudgetStatus['state'], string> = {
  over: '#e84d8a', close: '#ff9f43', under: '#2bb3a9', unplanned: '#2d3a5c'
}

function shiftMonth(month: string, delta: number): string {
  const [year, index] = month.split('-').map(Number)
  const date = new Date(year, index - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number)
  return new Date(year, index - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function dollars(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2)
}

function cents(value: string): number {
  return Math.max(0, Math.round((Number(value) || 0) * 100))
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: string; tone?: 'plain' | 'bad' }): React.ReactElement {
  return <div className={`${panelClass} p-4`}>
    <div className="text-xs text-surface-400">{label}</div>
    <div className={`mt-1 text-xl ${tone === 'bad' ? 'text-rose-400' : 'text-surface-50'}`}>{value}</div>
  </div>
}

export default function BudgetView({ snapshot, actions }: { snapshot: MoneySnapshot; actions: MoneyActions }): React.ReactElement {
  const [month, setMonth] = useState(() => monthOf(todayString()))
  const summary = useMemo(() => summarizeBudget(snapshot, month), [snapshot, month])
  const [draft, setDraft] = useState<{ month: string; income: string; allocations: Record<string, string> } | null>(null)

  const edited = draft?.month === month ? draft : null
  const income = edited ? edited.income : dollars(summary.plannedIncomeCents)
  const allocationOf = (status: CategoryBudgetStatus): string =>
    edited?.allocations[status.categoryId] ?? dollars(status.allocatedCents)
  const change = (patch: { income?: string; categoryId?: string; value?: string }): void => {
    const base = edited ?? {
      month,
      income: dollars(summary.plannedIncomeCents),
      allocations: Object.fromEntries(summary.categories.map((item) => [item.categoryId, dollars(item.allocatedCents)]))
    }
    setDraft(patch.categoryId
      ? { ...base, allocations: { ...base.allocations, [patch.categoryId]: patch.value ?? '' } }
      : { ...base, income: patch.income ?? '' })
  }

  const save = async (): Promise<void> => {
    if (!edited) return
    const input: BudgetInput = {
      month,
      plannedIncomeCents: cents(edited.income),
      allocations: Object.entries(edited.allocations)
        .map(([categoryId, value]) => ({ categoryId, amountCents: cents(value) }))
        .filter((item) => item.amountCents > 0)
    }
    if (await actions.saveBudget(input)) setDraft(null)
  }

  const clear = async (): Promise<void> => {
    if (!window.confirm(`Clear the ${monthLabel(month)} budget? Transactions stay.`)) return
    if (await actions.deleteBudget(month)) setDraft(null)
  }

  const planned = snapshot.budgets.some((item) => item.month === month)

  return <div className="flex h-full flex-col">
    <PageHeader
      title="Budget"
      subtitle={`${formatMoney(summary.spentCents)} spent of ${formatMoney(summary.allocatedCents)} planned`}
      action={<div className="flex items-center gap-2">
        <button className={subtleButtonClass} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button>
        <span className="min-w-36 text-center text-sm text-surface-200">{monthLabel(month)}</span>
        <button className={subtleButtonClass} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button>
      </div>}
    />
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      {summary.overspent.length > 0 && <div className="mb-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-rose-300"><TriangleAlert size={16} />Over budget</div>
        {summary.overspent.map((item) => <p key={item.categoryId} className="mt-1.5 text-xs text-rose-200">
          {item.name} is {formatMoney(item.spentCents - item.allocatedCents)} past its {formatMoney(item.allocatedCents)} budget
        </p>)}
      </div>}

      <div className="grid grid-cols-4 gap-3">
        <div className={`${panelClass} p-4`}>
          <label className="text-xs text-surface-400">Planned income</label>
          <input
            type="number" min="0" step="0.01" placeholder="0.00" className={`${inputClass} mt-1.5`}
            value={income} onChange={(event) => change({ income: event.target.value })}
          />
          <div className="mt-1.5 text-xs text-surface-500">{formatMoney(summary.actualIncomeCents)} received</div>
        </div>
        <Stat label="Allocated" value={formatMoney(summary.allocatedCents)} />
        <Stat label="Left to allocate" value={formatMoney(summary.unallocatedCents)} tone={summary.unallocatedCents < 0 ? 'bad' : 'plain'} />
        <Stat label="Spent" value={formatMoney(summary.spentCents)} tone={summary.overspent.length > 0 ? 'bad' : 'plain'} />
      </div>

      {summary.unplannedSpentCents > 0 && <p className="mt-3 text-xs text-amber-400">
        {formatMoney(summary.unplannedSpentCents)} spent in categories with no budget this month.
      </p>}

      <div className={`${panelClass} mt-4 divide-y divide-surface-800 overflow-hidden`}>
        {summary.categories.length === 0
          ? <p className="p-6 text-center text-sm text-surface-400">Create an expense category first.</p>
          : summary.categories.map((status) => <div key={status.categoryId} className="flex items-center gap-4 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white" style={{ backgroundColor: status.color }}>
              <MoneyIcon name={status.icon} size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm text-surface-100">{status.name}</span>
                <span className={`shrink-0 text-xs ${status.state === 'over' ? 'text-rose-400' : status.state === 'close' ? 'text-amber-400' : 'text-surface-400'}`}>
                  {status.allocatedCents === 0
                    ? status.spentCents > 0 ? `${formatMoney(status.spentCents)} unplanned` : 'No budget'
                    : status.state === 'over'
                      ? `${formatMoney(-status.remainingCents)} over`
                      : `${formatMoney(status.remainingCents)} left`}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-800">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round(status.usedRatio * 100))}%`, backgroundColor: BAR_COLORS[status.state] }} />
              </div>
            </div>
            <div className="w-28 shrink-0">
              <input
                type="number" min="0" step="0.01" placeholder="0.00" className={inputClass}
                value={allocationOf(status)}
                onChange={(event) => change({ categoryId: status.categoryId, value: event.target.value })}
              />
            </div>
            <div className="w-24 shrink-0 text-right text-sm text-surface-300">{formatMoney(status.spentCents)}</div>
          </div>)}
      </div>

      <div className="mt-4 flex items-center justify-between">
        {planned
          ? <button className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-sm text-rose-400 disabled:opacity-40" disabled={actions.readOnly} onClick={() => void clear()}><Trash2 size={14} />Clear month</button>
          : <span />}
        <div className="flex items-center gap-2">
          {edited && <button className={subtleButtonClass} onClick={() => setDraft(null)}>Discard</button>}
          <button className={buttonClass} disabled={!edited || actions.busy || actions.readOnly} onClick={() => void save()}>Save budget</button>
        </div>
      </div>
    </div>
  </div>
}
