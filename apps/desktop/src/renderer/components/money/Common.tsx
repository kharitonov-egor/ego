import React from 'react'
import { Archive, Plus, RefreshCw, WifiOff, X } from 'lucide-react'
import type { DateRange, PeriodPreset } from '../../../shared/types'
import { todayString } from '../../money/utils'

export const panelClass = 'rounded-2xl border border-surface-800 bg-surface-900/60'
export const inputClass = 'w-full rounded-lg border border-surface-700 bg-surface-950 px-3 py-2 text-sm text-surface-100 outline-none focus:border-accent-500'
export const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:cursor-not-allowed disabled:opacity-40'
export const subtleButtonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 disabled:opacity-40'

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }): React.ReactElement {
  return <header className="flex items-center justify-between gap-4 border-b border-surface-800 px-6 py-4">
    <div><h1 className="text-xl font-semibold text-surface-50">{title}</h1><p className="mt-0.5 text-xs text-surface-400">{subtitle}</p></div>
    {action}
  </header>
}

export function EmptyState({ title, detail, actionLabel, onAction, archived = false }: {
  title: string; detail: string; actionLabel: string; onAction: () => void; archived?: boolean
}): React.ReactElement {
  const Icon = archived ? Archive : Plus
  return <div className={`${panelClass} flex min-h-64 flex-col items-center justify-center p-8 text-center`}>
    <div className="mb-3 rounded-full bg-surface-800 p-3 text-surface-300"><Icon size={22} /></div>
    <h2 className="text-base font-medium text-surface-100">{title}</h2>
    <p className="mt-1 max-w-sm text-sm text-surface-400">{detail}</p>
    <button className={`${buttonClass} mt-5`} onClick={onAction}><Plus size={15} />{actionLabel}</button>
  </div>
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }): React.ReactElement {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onMouseDown={onClose}>
    <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="sticky top-0 flex items-center justify-between border-b border-surface-800 bg-surface-900 px-5 py-4">
        <h2 className="font-semibold text-surface-50">{title}</h2>
        <button className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-white" onClick={onClose}><X size={17} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
}

const PERIODS: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' }, { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' }, { value: 'custom', label: 'Custom' }
]

export function PeriodControl({ preset, custom, onPreset, onCustom }: {
  preset: PeriodPreset; custom: DateRange; onPreset: (value: PeriodPreset) => void; onCustom: (value: DateRange) => void
}): React.ReactElement {
  return <div className="flex flex-wrap items-center gap-1 rounded-xl border border-surface-800 bg-surface-900 p-1">
    {PERIODS.map((period) => <button key={period.value} onClick={() => onPreset(period.value)} className={`rounded-lg px-2.5 py-1.5 text-xs ${preset === period.value ? 'bg-surface-700 text-white' : 'text-surface-400 hover:text-white'}`}>{period.label}</button>)}
    {preset === 'custom' && <div className="flex items-center gap-1 border-l border-surface-700 pl-2">
      <input type="date" className="bg-transparent text-xs text-surface-300 outline-none" value={custom.from ?? ''} max={custom.to ?? todayString()} onChange={(event) => onCustom({ ...custom, from: event.target.value || null })} />
      <span className="text-surface-600">to</span>
      <input type="date" className="bg-transparent text-xs text-surface-300 outline-none" value={custom.to ?? ''} min={custom.from ?? undefined} max={todayString()} onChange={(event) => onCustom({ ...custom, to: event.target.value || null })} />
    </div>}
  </div>
}

export function OfflineBanner({ message, onRetry, busy }: { message: string; onRetry: () => void; busy: boolean }): React.ReactElement {
  return <div className="flex items-center gap-3 border-b border-amber-500/20 bg-amber-500/10 px-6 py-2 text-xs text-amber-200">
    <WifiOff size={14} /><span className="flex-1">{message}. Cached data is read-only.</span>
    <button className="flex items-center gap-1 hover:text-white" onClick={onRetry} disabled={busy}><RefreshCw size={12} className={busy ? 'animate-spin' : ''} />Retry</button>
  </div>
}
