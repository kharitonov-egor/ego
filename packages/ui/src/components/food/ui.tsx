import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { Barcode, NotebookPen, Refrigerator, TriangleAlert, UtensilsCrossed, X, type LucideIcon } from 'lucide-react'
import {
  formatCalories, formatGrams,
  type FoodEntryInput, type FoodGoalInput, type FoodMacros, type FoodPhoto
} from '@ego/core'
import { mediaUrl } from '../../lib/platform'
import { useBlur } from '../../lib/blur'
import { useFood } from '../../lib/food/context'
import { useLedger } from '../../lib/ledger'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { ScreenHeader, TabLinks } from '../screen'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'

export function macroText(macros: Pick<FoodMacros, 'protein' | 'carbs' | 'fat'>): string {
  return `P ${formatGrams(macros.protein)} · C ${formatGrams(macros.carbs)} · F ${formatGrams(macros.fat)}`
}

/**
 * The phone's Log and Fridge tabs. The entry editor opens beside the log, so the Log tab stays lit
 * while it is open.
 */
export function FoodHeader({ editing = false, right }: { editing?: boolean; right?: React.ReactNode }): React.ReactElement {
  return <ScreenHeader
    title="Food"
    tabs={<TabLinks items={[
      { to: '/food', label: 'Log', Icon: NotebookPen, end: !editing },
      { to: '/food/fridge', label: 'Fridge', Icon: Refrigerator }
    ]} />}
    right={right}
  />
}

export function FoodMessage({ Icon = UtensilsCrossed, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-950 px-8 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color={color.textMuted} size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold text-surface-100">{title}</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{detail}</p>
    {action && onAction && <Button onClick={onAction} className="mt-5">{action}</Button>}
  </div>
}

/** Stands in for a Food screen until this computer has read its log. */
export function FoodGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const food = useFood()
  const navigate = useNavigate()
  if (!ledger.enabled) {
    return <FoodMessage
      title="Sign in to use Food"
      detail="Sign in once with Google on Home. Meals and the fridge then save on this computer and sync to D1."
      action="Go to sign in"
      onAction={() => navigate('/')}
    />
  }
  if (ledger.error) return <FoodMessage Icon={TriangleAlert} title="This computer cannot open its database" detail={ledger.error} />
  if (food.data && ledger.current) return <>{children}</>
  const stopped = !ledger.syncing && Boolean(ledger.status)
  if (stopped && ledger.status?.state === 'paused') {
    return <FoodMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
  }
  if (stopped && !ledger.current) {
    return <FoodMessage
      title="Waiting for a connection"
      detail="Food needs one download first. After that it works offline."
      action="Try again"
      onAction={() => void ledger.sync()}
    />
  }
  return <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-950"><Spinner /></div>
}

export function FoodError(): React.ReactElement | null {
  const { error, dismissError } = useFood()
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
 * The list's small copy when there is one, otherwise the full photo. `ego-media://` answers from
 * this computer's copy when it has one and from the Worker otherwise.
 */
export function FoodPhotoView({ photo, uri, size = 'small', className, style }: {
  photo: FoodPhoto | null
  /** A blob URL to show instead, like a draft not yet saved. */
  uri?: string | null
  size?: 'small' | 'large'
  className?: string
  style?: React.CSSProperties
}): React.ReactElement | null {
  const { blurred } = useBlur()
  const [broken, setBroken] = useState<string | null>(null)
  const id = photo ? (size === 'small' ? photo.previewId ?? photo.mediaId : photo.mediaId) : null
  const source = uri ?? (id ? mediaUrl(id, 'food') : null)
  if (!source) return null
  if (blurred || broken === source) return <span className={cn('block', className)} style={{ ...style, backgroundColor: color.surfaceRaised }} />
  return <img
    src={source}
    alt=""
    draggable={false}
    decoding="async"
    loading="lazy"
    onError={() => setBroken(source)}
    className={cn('object-cover', className)}
    style={style}
  />
}

export function FoodThumb({ entry, size = 56 }: { entry: Pick<FoodEntryInput, 'photo' | 'source'>; size?: number }): React.ReactElement {
  const style = { width: size, height: size, borderRadius: 14 }
  if (entry.photo) return <FoodPhotoView photo={entry.photo} className="shrink-0" style={style} />
  const Icon = entry.source === 'barcode' ? Barcode : UtensilsCrossed
  return <span style={style} className="flex shrink-0 items-center justify-center bg-surface-900"><Icon color={color.textFaint} size={size * 0.4} /></span>
}

export function FridgeIcon({ icon, size = 44 }: { icon: string; size?: number }): React.ReactElement {
  return <span style={{ width: size, height: size, borderRadius: size / 2 }} className="flex shrink-0 items-center justify-center bg-surface-900">
    {icon ? <span aria-hidden className="leading-none" style={{ fontSize: size * 0.48 }}>{icon}</span> : <Refrigerator color={color.textMuted} size={size * 0.45} />}
  </span>
}

function Bar({ share }: { share: number }): React.ReactElement {
  const over = share > 1
  return <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-800">
    <span className="block h-full" style={{ width: `${Math.min(share, 1) * 100}%`, backgroundColor: over ? color.attention : color.text }} />
  </span>
}

function MacroColumn({ label, value, target }: { label: string; value: number; target: number | null }): React.ReactElement {
  return <span className="block min-w-0 flex-1">
    <span className="block text-[13px] font-medium text-muted-foreground">{label}</span>
    <span className="mt-0.5 flex items-baseline">
      <span className="tabular text-[17px] font-semibold">{formatGrams(value)}</span>
      <span className="tabular ml-0.5 whitespace-pre text-[13px] text-muted-foreground">{target ? ` / ${formatGrams(target)} g` : ' g'}</span>
    </span>
    {target ? <Bar share={value / target} /> : null}
  </span>
}

/** Today against the daily targets. Clicking it opens the targets. */
export function TodayCard({ totals, goal, onPress }: {
  totals: FoodMacros
  goal: FoodGoalInput
  onPress: () => void
}): React.ReactElement {
  const left = goal.calories === null ? null : goal.calories - totals.calories
  return <button
    type="button"
    aria-label={`Today, ${formatCalories(totals.calories)} calories${goal.calories ? ` of ${formatCalories(goal.calories)}` : ''}`}
    title="Opens the daily targets"
    onClick={onPress}
    className="block w-full rounded-3xl border border-border bg-card p-4 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
  >
    <span className="flex items-baseline">
      <span className="tabular text-[30px] font-bold tracking-tight">{formatCalories(totals.calories)}</span>
      <span className="tabular ml-1.5 text-[15px] text-muted-foreground">
        {goal.calories ? `/ ${formatCalories(goal.calories)} kcal` : 'kcal today'}
      </span>
      <span className="flex-1" />
      {left !== null && <span className={cn('tabular text-[14px] font-medium', left < 0 ? 'text-attention' : 'text-muted-foreground')}>
        {left < 0 ? `${formatCalories(-left)} over` : `${formatCalories(left)} left`}
      </span>}
    </span>
    {goal.calories ? <Bar share={totals.calories / goal.calories} /> : null}
    <span className="mt-4 flex gap-4">
      <MacroColumn label="Protein" value={totals.protein} target={goal.protein} />
      <MacroColumn label="Carbs" value={totals.carbs} target={goal.carbs} />
      <MacroColumn label="Fat" value={totals.fat} target={goal.fat} />
    </span>
    {goal.calories === null && goal.protein === null && goal.carbs === null && goal.fat === null &&
      <span className="mt-3 block text-[13px] text-surface-400">Click to set daily targets.</span>}
  </button>
}
