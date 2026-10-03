import React from 'react'
import {
  AlignLeft, Archive, ArchiveRestore, ArrowRightLeft, CircleCheck, CircleDot, Clock, Copy, Flag, Paperclip, Pencil,
  RotateCcw, SquareCheckBig, SquarePlus, Tag, type LucideIcon
} from 'lucide-react'
import type { TaskActivity, TaskActivityKind } from '@ego/core'
import { activityTime } from '@ego/local/tasks/board'
import { Blurred } from '../../lib/blur'
import { color } from '../../lib/tokens'

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
  return <div className="flex py-2.5">
    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-900"><Icon color={color.textMuted} size={15} /></span>
    <div className="ml-3 min-w-0 flex-1">
      {entry.cardTitle !== undefined && entry.cardId && <button
        type="button"
        onClick={() => entry.cardId && onOpenCard?.(entry.cardId)}
        className="block max-w-full text-left hover:underline"
      >
        <Blurred><span className="block truncate text-[14px] font-semibold text-surface-100">{entry.cardTitle}</span></Blurred>
      </button>}
      <Blurred><p className="text-[15px] leading-5 text-surface-300">{entry.text}</p></Blurred>
      <p className="mt-0.5 text-[13px] text-surface-500">{activityTime(entry.at, now)}</p>
    </div>
  </div>
}
