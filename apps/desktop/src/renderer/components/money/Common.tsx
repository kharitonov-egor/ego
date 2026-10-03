import React from 'react'
import { useNavigate } from 'react-router'
import { CircleDollarSign, TriangleAlert, X } from 'lucide-react'
import type { DateRange, MoneySnapshot, MoneyTransaction } from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { useLedger } from '../../lib/ledger'
import { useMoney } from '../../lib/money'
import { transactionsInRange } from '../../lib/period'
import { cn } from '../../lib/utils'
import { ICON_OPTIONS, MoneyIcon } from '../common'
import { CenteredMessage } from '../screen'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'

export { COLORS, Chips, ColorPicker, Empty, ICON_OPTIONS, Label, MoneyIcon, money, sentenceCase } from '../common'

export function today(): string {
  return isoToday()
}

export function filteredTransactions(snapshot: MoneySnapshot, range: DateRange): MoneyTransaction[] {
  return transactionsInRange(snapshot, range)
}

export function SignInPrompt(): React.ReactElement {
  const navigate = useNavigate()
  return <CenteredMessage
    Icon={CircleDollarSign}
    title="Sign in to see your money"
    detail="Sign in once with Google on the start screen. The ledger downloads to this computer and keeps working offline."
    action="Go to sign in"
    onAction={() => navigate('/')}
  />
}

/** Holds a money screen back until the ledger can answer, and shows its error and budget banners. */
export function MoneyScreen({ children }: { children: (snapshot: MoneySnapshot) => React.ReactNode }): React.ReactElement {
  const { snapshot, error, dismissError, alert, dismissAlert } = useMoney()
  const ledger = useLedger()
  const navigate = useNavigate()
  const state = ((): React.ReactElement | null => {
    if (!ledger.enabled) return <SignInPrompt />
    if (ledger.error) return <CenteredMessage Icon={CircleDollarSign} title="This computer cannot open its ledger" detail={ledger.error} />
    if (snapshot) return null
    const stopped = !ledger.ready && Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <CenteredMessage Icon={CircleDollarSign} title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
    }
    if (stopped && ledger.status?.state === 'offline') {
      return <CenteredMessage
        Icon={CircleDollarSign}
        title="Waiting for a connection"
        detail="The first download needs the internet. After that, this screen works offline."
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    if (stopped || (ledger.ready && error)) {
      return <CenteredMessage
        Icon={CircleDollarSign}
        title={stopped ? 'The download did not finish' : 'This computer could not read its ledger'}
        detail={error ?? ledger.status?.message ?? 'Try again in a moment.'}
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    return <div className="flex h-full flex-col items-center justify-center">
      <Spinner />
      {!ledger.ready && <p className="mt-3 text-[14px] text-surface-400">Downloading your ledger</p>}
    </div>
  })()
  if (state || !snapshot) return <div className="min-h-0 flex-1">{state}</div>
  return <div className="relative flex min-h-0 flex-1 flex-col">
    {error && <button type="button" title="Dismisses this message" onClick={dismissError} className="flex min-h-11 w-full items-center gap-2 bg-red-500/10 px-5 py-2 text-left hover:bg-red-500/15">
      <span className="flex-1 text-[14px] leading-5 text-red-300">{error}</span>
      <X color="#fca5a5" size={16} />
    </button>}
    {alert && <button type="button" title="Dismisses this message" onClick={dismissAlert} className="flex min-h-11 w-full items-start gap-2 border-b border-rose-500/30 bg-rose-500/15 px-5 py-2.5 text-left hover:bg-rose-500/20">
      <TriangleAlert color="#fb7185" size={15} className="mt-0.5 shrink-0" />
      <span className="flex-1 whitespace-pre-line text-[14px] leading-5 text-rose-200">{alert}</span>
      <X color="#fb7185" size={17} className="shrink-0" />
    </button>}
    {children(snapshot)}
  </div>
}

/** A single choice among accounts or categories, with the record's own icon and color beside its name. */
export function ChoicePill({ label, icon, color, selected, onClick }: {
  label: string
  icon?: string
  color?: string
  selected: boolean
  onClick: () => void
}): React.ReactElement {
  return <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={cn('flex min-h-11 items-center rounded-full border px-4 text-[15px] transition-colors',
      selected ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-input bg-surface-900 text-surface-200 hover:bg-surface-800')}
  >
    {icon && <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: color ?? '#404040' }}><MoneyIcon name={icon} size={13} /></span>}
    {label}
  </button>
}

/** The selected tile takes the chosen color, so icon and color read as one choice. */
export function IconPicker({ icons = ICON_OPTIONS, value, color, onChange }: {
  icons?: readonly string[]
  value: string
  color: string
  onChange: (icon: string) => void
}): React.ReactElement {
  return <div className="flex flex-wrap gap-2.5">{icons.map((item) => {
    const selected = value === item
    return <button
      key={item}
      type="button"
      aria-label={`Use ${item} icon`}
      aria-pressed={selected}
      onClick={() => onChange(item)}
      className={cn('flex h-12 w-12 items-center justify-center rounded-2xl transition-colors', selected ? '' : 'border border-input bg-surface-900 hover:bg-surface-800')}
      style={selected ? { backgroundColor: color } : undefined}
    ><MoneyIcon name={item} color={selected ? '#ffffff' : '#d4d4d4'} size={21} /></button>
  })}</div>
}

/** What the account or category will look like in lists, drawn while the form is filled in. */
export function EntityPreview({ name, placeholder, icon, color, detail, shape }: {
  name: string
  placeholder: string
  icon: string
  color: string
  detail: string
  shape: 'circle' | 'square'
}): React.ReactElement {
  return <div className="mb-6 flex flex-col items-center">
    <div className={cn('flex h-20 w-20 items-center justify-center', shape === 'circle' ? 'rounded-full' : 'rounded-3xl')} style={{ backgroundColor: color }}>
      <MoneyIcon name={icon} size={34} />
    </div>
    <p className={cn('mt-3 max-w-full truncate text-[20px] font-bold', name.trim() ? 'text-foreground' : 'text-surface-500')}>{name.trim() || placeholder}</p>
    <p className="mt-0.5 text-[15px] text-muted-foreground">{detail}</p>
  </div>
}

export function PrimaryButton({ label, onClick, disabled = false, type = 'button' }: {
  label: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}): React.ReactElement {
  return <Button type={type} size="lg" disabled={disabled} onClick={onClick} className="w-full">{label}</Button>
}
