import React, { useMemo, useState } from 'react'
import type { DateRange, MoneySnapshot, PeriodPreset } from '../../../shared/types'
import { filterTransactions, formatMoney, MoneyIcon, rangeForPreset, todayString, totalBalanceAt } from '../../money/utils'
import { PageHeader, panelClass, PeriodControl } from './Common'

export default function OverviewView({ snapshot }: { snapshot: MoneySnapshot }): React.ReactElement {
  const [preset, setPreset] = useState<PeriodPreset>('all')
  const [custom, setCustom] = useState<DateRange>({ from: todayString(), to: todayString() })
  const transactions = useMemo(() => filterTransactions(snapshot.transactions, preset, custom), [snapshot.transactions, preset, custom])
  const range = rangeForPreset(preset, custom)
  const income = transactions.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amountCents, 0)
  const expenses = transactions.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
  const closing = range.to ? totalBalanceAt(snapshot, range.to) : totalBalanceAt(snapshot, null)
  const net = income - expenses
  const opening = closing - net
  const firstDate = range.from ?? [...snapshot.transactions.map((item) => item.date), ...snapshot.accounts.map((item) => item.openingDate)].sort()[0] ?? todayString()
  const lastDate = range.to ?? todayString()
  const days = Math.max(1, Math.floor((new Date(`${lastDate}T00:00:00`).getTime() - new Date(`${firstDate}T00:00:00`).getTime()) / 86400000) + 1)
  const categoryTotals = new Map<string, number>()
  transactions.filter((item) => item.kind === 'expense' && item.categoryId).forEach((item) => categoryTotals.set(item.categoryId!, (categoryTotals.get(item.categoryId!) ?? 0) + item.amountCents))
  const ranked = snapshot.categories.map((category) => ({ category, amount: categoryTotals.get(category.id) ?? 0 })).filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount)
  const months = new Map<string, { income: number; expenses: number }>()
  transactions.filter((item) => item.kind !== 'transfer').forEach((item) => {
    const key = item.date.slice(0, 7)
    const current = months.get(key) ?? { income: 0, expenses: 0 }
    current[item.kind === 'income' ? 'income' : 'expenses'] += item.amountCents
    months.set(key, current)
  })
  const monthEntries = Array.from(months.entries()).sort().slice(-12)
  const maxMonth = Math.max(1, ...monthEntries.flatMap(([, value]) => [value.income, value.expenses]))
  return <div className="flex h-full flex-col"><PageHeader title="Overview" subtitle="Balance, cash flow, and spending" action={<PeriodControl preset={preset} custom={custom} onPreset={setPreset} onCustom={setCustom} />} />
    <div className="flex-1 overflow-y-auto p-6"><div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat label="Opening balance" value={formatMoney(opening)} /><Stat label="Closing balance" value={formatMoney(closing)} accent={closing < 0 ? 'rose' : 'green'} /><Stat label="Net change" value={formatMoney(net, true)} accent={net < 0 ? 'rose' : 'green'} /><Stat label="Transactions" value={String(transactions.length)} /></div>
      <div className="mt-4 grid grid-cols-2 gap-3"><div className={`${panelClass} border-rose-500/20 p-5`}><div className="text-xs text-surface-500">Expenses</div><div className="mt-1 text-2xl text-rose-400">{formatMoney(expenses)}</div></div><div className={`${panelClass} border-emerald-500/20 p-5`}><div className="text-xs text-surface-500">Income</div><div className="mt-1 text-2xl text-emerald-400">{formatMoney(income)}</div></div></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]"><section className={`${panelClass} p-5`}><h2 className="text-sm font-medium">Monthly cash flow</h2>{monthEntries.length === 0 ? <div className="flex h-48 items-center justify-center text-sm text-surface-500">Charts will appear after you record a transaction.</div> : <div className="mt-5 flex h-48 items-end gap-3 border-b border-surface-700 px-2">{monthEntries.map(([month, values]) => <div key={month} className="flex h-full min-w-8 flex-1 flex-col justify-end"><div className="flex flex-1 items-end justify-center gap-1"><div title={`Income ${formatMoney(values.income)}`} className="w-2/5 rounded-t bg-emerald-500" style={{ height: `${Math.max(values.income ? 3 : 0, values.income / maxMonth * 100)}%` }} /><div title={`Expenses ${formatMoney(values.expenses)}`} className="w-2/5 rounded-t bg-rose-500" style={{ height: `${Math.max(values.expenses ? 3 : 0, values.expenses / maxMonth * 100)}%` }} /></div><div className="py-2 text-center text-[10px] text-surface-500">{new Date(`${month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</div></div>)}</div>}</section>
        <section className={`${panelClass} p-5`}><h2 className="text-sm font-medium">Expense averages</h2><div className="mt-5 grid grid-cols-3 gap-2 text-center"><MiniStat label="Day" value={expenses / days} /><MiniStat label="Week" value={expenses / days * 7} /><MiniStat label="Month" value={expenses / days * 30.44} /></div><h2 className="mb-3 mt-6 text-sm font-medium">Top categories</h2>{ranked.length === 0 ? <p className="text-sm text-surface-500">No expenses in this period.</p> : <div className="space-y-3">{ranked.slice(0, 5).map(({ category, amount }) => <div key={category.id}><div className="mb-1.5 flex items-center gap-2 text-xs"><span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ backgroundColor: category.color }}><MoneyIcon name={category.icon} size={12} /></span><span className="flex-1 text-surface-300">{category.name}</span><span>{formatMoney(amount)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-surface-800"><div className="h-full rounded-full" style={{ width: `${expenses ? amount / expenses * 100 : 0}%`, backgroundColor: category.color }} /></div></div>)}</div>}</section></div>
    </div></div>
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'rose' | 'green' }): React.ReactElement {
  return <div className={`${panelClass} p-4`}><div className="text-xs text-surface-500">{label}</div><div className={`mt-1 text-lg ${accent === 'rose' ? 'text-rose-400' : accent === 'green' ? 'text-emerald-400' : 'text-surface-100'}`}>{value}</div></div>
}

function MiniStat({ label, value }: { label: string; value: number }): React.ReactElement {
  return <div className="rounded-lg bg-surface-950 p-3"><div className="text-[10px] uppercase text-surface-500">{label}</div><div className="mt-1 text-xs text-rose-400">{formatMoney(Math.round(value))}</div></div>
}
