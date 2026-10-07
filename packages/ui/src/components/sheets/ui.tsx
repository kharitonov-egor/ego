import React from 'react'
import { useNavigate } from 'react-router'
import {
  AlignLeft, Calendar, CaseSensitive, Hash, Link, Mail, Phone, Sheet, SquareCheck, SquareChevronDown, Tags, TriangleAlert,
  X, type LucideIcon
} from 'lucide-react'
import type { SheetColumnType, SheetOption, SheetShade } from '@ego/core'
import { useLedger } from '../../lib/ledger'
import { useSheets } from '../../lib/sheets/context'
import { cn } from '../../lib/utils'
import { Screen } from '../screen'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'

/** The only color in Sheets: a value that does not fit its column. */
export const UNFIT = '#f87171'

export const SHADES: Record<SheetShade, { background: string; text: string; border: string }> = {
  0: { background: '#f5f5f5', text: '#0a0a0a', border: '#f5f5f5' },
  1: { background: '#bdbdbd', text: '#0a0a0a', border: '#bdbdbd' },
  2: { background: '#737373', text: '#ffffff', border: '#737373' },
  3: { background: '#404040', text: '#f5f5f5', border: '#404040' },
  4: { background: '#141414', text: '#e5e5e5', border: '#525252' }
}

export const COLUMN_TYPE_ICONS: Record<SheetColumnType, LucideIcon> = {
  text: CaseSensitive,
  longText: AlignLeft,
  number: Hash,
  date: Calendar,
  checkbox: SquareCheck,
  dropdown: SquareChevronDown,
  tags: Tags,
  phone: Phone,
  email: Mail,
  link: Link
}

export function OptionPill({ option, large = false }: { option: SheetOption; large?: boolean }): React.ReactElement {
  const shade = SHADES[option.shade]
  return <span
    style={{ backgroundColor: shade.background, borderColor: shade.border, color: shade.text }}
    className={cn('inline-block max-w-full truncate rounded-full border font-semibold', large ? 'px-3 py-1 text-[15px]' : 'px-2 py-px text-[13px]')}
  >{option.name}</span>
}

export function SheetIcon({ icon, size = 40 }: { icon: string; size?: number }): React.ReactElement {
  return <span className="flex shrink-0 items-center justify-center rounded-xl border border-surface-800 bg-surface-900" style={{ width: size, height: size }}>
    {icon
      ? <span style={{ fontSize: Math.round(size * 0.5), color: '#fafafa', lineHeight: 1 }}>{icon}</span>
      : <Sheet color="#a3a3a3" size={Math.round(size * 0.5)} />}
  </span>
}

export function SheetsMessage({ Icon = Sheet, title, detail, action, onAction }: {
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

/**
 * Stands in for a Sheets screen until the computer has read its sheets. `header` tops the page
 * while it waits; the screen inside draws its own.
 */
export function SheetsGate({ header, children }: { header: React.ReactNode; children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const sheets = useSheets()
  const navigate = useNavigate()
  if (sheets.data && ledger.current && ledger.enabled && !ledger.error) return <>{children}</>
  const stopped = !ledger.syncing && Boolean(ledger.status)
  const state = !ledger.enabled
    ? <SheetsMessage
      title="Sign in to use Sheets"
      detail="Sign in once with Google on Home. Sheets then save on this computer and sync to D1."
      action="Go to sign in"
      onAction={() => navigate('/')}
    />
    : ledger.error
      ? <SheetsMessage Icon={TriangleAlert} title="This computer cannot open its database" detail={ledger.error} />
      : stopped && ledger.status?.state === 'paused'
        ? <SheetsMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
        : stopped && !ledger.current
          ? <SheetsMessage
            title="Waiting for a connection"
            detail="Sheets needs one download first. After that it works offline."
            action="Try again"
            onAction={() => void ledger.sync()}
          />
          : <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-950"><Spinner /></div>
  return <Screen>{header}{state}</Screen>
}

export function SheetsError(): React.ReactElement | null {
  const { error, dismissError } = useSheets()
  if (!error) return null
  return <button
    type="button"
    title="Dismiss"
    onClick={dismissError}
    className="mx-5 my-2 flex shrink-0 items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-left hover:bg-red-500/15"
  >
    <span className="flex-1 text-[14px] leading-5 text-red-300">{error}</span>
    <X color="#fca5a5" size={16} />
  </button>
}

export function FieldLabel({ type, name, htmlFor }: { type: SheetColumnType; name: string; htmlFor?: string }): React.ReactElement {
  const Icon = COLUMN_TYPE_ICONS[type]
  return <label htmlFor={htmlFor} className="mb-2 flex items-center">
    <Icon color="#737373" size={14} />
    <span className="ml-1.5 flex-1 truncate text-[13px] font-semibold uppercase tracking-wide text-surface-500">{name}</span>
  </label>
}
