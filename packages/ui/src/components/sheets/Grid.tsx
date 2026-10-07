import React, { memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Ellipsis, Plus } from 'lucide-react'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import type { SheetColumn, SheetColumnType, SheetSort } from '@ego/core'
import {
  cellState, dateLabel, linkLabel, numberLabel, optionOf, rowName, rowTypeOf, type GridItem
} from '@ego/local/sheets/view'
import { cn } from '../../lib/utils'
import { isTypedColumn } from './CellEditor'
import { anchorBelow, type MenuAnchor } from '../ui/menu'
import { gridMove, moveSelection, typedKey, type CellRef } from './navigation'
import { COLUMN_TYPE_ICONS, OptionPill, UNFIT } from './ui'

export const NAME_WIDTH = 240
const ROW_HEIGHT = 44
const HEADER_HEIGHT = 42
const SECTION_HEIGHT = 44
const ADD_WIDTH = 56
const LINE = '#1f1f1f'
const PINNED_LINE = '#3a3a3a'
const HEADER = '#141414'

const WIDTHS: Record<SheetColumnType, number> = {
  text: 200, longText: 260, number: 132, date: 140, checkbox: 116, dropdown: 168, tags: 228, phone: 168, email: 232, link: 208
}

export function columnWidth(column: SheetColumn): number {
  return WIDTHS[column.type]
}

export interface GridHandlers {
  openRow: (row: SheetRowRecord) => void
  rowMenu: (row: SheetRowRecord, at: MenuAnchor) => void
  /** `seed` is a key typed on the cell, which starts the edit. */
  editCell: (row: SheetRowRecord, column: SheetColumn, seed: string | null) => void
  toggleCell: (row: SheetRowRecord, column: SheetColumn) => void
  clearCell: (row: SheetRowRecord, column: SheetColumn) => void
  columnMenu: (column: SheetColumn, at: MenuAnchor) => void
  addColumn: () => void
  toggleSection: (key: string) => void
  select: (cell: CellRef | null) => void
}

interface RowEvents {
  handlers: GridHandlers
  focusGrid: () => void
}

function CellBody({ sheet, column, row, today, onToggle }: {
  sheet: SheetRecord
  column: SheetColumn
  row: SheetRowRecord
  today: Date
  onToggle: (event: React.MouseEvent) => void
}): React.ReactElement | null {
  const state = cellState(sheet, column, row)
  if (state.kind === 'none') return <span className="block text-center text-[15px] text-surface-700">–</span>
  if (state.kind === 'empty') {
    if (column.type !== 'checkbox') return null
    return <span role="checkbox" aria-checked={false} aria-label={column.name} onClick={onToggle} className="mx-auto block h-5 w-5 cursor-pointer rounded-md border-2 border-surface-600 hover:border-surface-400" />
  }
  if (state.kind === 'mismatch') return <span style={{ color: UNFIT }} className="block truncate text-[14px]" title={state.text}>{state.text}</span>
  const value = state.value
  switch (column.type) {
    case 'checkbox':
      return <span role="checkbox" aria-checked aria-label={column.name} onClick={onToggle} className="mx-auto flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-white hover:bg-surface-300">
        <Check color="#0a0a0a" size={14} strokeWidth={3.5} />
      </span>
    case 'number':
      return <span className="tabular block truncate text-right text-[14px] text-surface-100">{typeof value === 'number' ? numberLabel(value) : ''}</span>
    case 'date':
      return <span className="block truncate text-[14px] text-surface-100">{typeof value === 'string' ? dateLabel(value, today) : ''}</span>
    case 'link':
      return <span className="block truncate text-[14px] text-surface-100 underline" title={typeof value === 'string' ? value : undefined}>{typeof value === 'string' ? linkLabel(value) : ''}</span>
    case 'dropdown': {
      const option = typeof value === 'string' ? optionOf(column, value) : null
      return option ? <span className="flex min-w-0"><OptionPill option={option} /></span> : null
    }
    case 'tags': {
      const options = (Array.isArray(value) ? value : []).flatMap((id) => {
        const option = optionOf(column, id)
        return option ? [option] : []
      })
      const shown = options.slice(0, 2)
      return <span className="flex items-center gap-1 overflow-hidden" title={options.map((option) => option.name).join(', ')}>
        {shown.map((option) => <span key={option.id} className="flex min-w-0" style={{ maxWidth: options.length > 1 ? 96 : 200 }}><OptionPill option={option} /></span>)}
        {options.length > shown.length && <span className="text-[12px] font-semibold text-surface-400">+{options.length - shown.length}</span>}
      </span>
    }
    default: {
      const text = typeof value === 'string' ? value : ''
      return <span className="block truncate text-[14px] text-surface-100" title={text.length > 20 ? text : undefined}>{text.split('\n')[0]}</span>
    }
  }
}

const GridRow = memo(function GridRow({ sheet, columns, row, today, cellId, selectedColumn, focused, events }: {
  sheet: SheetRecord
  columns: readonly SheetColumn[]
  row: SheetRowRecord
  today: Date
  cellId: (cell: CellRef) => string
  /** The selected column, when the selection is in this row. */
  selectedColumn: string | null
  focused: boolean
  events: React.RefObject<RowEvents>
}): React.ReactElement {
  const name = rowName(sheet, row)
  const type = sheet.view.typeId === null ? rowTypeOf(sheet, row.typeId) : null
  const nameColumn = columns[0]
  const ring = focused ? 'shadow-[inset_0_0_0_2px_#fafafa]' : 'shadow-[inset_0_0_0_2px_#737373]'
  const select = (column: SheetColumn): void => events.current?.handlers.select({ rowId: row.id, columnId: column.id })
  return <div
    role="row"
    style={{ height: ROW_HEIGHT, borderColor: LINE }}
    className="group flex border-b hover:bg-[#111111]"
    onContextMenu={(event) => {
      event.preventDefault()
      events.current?.handlers.rowMenu(row, { x: event.clientX, y: event.clientY })
    }}
  >
    <div
      role="rowheader"
      id={cellId({ rowId: row.id, columnId: nameColumn.id })}
      aria-selected={selectedColumn === nameColumn.id}
      title={name.length > 24 ? name : undefined}
      onMouseDown={() => select(nameColumn)}
      onClick={() => events.current?.handlers.openRow(row)}
      style={{ width: NAME_WIDTH, borderColor: PINNED_LINE }}
      className={cn('sticky left-0 z-10 flex shrink-0 cursor-pointer flex-col justify-center border-r px-3 pr-10',
        selectedColumn !== null ? 'bg-surface-900' : 'bg-surface-950 group-hover:bg-[#111111]',
        selectedColumn === nameColumn.id && ring)}
    >
      <span className={cn('truncate text-[15px] font-semibold', name ? 'text-white' : 'text-surface-600')}>{name || 'Untitled'}</span>
      {type && <span className="truncate text-[11px] font-medium uppercase tracking-wide text-surface-500">{type.name}</span>}
      <button
        type="button"
        tabIndex={-1}
        aria-label={`More for ${name || 'untitled row'}`}
        title="More"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          select(nameColumn)
          events.current?.focusGrid()
          events.current?.handlers.rowMenu(row, anchorBelow(event.currentTarget, 'start'))
        }}
        className={cn('absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-surface-400 hover:bg-surface-800 hover:text-white',
          selectedColumn !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
      ><Ellipsis size={18} /></button>
    </div>
    {columns.slice(1).map((column) => {
      const applies = cellState(sheet, column, row).kind !== 'none'
      const selected = selectedColumn === column.id
      return <div
        key={column.id}
        role="gridcell"
        id={cellId({ rowId: row.id, columnId: column.id })}
        aria-selected={selected}
        aria-readonly={!applies}
        onMouseDown={() => select(column)}
        onDoubleClick={(event) => {
          const onBox = event.target instanceof Element && event.target.closest('[role="checkbox"]') !== null
          if (applies && !onBox) events.current?.handlers.editCell(row, column, null)
        }}
        style={{ width: columnWidth(column), borderColor: LINE }}
        className={cn('flex shrink-0 flex-col justify-center overflow-hidden border-r px-2.5', selected && ring)}
      ><CellBody
        sheet={sheet}
        column={column}
        row={row}
        today={today}
        onToggle={(event) => {
          if (event.detail > 1) return
          events.current?.handlers.toggleCell(row, column)
        }}
      /></div>
    })}
  </div>
})

function HeaderCell({ column, sort, sortCount, width, active, pinned = false, onOpen }: {
  column: SheetColumn
  sort: { index: number; sort: SheetSort } | null
  sortCount: number
  width: number
  active: boolean
  /** The Name column's header, which stays put while the others scroll under it. */
  pinned?: boolean
  onOpen: (at: MenuAnchor) => void
}): React.ReactElement {
  const Icon = COLUMN_TYPE_ICONS[column.type]
  const Arrow = sort?.sort.direction === 'desc' ? ArrowDown : ArrowUp
  return <button
    type="button"
    role="columnheader"
    aria-label={`${column.name} column`}
    title="Opens the column menu"
    onClick={(event) => onOpen(anchorBelow(event.currentTarget, 'start'))}
    onContextMenu={(event) => {
      event.preventDefault()
      onOpen({ x: event.clientX, y: event.clientY })
    }}
    style={{ width, height: HEADER_HEIGHT, borderColor: pinned ? PINNED_LINE : LINE }}
    className={cn('flex shrink-0 items-center border-r px-2.5 text-left transition-colors hover:bg-surface-800 active:bg-surface-800',
      active ? 'bg-surface-900' : 'bg-[#141414]', pinned && 'sticky left-0 z-10')}
  >
    <Icon color="#737373" size={14} />
    <span className={cn('ml-1.5 flex-1 truncate text-[13px] font-semibold', active ? 'text-white' : 'text-surface-200')}>{column.name}</span>
    {sort && <span className="ml-1 flex items-center">
      <Arrow color="#fafafa" size={13} />
      {sortCount > 1 && <span className="text-[10px] font-bold text-white">{sort.index + 1}</span>}
    </span>}
  </button>
}

/** Scrolls just enough to show a cell that is under the pinned header or Name column, or off screen. */
function reveal(scroller: HTMLElement, cell: HTMLElement, pinnedLeft: number): void {
  const box = scroller.getBoundingClientRect()
  const rect = cell.getBoundingClientRect()
  const top = box.top + HEADER_HEIGHT
  const bottom = box.top + scroller.clientHeight
  if (rect.top < top) scroller.scrollTop -= top - rect.top
  else if (rect.bottom > bottom) scroller.scrollTop += rect.bottom - bottom
  if (pinnedLeft === 0) return
  const left = box.left + pinnedLeft
  const right = box.left + scroller.clientWidth
  if (rect.left < left) scroller.scrollLeft -= left - rect.left
  else if (rect.right > right) scroller.scrollLeft += rect.right - right
}

export interface GridScroll {
  top: number
  left: number
}

/**
 * The grid scrolls both ways inside one box. The header row and the Name column are sticky, so
 * they stay put while everything else moves. One cell is selected at a time, and the keyboard
 * works it the way a spreadsheet does. `scroller` is the box itself, which takes focus.
 */
export function Grid({ sheet, columns, items, today, empty, selected, handlers, scroller, initialScroll, onScroll }: {
  sheet: SheetRecord
  columns: readonly SheetColumn[]
  items: readonly GridItem<SheetRowRecord>[]
  today: Date
  empty: React.ReactNode
  selected: CellRef | null
  handlers: GridHandlers
  scroller: React.RefObject<HTMLDivElement | null>
  /** Where the grid was when this sheet was last open. */
  initialScroll: GridScroll
  onScroll: (scroll: GridScroll) => void
}): React.ReactElement {
  const [viewportWidth, setViewportWidth] = useState(0)
  const [focused, setFocused] = useState(false)
  const prefix = useId()
  const cellId = useRef((cell: CellRef): string => `${prefix}-${cell.rowId}-${cell.columnId}`).current
  const focusGrid = useRef((): void => scroller.current?.focus({ preventScroll: true })).current
  const events = useRef<RowEvents>({ handlers, focusGrid })
  events.current = { handlers, focusGrid }

  const rest = columns.slice(1)
  const rows = items.flatMap((item) => item.kind === 'row' ? [item.row] : [])
  const rowIds = rows.map((row) => row.id)
  const columnIds = columns.map((column) => column.id)
  const current = selected && rowIds.includes(selected.rowId) && columnIds.includes(selected.columnId) ? selected : null
  const sorts = sheet.view.sorts
  const sortOf = (column: SheetColumn): { index: number; sort: SheetSort } | null => {
    const index = sorts.findIndex((sort) => sort.columnId === column.id)
    return index < 0 ? null : { index, sort: sorts[index] }
  }

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    element.scrollTop = initialScroll.top
    element.scrollLeft = initialScroll.left
  }, [])

  /** The restored selection was on screen when the sheet was left, so the restored scroll stands. */
  const revealed = useRef(current ? cellId(current) : null)
  useLayoutEffect(() => {
    if (!current) revealed.current = null
    if (!current || !scroller.current || cellId(current) === revealed.current) return
    revealed.current = cellId(current)
    const cell = document.getElementById(cellId(current))
    if (cell) reveal(scroller.current, cell, current.columnId === columnIds[0] ? 0 : NAME_WIDTH)
  }, [current?.rowId, current?.columnId])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return
    const move = gridMove(event)
    if (move) {
      event.preventDefault()
      const page = Math.max(1, Math.floor((event.currentTarget.clientHeight - HEADER_HEIGHT) / ROW_HEIGHT) - 1)
      const next = moveSelection(rowIds, columnIds, current, move, page)
      if (next) handlers.select(next)
      return
    }
    if (!current) return
    const row = rows.find((item) => item.id === current.rowId)
    const column = columns.find((item) => item.id === current.columnId)
    if (!row || !column) return
    const isName = column.id === columnIds[0]
    const applies = !isName && cellState(sheet, column, row).kind !== 'none'
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault()
      if (isName) handlers.openRow(row)
      else if (applies) handlers.editCell(row, column, null)
    } else if (event.key === ' ') {
      event.preventDefault()
      if (!applies) return
      if (column.type === 'checkbox') handlers.toggleCell(row, column)
      else handlers.editCell(row, column, null)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      if (applies && row.cells[column.id] !== undefined) handlers.clearCell(row, column)
    } else if (event.key === 'Escape') {
      handlers.select(null)
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const cell = document.getElementById(cellId(current))
      if (cell) handlers.rowMenu(row, anchorBelow(cell, 'start'))
    } else {
      const typed = typedKey(event)
      if (typed === null || !applies || !isTypedColumn(column.type)) return
      event.preventDefault()
      handlers.editCell(row, column, typed)
    }
  }

  const header = <div role="row" style={{ height: HEADER_HEIGHT, backgroundColor: HEADER, borderColor: PINNED_LINE }} className="sticky top-0 z-20 flex border-b">
    <HeaderCell
      column={columns[0]}
      sort={sortOf(columns[0])}
      sortCount={sorts.length}
      width={NAME_WIDTH}
      active={current?.columnId === columns[0].id}
      pinned
      onOpen={(at) => {
        focusGrid()
        handlers.columnMenu(columns[0], at)
      }}
    />
    {rest.map((column) => <HeaderCell
      key={column.id}
      column={column}
      sort={sortOf(column)}
      sortCount={sorts.length}
      width={columnWidth(column)}
      active={current?.columnId === column.id}
      onOpen={(at) => {
        focusGrid()
        handlers.columnMenu(column, at)
      }}
    />)}
    <button
      type="button"
      aria-label="Add a column"
      title="Add a column"
      onClick={() => {
        focusGrid()
        handlers.addColumn()
      }}
      style={{ width: ADD_WIDTH, height: HEADER_HEIGHT }}
      className="flex shrink-0 items-center justify-center hover:bg-surface-800 active:bg-surface-800"
    ><Plus color="#d4d4d4" size={20} /></button>
  </div>

  return <div
    ref={scroller}
    role="grid"
    tabIndex={0}
    aria-label={sheet.name}
    aria-activedescendant={current ? cellId(current) : undefined}
    onKeyDown={onKeyDown}
    onScroll={(event) => onScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}
    onFocus={(event) => { if (event.target === event.currentTarget) setFocused(true) }}
    onBlur={(event) => { if (event.target === event.currentTarget) setFocused(false) }}
    className="min-h-0 flex-1 select-none overflow-auto outline-none"
  >
    <div className="w-max min-w-full pb-28">
      {header}
      {items.map((item) => {
        if (item.kind === 'row') {
          const here = current?.rowId === item.row.id ? current.columnId : null
          return <GridRow
            key={item.row.id}
            sheet={sheet}
            columns={columns}
            row={item.row}
            today={today}
            cellId={cellId}
            selectedColumn={here}
            focused={here !== null && focused}
            events={events}
          />
        }
        const Chevron = item.collapsed ? ChevronRight : ChevronDown
        return <div key={`section:${item.key}`} role="row" style={{ height: SECTION_HEIGHT, backgroundColor: '#101010', borderColor: LINE }} className="flex border-b">
          <button
            type="button"
            aria-expanded={!item.collapsed}
            aria-label={`${item.title}, ${item.count} ${item.count === 1 ? 'row' : 'rows'}`}
            onClick={() => handlers.toggleSection(item.key)}
            className="sticky left-0 flex h-full items-center px-3 hover:bg-surface-900"
          >
            <Chevron color="#a3a3a3" size={18} />
            <span className="ml-2 flex">
              {item.option ? <OptionPill option={item.option} /> : <span className="text-[14px] font-semibold text-surface-300">{item.title}</span>}
            </span>
            <span className="ml-2 text-[13px] font-semibold text-surface-500">{item.count}</span>
          </button>
        </div>
      })}
      {items.length === 0 && <div className="sticky left-0" style={{ width: viewportWidth || undefined }}>{empty}</div>}
    </div>
  </div>
}
