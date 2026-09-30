import React, { memo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import {
  AlignLeft, CircleCheck, Circle, Clock, CloudUpload, Paperclip, SquareCheckBig, SquareKanban, TriangleAlert, X,
  type LucideIcon
} from 'lucide-react-native'
import type { TaskCardRecord, TaskLabelRecord } from '@ego/api-contracts'
import { TASK_PRIORITY_LABELS, type TaskLabelColor, type TaskPriority } from '@ego/core'
import { useLedger } from '../../lib/ledger-context'
import { BlurBlob, Blurred, useBlur } from '../../lib/blur'
import { mediaSource } from '../../lib/diary/media'
import { cardBadges, coverOf, type DueBadge } from '../../lib/tasks/board'
import { useTasks } from '../../lib/tasks/context'
import { ConflictEntries } from '../ConflictEntries'
import { BottomSheet } from '../money/Common'
import { SyncButton } from '../money/SyncButton'
import { color } from '../money/tokens'
import { Button } from '../ui/button'
import { Text as UiText } from '../ui/text'

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
    return <View
      accessibilityLabel={`${LABEL_COLOR_NAMES[label.color]} label`}
      style={{ width: large ? 48 : 32, height: large ? 28 : 8, borderRadius: large ? 8 : 4, backgroundColor: tint }}
    />
  }
  return <View className={`flex-row items-center rounded-full bg-surface-800 ${large ? 'px-3 py-1.5' : 'px-2 py-0.5'}`}>
    <View style={{ width: large ? 10 : 7, height: large ? 10 : 7, borderRadius: 5, backgroundColor: tint, marginRight: large ? 7 : 5 }} />
    <Blurred tint="#d4d4d4"><Text numberOfLines={1} className={`${large ? 'text-[15px]' : 'text-[12px]'} font-semibold text-surface-200`}>{label.name}</Text></Blurred>
  </View>
}

const PRIORITY_BARS: Record<TaskPriority, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 }

/** Signal bars: one lit for low up to all four for urgent, which alone is bright white. */
export function PriorityIcon({ priority, size = 14 }: { priority: TaskPriority; size?: number }): React.ReactElement | null {
  if (priority === 'none') return null
  const lit = PRIORITY_BARS[priority]
  const bar = Math.max(2, Math.round(size / 5))
  return <View accessibilityLabel={`${TASK_PRIORITY_LABELS[priority]} priority`} style={{ flexDirection: 'row', alignItems: 'flex-end', height: size, gap: 1.5 }}>
    {[1, 2, 3, 4].map((step) => <View key={step} style={{
      width: bar,
      height: Math.round(size * (0.3 + step * 0.175)),
      borderRadius: 1,
      backgroundColor: step <= lit ? (priority === 'urgent' ? '#ffffff' : '#bdbdbd') : '#3a3a3a'
    }} />)}
  </View>
}

export function DueChip({ due, large = false }: { due: DueBadge; large?: boolean }): React.ReactElement {
  const tone = due.state === 'overdue'
    ? { background: 'rgba(248, 113, 113, 0.16)', text: color.expense }
    : due.state === 'soon'
      ? { background: 'rgba(250, 250, 250, 0.14)', text: color.text }
      : due.state === 'done'
        ? { background: 'transparent', text: color.textFaint }
        : { background: 'transparent', text: color.textMuted }
  const Icon = due.state === 'done' ? CircleCheck : Clock
  return <View style={{ backgroundColor: tone.background }} className={`flex-row items-center rounded-md ${large ? 'px-2.5 py-1.5' : 'px-1.5 py-0.5'}`}>
    <Icon color={tone.text} size={large ? 16 : 13} />
    <Text style={{ color: tone.text }} className={`ml-1 ${large ? 'text-[15px]' : 'text-[12px]'} font-semibold`}>{due.label}</Text>
  </View>
}

function Badge({ Icon, text }: { Icon: LucideIcon; text?: string }): React.ReactElement {
  return <View className="flex-row items-center">
    <Icon color={color.textMuted} size={13} />
    {text !== undefined && <Text className="ml-1 text-[12px] font-semibold text-surface-400">{text}</Text>}
  </View>
}

/** A card as a column shows it. `onToggleDone` draws the round done button before the title. */
export const CardFace = memo(function CardFace({ card, labels, now, upload, onToggleDone, lifted = false }: {
  card: TaskCardRecord
  labels: readonly TaskLabelRecord[]
  now: Date
  upload?: 'sending' | 'failed'
  onToggleDone?: () => void
  lifted?: boolean
}): React.ReactElement {
  const { api } = useLedger()
  const { localFiles } = useTasks()
  const { blurred } = useBlur()
  const badges = cardBadges(card, now)
  const cover = coverOf(card)
  const shown = card.labelIds.flatMap((id) => labels.filter((label) => label.id === id))
  const done = card.doneAt !== null
  const coverHeight = cover?.width && cover.height ? Math.min(160, Math.max(90, 280 * cover.height / cover.width)) : 120
  return <View className={`overflow-hidden rounded-xl border ${lifted ? 'border-surface-500 bg-surface-800' : 'border-surface-800 bg-card'}`}>
    {cover && !blurred && <Image
      source={mediaSource(api, localFiles, cover.mediaId, 'tasks')}
      style={{ width: '100%', height: coverHeight, backgroundColor: '#1c1c1c' }}
      contentFit="cover"
      transition={120}
    />}
    <View className="px-3 py-2.5">
      {shown.length > 0 && <View className="mb-1.5 flex-row flex-wrap gap-1">
        {shown.map((label) => <LabelChip key={label.id} label={label} />)}
      </View>}
      <View className="flex-row items-start">
        {onToggleDone && <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={done ? 'Mark as not done' : 'Mark as done'}
          onPress={onToggleDone}
          hitSlop={10}
          className="mr-2 mt-0.5"
        >{done ? <CircleCheck color="#0a0a0a" fill="#fafafa" size={18} /> : <Circle color="#525252" size={18} />}</Pressable>}
        <Blurred tint={done ? '#737373' : '#f5f5f5'}>
          <Text className={`flex-1 text-[15px] leading-5 ${done ? 'text-surface-500' : 'text-surface-100'}`}>{card.title}</Text>
        </Blurred>
      </View>
      {(card.priority !== 'none' || badges.due || badges.description || badges.checklist || badges.attachments > 0 || upload) &&
        <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
          <PriorityIcon priority={card.priority} />
          {badges.due && <DueChip due={badges.due} />}
          {badges.description && <Badge Icon={AlignLeft} />}
          {badges.checklist && <View className={`flex-row items-center rounded-md ${badges.checklist.done === badges.checklist.total ? 'bg-surface-700 px-1.5 py-0.5' : ''}`}>
            <SquareCheckBig color={color.textMuted} size={13} />
            <Text className="ml-1 text-[12px] font-semibold text-surface-400">{badges.checklist.done}/{badges.checklist.total}</Text>
          </View>}
          {badges.attachments > 0 && <Badge Icon={Paperclip} text={String(badges.attachments)} />}
          {upload === 'sending' && <CloudUpload color={color.textMuted} size={14} accessibilityLabel="Files uploading" />}
          {upload === 'failed' && <TriangleAlert color={color.attention} size={14} accessibilityLabel="A file did not upload" />}
        </View>}
    </View>
  </View>
})

export function BoardIcon({ icon, size = 40 }: { icon: string; size?: number }): React.ReactElement {
  const { blurred } = useBlur()
  return <View className="items-center justify-center rounded-xl border border-surface-800 bg-surface-900" style={{ width: size, height: size }}>
    {blurred && icon
      ? <BlurBlob size={Math.round(size * 0.5)} />
      : icon
        ? <Text style={{ fontSize: Math.round(size * 0.5), color: '#fafafa' }}>{icon}</Text>
        : <SquareKanban color="#a3a3a3" size={Math.round(size * 0.5)} />}
  </View>
}

export function TasksMessage({ Icon = SquareKanban, title, detail, action, onAction }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color="#a3a3a3" size={30} /></View>
    <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
    {action && onAction && <Button onPress={onAction} className="mt-5"><UiText>{action}</UiText></Button>}
  </View>
}

/** Stands in for a Tasks screen until the phone has read its boards. */
export function TasksGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const tasks = useTasks()
  const router = useRouter()
  if (!ledger.enabled) {
    return <TasksMessage
      title="Sign in to use Tasks"
      detail="Sign in once with Google on the start screen. Boards then save on this phone and sync to D1."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }
  if (ledger.error) return <TasksMessage Icon={TriangleAlert} title="This phone cannot open its database" detail={ledger.error} />
  if (tasks.data && ledger.current) return <>{children}</>
  const stopped = !ledger.syncing && Boolean(ledger.status)
  if (stopped && ledger.status?.state === 'paused') {
    return <TasksMessage title="Sign in again" detail="The server stopped accepting this device." action="Open settings" onAction={() => router.push('/settings')} />
  }
  if (stopped && !ledger.current) {
    return <TasksMessage
      title="Waiting for a connection"
      detail="Tasks needs one download first. After that it works offline."
      action="Try again"
      onAction={() => void ledger.sync()}
    />
  }
  return <View className="flex-1 items-center justify-center bg-surface-950"><ActivityIndicator color="#fafafa" /></View>
}

export function TasksError(): React.ReactElement | null {
  const { error, dismissError } = useTasks()
  if (!error) return null
  return <Pressable
    accessibilityRole="button"
    accessibilityHint="Dismisses this message"
    onPress={dismissError}
    className="mx-4 mb-2 flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
  >
    <Text className="flex-1 text-[14px] leading-5 text-red-300">{error}</Text>
    <X color="#fca5a5" size={16} />
  </Pressable>
}

/** Sync state with the conflict review kept inside Tasks, followed by the screen's own buttons. */
export function TasksHeaderRight({ children }: { children?: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const [reviewing, setReviewing] = useState(false)
  return <View style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
    <SyncButton onReview={() => setReviewing(true)} />
    {children}
    <BottomSheet visible={reviewing} title="Needs attention" onClose={() => setReviewing(false)}>
      <ConflictEntries
        entries={ledger.conflicts}
        onKeepMine={(entry) => void ledger.resolveKeepMine(entry).then(() => setReviewing(false))}
        onUseSaved={(entry) => void ledger.resolveUseSaved(entry).then(() => setReviewing(false))}
      />
    </BottomSheet>
  </View>
}

export function SectionTitle({ Icon, title, right }: { Icon?: LucideIcon; title: string; right?: React.ReactNode }): React.ReactElement {
  return <View className="mb-2 mt-6 flex-row items-center">
    {Icon && <Icon color={color.textMuted} size={18} />}
    <Text className={`flex-1 text-[15px] font-semibold uppercase tracking-wide text-surface-400 ${Icon ? 'ml-2' : ''}`}>{title}</Text>
    {right}
  </View>
}
