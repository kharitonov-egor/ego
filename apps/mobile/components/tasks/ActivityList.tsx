import React from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  AlignLeft, Archive, ArchiveRestore, ArrowRightLeft, CircleCheck, CircleDot, Clock, Copy, Flag, Paperclip, Pencil,
  RotateCcw, SquareCheckBig, SquarePlus, Tag, type LucideIcon
} from 'lucide-react-native'
import type { TaskActivity, TaskActivityKind } from '@ego/core'
import { Blurred } from '../../lib/blur'
import { activityTime } from '../../lib/tasks/board'
import { color } from '../money/tokens'

const ICONS: Record<TaskActivityKind, LucideIcon> = {
  create: SquarePlus,
  move: ArrowRightLeft,
  rename: Pencil,
  done: CircleCheck,
  reopen: RotateCcw,
  due: Clock,
  label: Tag,
  priority: Flag,
  description: AlignLeft,
  checklist: SquareCheckBig,
  attachment: Paperclip,
  archive: Archive,
  restore: ArchiveRestore,
  copy: Copy
}

export interface ActivityEntry extends TaskActivity {
  /** Set on a board's log, which names the card each line is about. */
  cardTitle?: string
  cardId?: string
}

export function ActivityRow({ entry, now, onOpenCard }: {
  entry: ActivityEntry
  now: Date
  onOpenCard?: (cardId: string) => void
}): React.ReactElement {
  const Icon = ICONS[entry.kind] ?? CircleDot
  return <View className="flex-row py-2.5">
    <View className="mt-0.5 h-7 w-7 items-center justify-center rounded-full bg-surface-900"><Icon color={color.textMuted} size={15} /></View>
    <View className="ml-3 flex-1">
      {entry.cardTitle !== undefined && entry.cardId && <Pressable accessibilityRole="button" onPress={() => entry.cardId && onOpenCard?.(entry.cardId)} hitSlop={4}>
        <Blurred tint="#fafafa"><Text numberOfLines={1} className="text-[14px] font-semibold text-surface-100">{entry.cardTitle}</Text></Blurred>
      </Pressable>}
      <Blurred tint="#d4d4d4"><Text className="text-[15px] leading-5 text-surface-300">{entry.text}</Text></Blurred>
      <Text className="mt-0.5 text-[13px] text-surface-500">{activityTime(entry.at, now)}</Text>
    </View>
  </View>
}
