import React from 'react'
import { Briefcase, GraduationCap, Inbox, type LucideIcon } from 'lucide-react'
import type { TaskListRecord } from '@ego/api-contracts'
import type { TaskListColor, TaskListKind } from '@ego/core'
import { columnHex, hexWithAlpha } from '@ego/local/tasks/board'
import { Blurred } from '../../lib/blur'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { LABEL_COLORS } from './ui'

export const COLUMN_HEADER = 52
const TINT = 0.24

const KIND_ICONS: Partial<Record<TaskListKind, LucideIcon>> = { inbox: Inbox, usf: GraduationCap, work: Briefcase }

export function listHex(list: Pick<TaskListRecord, 'color'>): string | null {
  return columnHex(list.color, LABEL_COLORS)
}

/** The outline a column draws when it has a color and asks for one. */
export function columnFrame(tint: TaskListColor | null, border: boolean): React.CSSProperties | undefined {
  const hex = columnHex(tint, LABEL_COLORS)
  return hex && border ? { border: `2px solid ${hex}` } : undefined
}

type ColumnHeaderProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'color'> & {
  list: Pick<TaskListRecord, 'name' | 'kind' | 'color' | 'icon' | 'border'>
  count: number
}

/**
 * A column's header: its emoji or its kind's icon, the name, and the card count, then whatever the
 * board adds. A colored column gets a tinted header with a stripe of the color along the top,
 * which the outline replaces when it has one.
 */
export function ColumnHeader({ list, count, className, style, children, ...rest }: ColumnHeaderProps): React.ReactElement {
  const hex = listHex(list)
  const outlined = hex !== null && list.border
  const KindIcon = KIND_ICONS[list.kind]
  return <div
    {...rest}
    style={{
      height: COLUMN_HEADER,
      backgroundColor: hex ? hexWithAlpha(hex, TINT) : undefined,
      boxShadow: hex && !outlined ? `inset 0 3px 0 ${hex}` : undefined,
      ...style
    }}
    className={cn('flex shrink-0 select-none items-center pl-4 pr-1', outlined ? 'rounded-t-[14px]' : 'rounded-t-2xl', className)}
  >
    {list.icon
      ? <span aria-hidden className="mr-2 shrink-0 text-[17px] leading-none">{list.icon}</span>
      : KindIcon && <KindIcon color={hex ? '#e5e5e5' : color.textSecondary} size={17} className="mr-2 shrink-0" />}
    <Blurred><span className="min-w-0 flex-1 truncate text-[16px] font-bold text-surface-100">{list.name}</span></Blurred>
    <span className={cn('tabular ml-2 text-[14px] font-semibold', hex ? 'text-surface-300' : 'text-surface-500')}>{count}</span>
    {children}
  </div>
}
