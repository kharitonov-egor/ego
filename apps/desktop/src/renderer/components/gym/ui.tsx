import React, { useCallback, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router'
import { Dumbbell, MessageSquare, Trophy, X } from 'lucide-react'
import type { ExerciseType, GymSetLike, WeightUnit } from '@ego/core'
import { setParts } from '@ego/local/gym/format'
import { useGym } from '../../lib/gym/context'
import { useLedger } from '../../lib/ledger'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { CenteredMessage } from '../screen'
import { Spinner } from '../ui/spinner'

/** FitNotes' section heading: small capitals over a rule, drawn in the money palette's gray. */
export function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }): React.ReactElement {
  return <div className="border-b border-border pb-1.5">
    <div className="flex items-end justify-between">
      <h3 className="text-[14px] font-bold tracking-wide text-muted-foreground">{children}</h3>
      {right}
    </div>
  </div>
}

export function Dot({ color: fill, size = 10 }: { color: string; size?: number }): React.ReactElement {
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, backgroundColor: fill }} />
}

/**
 * One set as FitNotes lays it out: values right-aligned in fixed columns so weights and reps line
 * up down the card.
 */
export function SetValues({ set, type, unit, size = 'regular' }: {
  set: GymSetLike
  type: ExerciseType
  unit: WeightUnit
  size?: 'regular' | 'large'
}): React.ReactElement {
  const parts = setParts(set, type, unit)
  const valueClass = size === 'large' ? 'text-[20px] font-bold' : 'text-[18px] font-bold'
  return <div className="flex items-baseline">
    {parts.map((part, index) => <div key={part.field} className={cn('flex items-baseline justify-end', index === parts.length - 1 ? 'w-[92px]' : 'w-[118px]')}>
      <span className={cn(valueClass, 'tabular')}>{part.value}</span>
      {part.unit !== '' && <span className="ml-1 text-[14px] text-muted-foreground">{part.unit}</span>}
    </div>)}
  </div>
}

export function SetMarks({ record, comment }: { record: boolean; comment: string }): React.ReactElement | null {
  if (!record && !comment) return null
  return <div className="flex items-center gap-1.5">
    {record && <Trophy color={color.attention} size={15} aria-label="Personal record" />}
    {comment !== '' && <MessageSquare color={color.textMuted} size={14} aria-label="Has a comment" />}
  </div>
}

export function trackPath(exerciseId: string): string {
  return `/gym/track?exerciseId=${encodeURIComponent(exerciseId)}`
}

/** Where an editor returns to: the screen that opened it, passed in the navigation state, or its usual parent. */
export function backFrom(state: unknown, fallback: string): string {
  if (typeof state === 'object' && state !== null && 'back' in state && typeof state.back === 'string') return state.back
  return fallback
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

export interface DragReorder {
  dragging: string | null
  /** The gap the dragged row would land in: 0 is above the first row, the row count is below the last. */
  dropAt: number | null
  rowProps: (id: string, index: number) => Pick<React.HTMLAttributes<HTMLElement>,
    'draggable' | 'onDragStart' | 'onDragOver' | 'onDrop' | 'onDragEnd'>
  listProps: Pick<React.HTMLAttributes<HTMLElement>, 'onDragLeave'>
}

/** Mouse dragging for a list the phone reorders with Move up and Move down. */
export function useDragReorder(ids: readonly string[], onMove: (from: number, to: number) => void, enabled = true): DragReorder {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const reset = (): void => {
    setDragging(null)
    setDropAt(null)
  }
  return {
    dragging,
    dropAt,
    rowProps: (id, index) => ({
      draggable: enabled,
      onDragStart: (event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
        setDragging(id)
      },
      onDragOver: (event) => {
        if (!dragging) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        setDropAt(event.clientY < rect.top + rect.height / 2 ? index : index + 1)
      },
      onDrop: (event) => {
        event.preventDefault()
        const from = dragging ? ids.indexOf(dragging) : -1
        const slot = dropAt
        reset()
        if (from === -1 || slot === null) return
        const to = slot > from ? slot - 1 : slot
        if (to !== from) onMove(from, to)
      },
      onDragEnd: reset
    }),
    listProps: {
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) setDropAt(null)
      }
    }
  }
}

/** The line that shows where a dragged row will land. */
export function DropLine({ edge }: { edge: 'top' | 'bottom' }): React.ReactElement {
  return <span aria-hidden className={cn('pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-foreground',
    edge === 'top' ? 'top-0 -translate-y-px' : 'bottom-0 translate-y-px')} />
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    const list = window.matchMedia(query)
    list.addEventListener('change', notify)
    return () => list.removeEventListener('change', notify)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/** Wide enough for the day's exercise list to sit beside the day instead of sliding over it. */
export function useWideWindow(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}

export function GymError(): React.ReactElement | null {
  const { error, dismissError } = useGym()
  if (!error) return null
  return <button type="button" title="Dismiss this message" onClick={dismissError} className="flex min-h-11 w-full shrink-0 items-center gap-2 bg-red-500/10 px-5 py-2 text-left hover:bg-red-500/15">
    <span className="flex-1 text-[14px] leading-5 text-red-300">{error}</span>
    <X color="#fca5a5" size={16} />
  </button>
}

/** Shows the gym screens once the local copy is readable, and says why when it is not. */
export function GymGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  if (!ledger.loaded) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  if (!ledger.enabled) {
    return <CenteredMessage Icon={Dumbbell} title="Sign in to see your workouts" detail="Sign in once with Google on Home." action="Go to sign in" onAction={() => navigate('/')} />
  }
  if (ledger.error) return <CenteredMessage Icon={Dumbbell} title="This computer cannot open its log" detail={ledger.error} />
  if (!ledger.current) {
    const stopped = Boolean(ledger.status) && !ledger.syncing
    if (stopped && ledger.status?.state === 'paused') {
      return <CenteredMessage Icon={Dumbbell} title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
    }
    if (stopped) {
      return <CenteredMessage
        Icon={Dumbbell}
        title={ledger.status?.state === 'offline' ? 'Waiting for a connection' : 'The download did not finish'}
        detail={ledger.status?.state === 'offline'
          ? 'The first download needs the internet. After that, the gym log works offline.'
          : ledger.status?.message ?? 'Try again in a moment.'}
        action="Try again"
        onAction={() => void ledger.sync()}
      />
    }
    return <div className="flex flex-1 flex-col items-center justify-center">
      <Spinner />
      <p className="mt-3 text-[14px] text-muted-foreground">Downloading your workouts</p>
    </div>
  }
  return <div className="flex min-h-0 flex-1 flex-col"><GymError />{children}</div>
}
