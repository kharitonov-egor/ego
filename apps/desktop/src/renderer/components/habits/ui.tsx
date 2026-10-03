import React, { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { Ban, CalendarDays, House, ListChecks, Plus, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import type { HabitKind } from '@ego/core'
import { useHabits } from '../../lib/habits/context'
import { useLedger } from '../../lib/ledger'
import { BlurBlob, useBlur } from '../../lib/blur'
import { ScreenHeader, TabLinks } from '../screen'
import { Button, IconButton } from '../ui/button'
import { Spinner } from '../ui/spinner'

const TABS = [
  { to: '/habits/home', label: 'Home', Icon: House },
  { to: '/habits/progress', label: 'Progress', Icon: CalendarDays },
  { to: '/habits/quit', label: 'Quit', Icon: Ban }
] as const

export function HabitIcon({ icon, size = 44 }: { icon: string; size?: number }): React.ReactElement {
  const { blurred } = useBlur()
  return <div
    className="flex shrink-0 items-center justify-center rounded-2xl border border-surface-800 bg-surface-900"
    style={{ width: size, height: size }}
  >
    {blurred
      ? <BlurBlob size={Math.round(size * 0.5)} />
      : <span aria-hidden className="leading-none" style={{ fontSize: Math.round(size * 0.5), color: '#fafafa' }}>{icon}</span>}
  </div>
}

export function HabitsMessage({ Icon = ListChecks, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-950 px-8 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold text-surface-100">{title}</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{detail}</p>
    {action && onAction && <Button onClick={onAction} className="mt-5">{action}</Button>}
  </div>
}

/** Stands in for a Habits screen until this computer has read its list. */
export function HabitsGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const habits = useHabits()
  const navigate = useNavigate()
  if (!ledger.enabled) {
    return <HabitsMessage
      title="Sign in to track habits"
      detail="Sign in once with Google on the start screen. Habits then save on this computer and sync to D1."
      action="Go to sign in"
      onAction={() => navigate('/')}
    />
  }
  if (ledger.error) return <HabitsMessage Icon={TriangleAlert} title="This computer cannot open its database" detail={ledger.error} />
  if (habits.habits) return <>{children}</>
  const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
  if (stopped && ledger.status?.state === 'paused') {
    return <HabitsMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
  }
  if (stopped) {
    return <HabitsMessage
      title="Waiting for a connection"
      detail="The first download needs the internet. After that, Habits works offline."
      action="Try again"
      onAction={() => void ledger.sync()}
    />
  }
  return <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-950"><Spinner /></div>
}

export function HabitsError(): React.ReactElement | null {
  const { error, dismissError } = useHabits()
  if (!error) return null
  return <button
    type="button"
    title="Dismiss"
    onClick={dismissError}
    className="mb-3 flex w-full items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-left hover:bg-red-500/15"
  >
    <span className="flex-1 text-[14px] leading-5 text-red-300">{error}</span>
    <X color="#fca5a5" size={16} />
  </button>
}

/**
 * The tabs, plus an add button when a list is showing. Sync and the conflict review live in the
 * sidebar on this computer.
 */
export function HabitsHeader({ add }: { add?: HabitKind }): React.ReactElement {
  const ledger = useLedger()
  const habits = useHabits()
  return <ScreenHeader
    title="Habits"
    tabs={<TabLinks items={TABS} />}
    right={add && ledger.enabled && habits.habits && <IconButton
      label={add === 'build' ? 'Add a habit' : 'Add a habit to break'}
      onClick={() => habits.openEditor({ kind: add, habit: null })}
      className="h-10 w-10 text-foreground"
    ><Plus size={24} /></IconButton>}
  />
}

export function StatTile({ Icon, label, value, detail }: {
  Icon?: LucideIcon
  label: string
  value: string
  detail?: string
}): React.ReactElement {
  return <div className="flex-1 rounded-2xl bg-surface-900 px-4 py-3.5">
    <div className="flex items-center gap-1.5">
      {Icon && <Icon color="#a3a3a3" size={15} />}
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
    </div>
    <p className="tabular mt-1 text-[22px] font-bold tracking-tight text-foreground">{value}</p>
    {detail && <p className="text-[13px] text-surface-400">{detail}</p>}
  </div>
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * Left and right arrow keys step what the phone swipes through, unless a field has the focus or
 * a dialog is open.
 */
export function useStepKeys(step: (delta: -1 | 1) => void, canStep: (delta: -1 | 1) => boolean): void {
  const live = useRef({ step, canStep })
  live.current = { step, canStep }
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || document.querySelector('[aria-modal="true"]')) return
      const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      if (delta === 0 || !live.current.canStep(delta)) return
      event.preventDefault()
      live.current.step(delta)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
