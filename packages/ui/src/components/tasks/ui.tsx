import React, { memo, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlignLeft, CircleCheck, Circle, Clock, CloudUpload, Paperclip, SquareCheckBig, SquareKanban, TriangleAlert, X,
  type LucideIcon
} from 'lucide-react'
import type { TaskCardRecord, TaskLabelRecord } from '@ego/api-contracts'
import { TASK_PRIORITY_LABELS, type TaskLabelColor, type TaskPriority } from '@ego/core'
import { cardBadges, coverOf, type DueBadge } from '@ego/local/tasks/board'
import { mediaUrl } from '../../lib/platform'
import { BlurBlob, Blurred, useBlur } from '../../lib/blur'
import { useLedger } from '../../lib/ledger'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { Screen, ScreenHeader } from '../screen'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { Spinner } from '../ui/spinner'
import { SwitchTrack } from '../ui/switch'

/** Muted enough to sit on black without turning the board into a rainbow. */
export const LABEL_COLORS: Record<TaskLabelColor, string> = {
  green: '#4f9d69',
  yellow: '#c4a13a',
  orange: '#cc7a3d',
  red: '#c95757',
  purple: '#8b6fc4',
  blue: '#4f82c9',
  sky: '#3f9fb3',
  pink: '#c0619a'
}

export const LABEL_COLOR_NAMES: Record<TaskLabelColor, string> = {
  green: 'Green', yellow: 'Yellow', orange: 'Orange', red: 'Red', purple: 'Purple', blue: 'Blue', sky: 'Sky', pink: 'Pink'
}

export function LabelChip({ label, size = 'small' }: { label: TaskLabelRecord; size?: 'small' | 'large' }): React.ReactElement {
  const tint = LABEL_COLORS[label.color]
  const large = size === 'large'
  if (!label.name) {
    return <span
      role="img"
      aria-label={`${LABEL_COLOR_NAMES[label.color]} label`}
      className="inline-block shrink-0"
      style={{ width: large ? 48 : 32, height: large ? 28 : 8, borderRadius: large ? 8 : 4, backgroundColor: tint }}
    />
  }
  return <span className={cn('inline-flex min-w-0 max-w-full items-center rounded-full bg-surface-800', large ? 'px-3 py-1.5' : 'px-2 py-0.5')}>
    <span className="shrink-0" style={{ width: large ? 10 : 7, height: large ? 10 : 7, borderRadius: 5, backgroundColor: tint, marginRight: large ? 7 : 5 }} />
    <Blurred><span className={cn('truncate font-semibold text-surface-200', large ? 'text-[15px]' : 'text-[12px]')}>{label.name}</span></Blurred>
  </span>
}

const PRIORITY_BARS: Record<TaskPriority, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 }

/** Signal bars: one lit for low up to all four for urgent, which alone is bright white. */
export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }): React.ReactElement | null {
  if (priority === 'none') return null
  const lit = PRIORITY_BARS[priority]
  const bar = Math.max(2, Math.round(size / 5))
  return <span role="img" aria-label={`${TASK_PRIORITY_LABELS[priority]} priority`} className="inline-flex shrink-0 items-end" style={{ height: size, gap: 1.5 }}>
    {[1, 2, 3, 4].map((step) => <span key={step} style={{
      width: bar,
      height: Math.round(size * (0.3 + step * 0.175)),
      borderRadius: 1,
      backgroundColor: step <= lit ? (priority === 'urgent' ? '#ffffff' : '#bdbdbd') : '#3a3a3a'
    }} />)}
  </span>
}

/** Dark enough for white text to stay readable at 12px. */
const DUE_RED = '#c43c3c'

export function DueChip({ due, large = false }: { due: DueBadge; large?: boolean }): React.ReactElement {
  const pill = due.state === 'overdue' || due.state === 'today'
  const tone = pill
    ? { background: DUE_RED, text: '#ffffff' }
    : due.state === 'soon'
      ? { background: 'rgba(250, 250, 250, 0.14)', text: color.text }
      : due.state === 'done'
        ? { background: 'transparent', text: color.textFaint }
        : { background: 'transparent', text: color.textMuted }
  const Icon = due.state === 'done' ? CircleCheck : Clock
  const padding = large ? (pill ? 'px-3 py-1.5' : 'px-2.5 py-1.5') : (pill ? 'px-2 py-0.5' : 'px-1.5 py-0.5')
  return <span style={{ backgroundColor: tone.background, color: tone.text }} className={cn('inline-flex shrink-0 items-center', pill ? 'rounded-full' : 'rounded-md', padding)}>
    <Icon color={tone.text} size={large ? 16 : 13} />
    <span className={cn('ml-1 font-semibold', large ? 'text-[15px]' : 'text-[12px]')}>{due.label}</span>
  </span>
}

function Badge({ Icon, text }: { Icon: LucideIcon; text?: string }): React.ReactElement {
  return <span className="inline-flex items-center">
    <Icon color={color.textMuted} size={13} />
    {text !== undefined && <span className="ml-1 text-[12px] font-semibold text-surface-400">{text}</span>}
  </span>
}

/** What a card's images retry on: a save of the card, or its files moving through the upload queue. */
export function imageVersion(card: Pick<TaskCardRecord, 'updatedAt'>, upload: 'sending' | 'failed' | undefined): string {
  return `${card.updatedAt}|${upload ?? ''}`
}

/**
 * A task image from this computer's copy or the Worker. A new file can be asked for before the
 * write that records it lands, and then comes back missing, so a failed image tries again when
 * `version` changes. A type Chromium cannot draw leaves the frame empty.
 */
export function TaskImage({ mediaId, version, className, style }: {
  mediaId: string
  version: string
  className?: string
  style?: React.CSSProperties
}): React.ReactElement {
  const [failed, setFailed] = useState<{ mediaId: string; version: string } | null>(null)
  const [retry, setRetry] = useState<{ mediaId: string; version: string } | null>(null)
  useEffect(() => {
    if (!failed || failed.mediaId !== mediaId || failed.version === version) return
    setRetry({ mediaId, version })
    setFailed(null)
  }, [failed, mediaId, version])
  if (failed?.mediaId === mediaId) return <div className={className} style={style} />
  const source = mediaUrl(mediaId, 'tasks')
  return <img
    src={retry?.mediaId === mediaId ? `${source}?retry=${encodeURIComponent(retry.version)}` : source}
    alt=""
    draggable={false}
    loading="lazy"
    onError={() => setFailed({ mediaId, version })}
    className={cn('object-cover', className)}
    style={style}
  />
}

/**
 * A card as a column shows it. `onToggleDone` draws the round done button before the title, and
 * `title` replaces the title, as the quick editor's text box does.
 */
export const CardFace = memo(function CardFace({ card, labels, now, upload, onToggleDone, lifted = false, title }: {
  card: TaskCardRecord
  labels: readonly TaskLabelRecord[]
  now: Date
  upload?: 'sending' | 'failed'
  onToggleDone?: () => void
  lifted?: boolean
  title?: React.ReactNode
}): React.ReactElement {
  const { blurred } = useBlur()
  const badges = cardBadges(card, now)
  const cover = coverOf(card)
  const shown = card.labelIds.flatMap((id) => labels.filter((label) => label.id === id))
  const done = card.doneAt !== null
  const coverHeight = cover?.width && cover.height ? Math.min(160, Math.max(90, 280 * cover.height / cover.width)) : 120
  return <div className={cn('overflow-hidden rounded-xl border', lifted ? 'border-surface-500 bg-surface-800' : 'border-surface-800 bg-card')}>
    {cover && !blurred && <TaskImage mediaId={cover.mediaId} version={imageVersion(card, upload)} className="w-full bg-popover" style={{ height: coverHeight }} />}
    <div className="px-3 py-2.5">
      {shown.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1">
        {shown.map((label) => <LabelChip key={label.id} label={label} />)}
      </div>}
      <div className="flex items-start">
        {onToggleDone && <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? 'Mark as not done' : 'Mark as done'}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onToggleDone()
          }}
          className="-ml-1 mr-1 mt-[-2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-surface-800"
        >{done ? <CircleCheck color="#0a0a0a" fill="#fafafa" size={18} /> : <Circle color="#525252" size={18} />}</button>}
        {title ?? <Blurred>
          <span className={cn('min-w-0 flex-1 break-words text-[15px] leading-5', done ? 'text-surface-500' : 'text-surface-100')}>{card.title}</span>
        </Blurred>}
      </div>
      {(card.priority !== 'none' || badges.due || badges.description || badges.checklist || badges.attachments > 0 || upload) &&
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <PriorityIcon priority={card.priority} />
          {badges.due && <DueChip due={badges.due} />}
          {badges.description && <Badge Icon={AlignLeft} />}
          {badges.checklist && <span className={cn('inline-flex items-center rounded-md', badges.checklist.done === badges.checklist.total && 'bg-surface-700 px-1.5 py-0.5')}>
            <SquareCheckBig color={color.textMuted} size={13} />
            <span className="ml-1 text-[12px] font-semibold text-surface-400">{badges.checklist.done}/{badges.checklist.total}</span>
          </span>}
          {badges.attachments > 0 && <Badge Icon={Paperclip} text={String(badges.attachments)} />}
          {upload === 'sending' && <CloudUpload color={color.textMuted} size={14} aria-label="Files uploading" />}
          {upload === 'failed' && <TriangleAlert color={color.attention} size={14} aria-label="A file did not upload" />}
        </div>}
    </div>
  </div>
})

export function BoardIcon({ icon, size = 40 }: { icon: string; size?: number }): React.ReactElement {
  const { blurred } = useBlur()
  return <span className="inline-flex shrink-0 items-center justify-center rounded-xl border border-surface-800 bg-surface-900" style={{ width: size, height: size }}>
    {blurred && icon
      ? <BlurBlob size={Math.round(size * 0.5)} />
      : icon
        ? <span style={{ fontSize: Math.round(size * 0.5), lineHeight: 1, color: '#fafafa' }}>{icon}</span>
        : <SquareKanban color="#a3a3a3" size={Math.round(size * 0.5)} />}
  </span>
}

export function TasksMessage({ Icon = SquareKanban, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <div className="flex h-full flex-col items-center justify-center px-8 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold text-surface-100">{title}</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-surface-400">{detail}</p>
    {action && onAction && <Button onClick={onAction} className="mt-5">{action}</Button>}
  </div>
}

/**
 * Stands in for a Tasks screen until this computer has read its boards, under a header with the
 * screen's title and back arrow but none of its buttons.
 */
export function TasksGate({ title, back, tabs, children }: {
  title: React.ReactNode
  back?: string
  tabs?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  const ledger = useLedger()
  const tasks = useTasks()
  const navigate = useNavigate()
  if (ledger.loaded && ledger.enabled && !ledger.error && tasks.data && ledger.current) return <>{children}</>
  const stopped = !ledger.syncing && Boolean(ledger.status)
  const body = !ledger.loaded
    ? <div className="flex h-full items-center justify-center"><Spinner /></div>
    : !ledger.enabled
      ? <TasksMessage
        title="Sign in to use Tasks"
        detail="Sign in once with Google on Home. Boards then save on this computer and sync to D1."
        action="Go to sign in"
        onAction={() => navigate('/')}
      />
      : ledger.error
        ? <TasksMessage Icon={TriangleAlert} title="This computer cannot open its database" detail={ledger.error} />
        : stopped && ledger.status?.state === 'paused'
          ? <TasksMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => navigate('/settings')} />
          : stopped && !ledger.current
            ? <TasksMessage
              title="Waiting for a connection"
              detail="Tasks needs one download first. After that it works offline."
              action="Try again"
              onAction={() => void ledger.sync()}
            />
            : <div className="flex h-full items-center justify-center"><Spinner /></div>
  return <Screen>
    <ScreenHeader title={title} back={back} tabs={tabs} />
    <div className="min-h-0 flex-1">{body}</div>
  </Screen>
}

export function TasksError({ className }: { className?: string }): React.ReactElement | null {
  const { error, dismissError } = useTasks()
  if (!error) return null
  return <button
    type="button"
    onClick={dismissError}
    className={cn('flex w-full items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-left hover:bg-red-500/15', className)}
  >
    <span className="flex-1 text-[14px] leading-5 text-red-300">{error}</span>
    <X color="#fca5a5" size={16} />
  </button>
}

export function SectionTitle({ Icon, title, right }: { Icon?: LucideIcon; title: string; right?: React.ReactNode }): React.ReactElement {
  return <div className="mb-2 mt-6 flex items-center">
    {Icon && <Icon color={color.textMuted} size={18} />}
    <h2 className={cn('flex-1 text-[15px] font-semibold uppercase tracking-wide text-surface-400', Icon && 'ml-2')}>{title}</h2>
    {right}
  </div>
}

/** A text button on the right of a section title or a banner, like the phone's "Edit" and "Add". */
export function TextAction({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }): React.ReactElement {
  return <button
    type="button"
    aria-label={label}
    onClick={onClick}
    className="inline-flex items-center rounded-lg px-1.5 py-0.5 text-[15px] font-semibold text-white hover:bg-surface-800"
  >{children}</button>
}

/** While something is being dragged, every element shows the closed hand and no text gets selected. */
export function DraggingCursor(): React.ReactElement {
  return <style>{'*, *::before, *::after { cursor: grabbing !important; user-select: none !important; }'}</style>
}

export interface MenuItem {
  label: string
  Icon?: LucideIcon
  destructive?: boolean
  disabled?: boolean
  /** Makes the row a switch, which flips in place and leaves the sheet open. */
  checked?: boolean
  onPress: () => void
}

/** The phone's action sheet: one row per action, closing before the action runs. */
export function MenuSheet({ visible, title, items, onClose }: {
  visible: boolean
  title: string
  items: MenuItem[]
  onClose: () => void
}): React.ReactElement {
  return <Sheet visible={visible} title={title} onClose={onClose} dismissOnBackdrop>
    {items.map((item) => <button
      key={item.label}
      type="button"
      role={item.checked === undefined ? undefined : 'switch'}
      aria-checked={item.checked}
      disabled={item.disabled}
      onClick={() => {
        if (item.checked === undefined) onClose()
        item.onPress()
      }}
      className="flex min-h-14 w-full items-center rounded-lg border-b border-surface-900 px-1 text-left transition-colors hover:bg-surface-900 active:bg-surface-900 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {item.Icon && <item.Icon color={item.destructive ? color.destructive : color.textSecondary} size={20} />}
      <span className={cn('ml-3 flex-1 text-[17px]', item.destructive && 'text-destructive')}>{item.label}</span>
      {item.checked !== undefined && <SwitchTrack checked={item.checked} />}
    </button>)}
  </Sheet>
}
