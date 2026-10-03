import React, { useEffect, useState } from 'react'
import { CalendarDays, Check, Eye, Plus, X } from 'lucide-react'
import type { SheetRecord } from '@ego/api-contracts'
import {
  SHEET_FILTER_LIMIT, SHEET_FILTER_TEXT_LIMIT, SHEET_SORT_LIMIT, parseSheetNumber,
  type SheetColumn, type SheetFilter, type SheetFilterOperator, type SheetSort
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { OPERATOR_LABELS, dateLabel, operatorTakesValue, operatorsFor, sortLabels } from '@ego/local/sheets/view'
import { newId } from '@ego/local/sync/commands'
import { useSheets } from '../../lib/sheets/context'
import { cn } from '../../lib/utils'
import { CalendarDialog } from '../DatePicker'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { COLUMN_TYPE_ICONS, OptionPill } from './ui'

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onPress}
    className={cn('flex min-h-10 items-center justify-center rounded-lg border px-3 text-[14px] font-semibold transition-colors',
      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface-900 text-surface-200 hover:bg-surface-800')}
  >{label}</button>
}

function ColumnRow({ column, onPress, right }: { column: SheetColumn; onPress: () => void; right?: React.ReactNode }): React.ReactElement {
  const Icon = COLUMN_TYPE_ICONS[column.type]
  return <button
    type="button"
    onClick={onPress}
    className="flex min-h-14 w-full items-center border-b border-surface-900 text-left hover:bg-surface-900 active:bg-surface-900"
  >
    <Icon color="#a3a3a3" size={18} />
    <span className="ml-3 flex-1 truncate text-[17px] text-foreground">{column.name}</span>
    {right}
  </button>
}

function CloseIcon({ label, onPress }: { label: string; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onPress}
    className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-800"
  ><X color="#a3a3a3" size={18} /></button>
}

function ColumnPicker({ columns, onPick, onCancel }: {
  columns: readonly SheetColumn[]
  onPick: (column: SheetColumn) => void
  onCancel: () => void
}): React.ReactElement {
  return <div className="mt-2 rounded-2xl border border-surface-800 px-4 pb-2 pt-3">
    <div className="mb-1 flex items-center">
      <p className="flex-1 text-[13px] font-semibold uppercase tracking-wide text-surface-500">Choose a column</p>
      <CloseIcon label="Cancel" onPress={onCancel} />
    </div>
    {columns.map((column) => <ColumnRow key={column.id} column={column} onPress={() => onPick(column)} />)}
    {columns.length === 0 && <p className="py-3 text-[15px] text-surface-500">No columns left to add.</p>}
  </div>
}

/** Keeps a draft while open and saves it once on close, so a typed filter is one sync, not one per letter. */
function useViewDraft<T>(visible: boolean, saved: T): [T, (next: T) => void] {
  const [draft, setDraft] = useState(saved)
  useEffect(() => { if (visible) setDraft(saved) }, [visible])
  return [draft, setDraft]
}

export function SortSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [sorts, setSorts] = useViewDraft<SheetSort[]>(visible, sheet.view.sorts)
  const [picking, setPicking] = useState(false)
  const close = (): void => {
    setPicking(false)
    onClose()
    if (JSON.stringify(sorts) !== JSON.stringify(sheet.view.sorts)) {
      void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, sorts } }))
    }
  }
  const unused = sheet.columns.filter((column) => !sorts.some((sort) => sort.columnId === column.id))
  return <Sheet visible={visible} title="Sort" onClose={close} footer={<Button size="lg" className="w-full" onClick={close}>Done</Button>}>
    {sorts.length === 0 && <p className="mb-2 text-[15px] leading-6 text-surface-400">Unsorted rows show newest first.</p>}
    {sorts.map((sort, index) => {
      const column = sheet.columns.find((item) => item.id === sort.columnId)
      if (!column) return null
      const labels = sortLabels(column.type)
      return <div key={sort.columnId} className="mb-3 rounded-2xl border border-surface-800 p-3">
        <div className="flex items-center">
          <span className="text-[13px] font-semibold uppercase tracking-wide text-surface-500">{index === 0 ? 'Sort by' : 'Then by'}</span>
          <span className="ml-2 flex-1 truncate text-[16px] font-semibold text-foreground">{column.name}</span>
          <CloseIcon label={`Stop sorting by ${column.name}`} onPress={() => setSorts(sorts.filter((_, at) => at !== index))} />
        </div>
        <div role="radiogroup" className="mt-3 flex gap-2">
          {(['asc', 'desc'] as const).map((direction) => <Choice
            key={direction}
            label={labels[direction]}
            selected={sort.direction === direction}
            onPress={() => setSorts(sorts.map((item, at) => at === index ? { ...item, direction } : item))}
          />)}
        </div>
      </div>
    })}
    {picking
      ? <ColumnPicker columns={unused} onCancel={() => setPicking(false)} onPick={(column) => {
        setSorts([...sorts, { columnId: column.id, direction: 'asc' }])
        setPicking(false)
      }} />
      : sorts.length < SHEET_SORT_LIMIT && <Button variant="outline" className="mt-1 w-full" onClick={() => setPicking(true)}>
        <Plus color="#fafafa" size={18} />{sorts.length === 0 ? 'Add a sort' : 'Then by another column'}
      </Button>}
  </Sheet>
}

function FilterValue({ column, filter, onChange }: {
  column: SheetColumn
  filter: SheetFilter
  onChange: (value: SheetFilter['value']) => void
}): React.ReactElement | null {
  const [picking, setPicking] = useState(false)
  const [number, setNumber] = useState(typeof filter.value === 'number' ? String(filter.value) : '')
  if (!operatorTakesValue(filter.operator)) return null
  if (column.type === 'dropdown' || column.type === 'tags') {
    const chosen = Array.isArray(filter.value) ? filter.value : []
    return <div className="mt-3 flex flex-wrap gap-2">
      {column.options.map((option) => {
        const on = chosen.includes(option.id)
        return <button
          key={option.id}
          type="button"
          role="checkbox"
          aria-checked={on}
          aria-label={option.name}
          onClick={() => onChange(on ? chosen.filter((id) => id !== option.id) : [...chosen, option.id])}
          className={cn('flex max-w-full items-center rounded-full border-2 p-0.5', on ? 'border-white' : 'border-transparent hover:border-surface-700')}
        >
          <OptionPill option={option} large />
        </button>
      })}
      {column.options.length === 0 && <p className="text-[15px] text-surface-500">This column has no options yet.</p>}
    </div>
  }
  if (column.type === 'date') {
    const iso = typeof filter.value === 'string' ? filter.value : null
    return <>
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="mt-3 flex min-h-12 w-full items-center rounded-xl border border-input bg-surface-900 px-4 text-left hover:bg-surface-800 active:bg-surface-800"
      >
        <CalendarDays color="#a3a3a3" size={18} />
        <span className={cn('ml-3 text-[16px]', iso ? 'text-foreground' : 'text-surface-500')}>{iso ? dateLabel(iso, new Date()) : 'Pick a date'}</span>
      </button>
      <CalendarDialog visible={picking} value={iso ?? isoToday()} onCancel={() => setPicking(false)} onConfirm={(next) => {
        setPicking(false)
        onChange(next)
      }} />
    </>
  }
  if (column.type === 'number') {
    return <input
      value={number}
      onChange={(event) => {
        setNumber(event.target.value)
        onChange(parseSheetNumber(event.target.value))
      }}
      inputMode="decimal"
      placeholder="A number"
      aria-label="Number to compare"
      className={cn(inputClass, 'mt-3')}
    />
  }
  return <input
    value={typeof filter.value === 'string' ? filter.value : ''}
    onChange={(event) => onChange(event.target.value)}
    placeholder="Text"
    aria-label="Text to compare"
    spellCheck={false}
    maxLength={SHEET_FILTER_TEXT_LIMIT}
    className={cn(inputClass, 'mt-3')}
  />
}

export function FilterSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [filters, setFilters] = useViewDraft<SheetFilter[]>(visible, sheet.view.filters)
  const [picking, setPicking] = useState(false)
  const close = (): void => {
    setPicking(false)
    onClose()
    if (JSON.stringify(filters) !== JSON.stringify(sheet.view.filters)) {
      void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, filters } }))
    }
  }
  const change = (id: string, patch: Partial<SheetFilter>): void => setFilters(filters.map((filter) => filter.id === id ? { ...filter, ...patch } : filter))
  return <Sheet visible={visible} title="Filter" onClose={close} footer={<Button size="lg" className="w-full" onClick={close}>Done</Button>}>
    {filters.length === 0 && <p className="mb-2 text-[15px] leading-6 text-surface-400">Show only the rows that match every filter.</p>}
    {filters.map((filter) => {
      const column = sheet.columns.find((item) => item.id === filter.columnId)
      if (!column) return null
      return <div key={filter.id} className="mb-3 rounded-2xl border border-surface-800 p-3">
        <div className="flex items-center">
          <span className="flex-1 truncate text-[16px] font-semibold text-foreground">{column.name}</span>
          <CloseIcon label={`Remove the ${column.name} filter`} onPress={() => setFilters(filters.filter((item) => item.id !== filter.id))} />
        </div>
        <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">
          {operatorsFor(column.type).map((operator: SheetFilterOperator) => <Choice
            key={operator}
            label={OPERATOR_LABELS[operator]}
            selected={filter.operator === operator}
            onPress={() => change(filter.id, {
              operator,
              value: operatorTakesValue(operator) === operatorTakesValue(filter.operator) ? filter.value : null
            })}
          />)}
        </div>
        <FilterValue key={filter.operator} column={column} filter={filter} onChange={(value) => change(filter.id, { value })} />
      </div>
    })}
    {picking
      ? <ColumnPicker columns={sheet.columns} onCancel={() => setPicking(false)} onPick={(column) => {
        setFilters([...filters, { id: newId(), columnId: column.id, operator: operatorsFor(column.type)[0], value: null }])
        setPicking(false)
      }} />
      : filters.length < SHEET_FILTER_LIMIT && <Button variant="outline" className="mt-1 w-full" onClick={() => setPicking(true)}>
        <Plus color="#fafafa" size={18} />Add a filter
      </Button>}
    {filters.length > 0 && <Button variant="ghost" className="mt-2 w-full" onClick={() => setFilters([])}>Clear all filters</Button>}
  </Sheet>
}

export function GroupSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const dropdowns = sheet.columns.filter((column) => column.type === 'dropdown')
  const pick = (groupBy: string | null): void => {
    onClose()
    if (groupBy !== sheet.view.groupBy) void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, groupBy } }))
  }
  const tick = <Check color="#fafafa" size={20} strokeWidth={2.5} />
  return <Sheet visible={visible} title="Group by" onClose={onClose} dismissOnBackdrop>
    <button
      type="button"
      role="radio"
      aria-checked={sheet.view.groupBy === null}
      onClick={() => pick(null)}
      className="flex min-h-14 w-full items-center border-b border-surface-900 text-left hover:bg-surface-900 active:bg-surface-900"
    >
      <span className="flex-1 text-[17px] text-foreground">No grouping</span>
      {sheet.view.groupBy === null && tick}
    </button>
    {dropdowns.map((column) => <ColumnRow key={column.id} column={column} onPress={() => pick(column.id)} right={sheet.view.groupBy === column.id ? tick : undefined} />)}
    {dropdowns.length === 0 && <p className="mt-3 text-[15px] leading-6 text-surface-400">Grouping splits the grid by a dropdown column. This sheet has none yet.</p>}
  </Sheet>
}

export function HiddenSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const hidden = sheet.columns.filter((column) => column.hidden)
  const show = (columnId: string): void => {
    if (hidden.length === 1) onClose()
    void sheets.updateSheet(sheet.id, (input) => ({
      ...input, columns: input.columns.map((column) => column.id === columnId ? { ...column, hidden: false } : column)
    }))
  }
  return <Sheet visible={visible} title="Hidden columns" onClose={onClose} dismissOnBackdrop>
    <p className="mb-2 text-[15px] leading-6 text-surface-400">Hidden columns stay on each row’s page.</p>
    {hidden.map((column) => <ColumnRow key={column.id} column={column} onPress={() => show(column.id)} right={<span className="flex items-center">
      <Eye color="#d4d4d4" size={18} /><span className="ml-2 text-[15px] font-semibold text-surface-200">Show</span>
    </span>} />)}
    {hidden.length === 0 && <p className="text-[15px] text-surface-500">Nothing is hidden.</p>}
  </Sheet>
}
