import React, { useEffect, useId, useRef, useState } from 'react'
import { CalendarDays, ChevronRight, X } from 'lucide-react'
import {
  SHEET_COLUMN_TYPE_LABELS, SHEET_TEXT_LIMIT, cellFits, cellText, isEmptyCell, parseSheetNumber,
  type SheetCellValue, type SheetColumn
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { dateLabel, optionOf } from '@ego/local/sheets/view'
import { CalendarDialog } from '../DatePicker'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { Switch } from '../ui/switch'
import { ContactActions, OptionList } from './OptionList'
import { FieldLabel, OptionPill, UNFIT } from './ui'

const INPUT_MODES: Partial<Record<SheetColumn['type'], React.HTMLAttributes<HTMLInputElement>['inputMode']>> = {
  phone: 'tel', email: 'email', link: 'url', number: 'decimal'
}

export function inputProps(column: SheetColumn): { inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; spellCheck: boolean } {
  return { inputMode: INPUT_MODES[column.type], spellCheck: column.type === 'text' || column.type === 'longText' }
}

function textOf(column: SheetColumn, value: SheetCellValue | undefined): string {
  if (value === undefined) return ''
  if (typeof value === 'number') return String(value)
  return cellText(column, value)
}

/**
 * A typed field. A new row's form passes `live` and gets every keystroke; a saved row gets one
 * save when the field loses focus or the page goes away.
 */
function TypedField({ id, column, value, live, onCommit }: {
  id: string
  column: SheetColumn
  value: SheetCellValue | undefined
  live: boolean
  onCommit: (value: SheetCellValue | null) => void
}): React.ReactElement {
  const [text, setText] = useState(() => textOf(column, value))
  const [invalid, setInvalid] = useState(false)
  const latest = useRef({ text, saved: textOf(column, value), onCommit })
  latest.current = { text, saved: textOf(column, value), onCommit }

  const savedText = textOf(column, value)
  useEffect(() => { if (!live) setText(savedText) }, [live, savedText])

  const parse = (raw: string): { ok: boolean; value: SheetCellValue | null } => {
    const trimmed = column.type === 'longText' ? raw.replace(/\s+$/, '') : raw.trim()
    if (trimmed === '') return { ok: true, value: null }
    if (column.type !== 'number') return { ok: true, value: trimmed }
    const number = parseSheetNumber(trimmed)
    return number === null ? { ok: false, value: null } : { ok: true, value: number }
  }

  const commit = (): void => {
    const { text: current, saved } = latest.current
    if (current.trim() === saved.trim()) return
    const parsed = parse(current)
    if (!parsed.ok) {
      setInvalid(true)
      return
    }
    latest.current.onCommit(parsed.value)
  }

  useEffect(() => () => { if (!live) commit() }, [])

  const change = (next: string): void => {
    setText(next)
    setInvalid(false)
    if (!live) return
    const parsed = parse(next)
    if (parsed.ok) onCommit(parsed.value)
    else setInvalid(true)
  }
  const shared = {
    id,
    value: text,
    onBlur: live ? undefined : commit,
    placeholder: `Add ${SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}`,
    maxLength: SHEET_TEXT_LIMIT,
    className: inputClass
  }

  return <div>
    {column.type === 'longText'
      ? <textarea {...shared} spellCheck onChange={(event) => change(event.target.value)} style={{ minHeight: 110 }} />
      : <input
        {...shared}
        {...inputProps(column)}
        onChange={(event) => change(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !live) event.currentTarget.blur() }}
      />}
    {invalid && <p style={{ color: UNFIT }} className="mt-2 text-[14px]">That isn’t a number.</p>}
    {(column.type === 'phone' || column.type === 'email' || column.type === 'link') && text.trim() !== '' &&
      <div className="mt-2"><ContactActions type={column.type} value={text} /></div>}
  </div>
}

function DateField({ id, column, value, onCommit }: {
  id: string
  column: SheetColumn
  value: SheetCellValue | undefined
  onCommit: (value: SheetCellValue | null) => void
}): React.ReactElement {
  const [picking, setPicking] = useState(false)
  const iso = typeof value === 'string' && cellFits(column, value) ? value : null
  return <div className="flex items-center gap-2">
    <button
      id={id}
      type="button"
      aria-label={`${column.name}: ${iso ? dateLabel(iso, new Date()) : 'no date'}`}
      onClick={() => setPicking(true)}
      className="flex min-h-[52px] flex-1 items-center rounded-xl border border-input bg-surface-900 px-4 text-left hover:bg-surface-800 active:bg-surface-800"
    >
      <CalendarDays color="#a3a3a3" size={18} />
      <span className={`ml-3 text-[17px] ${iso ? 'text-foreground' : 'text-surface-600'}`}>{iso ? dateLabel(iso, new Date()) : 'Pick a date'}</span>
    </button>
    {value !== undefined && <button
      type="button"
      aria-label={`Clear ${column.name}`}
      title="Clear"
      onClick={() => onCommit(null)}
      className="flex h-[52px] w-12 items-center justify-center rounded-xl hover:bg-surface-800 active:bg-surface-800"
    ><X color="#a3a3a3" size={18} /></button>}
    <CalendarDialog
      visible={picking}
      value={iso ?? isoToday()}
      onCancel={() => setPicking(false)}
      onConfirm={(next) => {
        setPicking(false)
        onCommit(next)
      }}
    />
  </div>
}

function OptionField({ id, column, value, onCommit, onCreate }: {
  id: string
  column: SheetColumn
  value: SheetCellValue | undefined
  onCommit: (value: SheetCellValue | null) => void
  onCreate: (name: string) => Promise<string | null>
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const selected = column.type === 'dropdown'
    ? typeof value === 'string' ? [value] : []
    : Array.isArray(value) ? value : []
  const options = selected.flatMap((optionId) => {
    const option = optionOf(column, optionId)
    return option ? [option] : []
  })
  const toggle = (optionId: string): void => {
    if (column.type === 'dropdown') {
      onCommit(selected.includes(optionId) ? null : optionId)
      setOpen(false)
      return
    }
    onCommit(selected.includes(optionId) ? selected.filter((item) => item !== optionId) : [...selected, optionId])
  }
  return <>
    <button
      id={id}
      type="button"
      aria-label={`${column.name}: ${options.map((option) => option.name).join(', ') || 'none'}`}
      onClick={() => setOpen(true)}
      className="flex min-h-[52px] w-full items-center rounded-xl border border-input bg-surface-900 px-3 py-2 text-left hover:bg-surface-800 active:bg-surface-800"
    >
      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {options.length > 0
          ? options.map((option) => <OptionPill key={option.id} option={option} large />)
          : <span className="px-1 text-[17px] text-surface-600">{column.type === 'tags' ? 'Choose tags' : 'Choose an option'}</span>}
      </span>
      <ChevronRight color="#737373" size={18} />
    </button>
    <Sheet visible={open} title={column.name} onClose={() => setOpen(false)}>
      <OptionList
        column={column}
        selected={selected}
        onToggle={toggle}
        onCreate={(name) => void onCreate(name).then((created) => {
          if (!created) return
          onCommit(column.type === 'dropdown' ? created : [...selected, created])
          if (column.type === 'dropdown') setOpen(false)
        })}
      />
    </Sheet>
  </>
}

/** One column of a row, as the row's page shows it. */
export function Field({ column, value, live, onCommit, onCreateOption }: {
  column: SheetColumn
  value: SheetCellValue | undefined
  live: boolean
  onCommit: (value: SheetCellValue | null) => void
  onCreateOption: (name: string) => Promise<string | null>
}): React.ReactElement {
  const id = useId()
  const unfit = value !== undefined && !isEmptyCell(value) && !cellFits(column, value)
  return <div className="mb-5">
    <FieldLabel type={column.type} name={column.name} htmlFor={column.type === 'checkbox' ? undefined : id} />
    {unfit && <p style={{ color: UNFIT }} className="mb-2 text-[14px] leading-5">
      “{cellText(column, value) || 'A removed option'}” doesn’t fit {SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}.
    </p>}
    {column.type === 'date' && <DateField id={id} column={column} value={value} onCommit={onCommit} />}
    {column.type === 'checkbox' && <div className="flex min-h-[52px] items-center rounded-xl border border-input bg-surface-900 px-4">
      <span className="flex-1 text-[17px] text-foreground">{value === true ? 'Checked' : 'Not checked'}</span>
      <Switch checked={value === true} onCheckedChange={(on) => onCommit(on ? true : null)} label={column.name} />
    </div>}
    {(column.type === 'dropdown' || column.type === 'tags') &&
      <OptionField id={id} column={column} value={value} onCommit={onCommit} onCreate={onCreateOption} />}
    {column.type !== 'date' && column.type !== 'checkbox' && column.type !== 'dropdown' && column.type !== 'tags' &&
      <TypedField id={id} column={column} value={value} live={live} onCommit={onCommit} />}
  </div>
}
