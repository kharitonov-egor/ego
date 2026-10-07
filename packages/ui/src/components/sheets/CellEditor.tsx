import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  SHEET_COLUMN_TYPE_LABELS, SHEET_TEXT_LIMIT, parseSheetNumber,
  type SheetCellValue, type SheetColumn
} from '@ego/core'
import { isoToday } from '@ego/local/dates'
import { cellState, dateLabel, numberLabel, rowName } from '@ego/local/sheets/view'
import { useSheets } from '../../lib/sheets/context'
import { CalendarDialog } from '../DatePicker'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { Switch } from '../ui/switch'
import { inputProps } from './Fields'
import { ContactActions, OptionList } from './OptionList'
import { UNFIT } from './ui'

const TYPED: readonly SheetColumn['type'][] = ['text', 'longText', 'number', 'phone', 'email', 'link']

export function isTypedColumn(type: SheetColumn['type']): boolean {
  return TYPED.includes(type)
}

/** What goes in the text box: the stored value, or the text of one that does not fit. */
function draftOf(sheet: SheetRecord, column: SheetColumn, row: SheetRowRecord): string {
  const state = cellState(sheet, column, row)
  if (state.kind === 'mismatch') return state.text
  if (state.kind !== 'value') return ''
  if (typeof state.value === 'number') return String(state.value)
  return typeof state.value === 'string' ? state.value : ''
}

/**
 * Edits one cell in a sheet over the grid. Typed values save on Done, the close button, or the
 * arrows, and Escape drops them; picks and switches save as they are clicked. Enter moves on to
 * the next cell and Shift+Enter back, the way the phone's return key does.
 */
export function CellEditor({ sheet, row, column, seed, onClose, onStep }: {
  sheet: SheetRecord
  row: SheetRowRecord | null
  column: SheetColumn | null
  /** A key typed on the grid, which replaces the value the way a spreadsheet starts an edit. */
  seed: string | null
  onClose: () => void
  onStep: ((direction: -1 | 1) => void) | null
}): React.ReactElement | null {
  const sheets = useSheets()
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [picking, setPicking] = useState(false)
  const key = row && column ? `${row.id}:${column.id}` : null
  const opened = useRef<string | null>(null)
  const control = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!row || !column || opened.current === key) return
    opened.current = key
    setDraft(seed ?? draftOf(sheet, column, row))
    setInvalid(false)
  }, [column, key, row, seed, sheet])
  useEffect(() => { if (!key) opened.current = null }, [key])
  useEffect(() => {
    if (!key) return
    // After the sheet's own focus on open, which remembers what to give focus back to on close.
    const timer = setTimeout(() => control.current?.querySelector<HTMLElement>('input, textarea, button')?.focus())
    return () => clearTimeout(timer)
  }, [key])

  if (!row || !column) return null

  const state = cellState(sheet, column, row)
  const stored = row.cells[column.id]
  const typed = isTypedColumn(column.type)

  /** Saves a typed draft. False keeps the sheet open on a number that does not read as one. */
  const saveDraft = (): boolean => {
    if (!typed) return true
    const text = column.type === 'longText' ? draft.replace(/\s+$/, '') : draft.trim()
    if (text === draftOf(sheet, column, row).trim()) return true
    let value: SheetCellValue | null = text === '' ? null : text
    if (column.type === 'number' && text !== '') {
      value = parseSheetNumber(text)
      if (value === null) {
        setInvalid(true)
        return false
      }
    }
    void sheets.setCell(row.id, column.id, value)
    return true
  }

  const close = (): void => {
    if (saveDraft()) onClose()
  }

  const step = (direction: -1 | 1): void => {
    if (!saveDraft() || !onStep) return
    opened.current = null
    onStep(direction)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (column.type === 'longText' && !event.ctrlKey) return
    event.preventDefault()
    if (onStep) step(event.shiftKey ? -1 : 1)
    else close()
  }

  const selected = column.type === 'dropdown'
    ? typeof stored === 'string' ? [stored] : []
    : Array.isArray(stored) ? stored : []

  const choose = (optionId: string): void => {
    if (column.type === 'dropdown') {
      void sheets.setCell(row.id, column.id, selected.includes(optionId) ? null : optionId)
      return
    }
    void sheets.setCell(row.id, column.id, selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId])
  }

  const create = async (name: string): Promise<void> => {
    const id = await sheets.addOption(sheet.id, column.id, name)
    if (!id) return
    void sheets.setCell(row.id, column.id, column.type === 'dropdown' ? id : [...selected, id])
  }

  const name = rowName(sheet, row) || 'Untitled'
  const shared = {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(event.target.value)
      setInvalid(false)
    },
    onKeyDown,
    onFocus: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const end = event.target.value.length
      event.target.setSelectionRange(end, end)
    },
    placeholder: `Add ${SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}`,
    'aria-label': column.name,
    maxLength: SHEET_TEXT_LIMIT,
    className: inputClass
  }

  return <Sheet
    visible
    title={column.name}
    onClose={close}
    onEscape={onClose}
    footer={<div className="flex items-center gap-2">
      {onStep && <button type="button" aria-label="Previous cell" title="Previous cell (Shift+Enter)" onClick={() => step(-1)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-input hover:bg-surface-800 active:bg-surface-800">
        <ChevronLeft color="#fafafa" size={22} />
      </button>}
      <Button size="lg" className="flex-1" onClick={close}>Done</Button>
      {onStep && <button type="button" aria-label="Next cell" title="Next cell (Enter)" onClick={() => step(1)} className="flex h-12 w-12 items-center justify-center rounded-2xl border border-input hover:bg-surface-800 active:bg-surface-800">
        <ChevronRight color="#fafafa" size={22} />
      </button>}
    </div>}
  >
    <p className="-mt-2 mb-4 truncate text-[15px] text-surface-400">{name} · {SHEET_COLUMN_TYPE_LABELS[column.type]}</p>
    {state.kind === 'mismatch' && <div className="mb-4 rounded-2xl border border-red-400/40 px-4 py-3">
      <p style={{ color: UNFIT }} className="text-[15px] leading-5">
        “{state.text}” doesn’t fit {SHEET_COLUMN_TYPE_LABELS[column.type].toLowerCase()}. Change it, or clear it.
      </p>
    </div>}

    {typed && <div ref={control}>
      {column.type === 'longText'
        ? <textarea key={key} {...shared} spellCheck style={{ minHeight: 150 }} />
        : <input key={key} {...shared} {...inputProps(column)} />}
      {invalid && <p style={{ color: UNFIT }} className="mt-2 text-[14px]">That isn’t a number.</p>}
      {column.type === 'number' && !invalid && draft.trim() !== '' && parseSheetNumber(draft) !== null &&
        <p className="mt-2 text-[14px] text-surface-500">Saves as {numberLabel(parseSheetNumber(draft) ?? 0)}</p>}
      <div className="mt-3"><ContactActions type={column.type} value={draft} /></div>
    </div>}

    {column.type === 'date' && <div ref={control}>
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="flex min-h-14 w-full items-center rounded-2xl border border-input bg-surface-900 px-4 text-left hover:bg-surface-800 active:bg-surface-800"
      >
        <CalendarDays color="#d4d4d4" size={20} />
        <span className="ml-3 flex-1 text-[17px] text-white">
          {state.kind === 'value' && typeof state.value === 'string' ? dateLabel(state.value, new Date()) : 'Pick a date'}
        </span>
      </button>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void sheets.setCell(row.id, column.id, isoToday())}>Today</Button>
        {stored !== undefined && <Button variant="ghost" size="sm" onClick={() => void sheets.setCell(row.id, column.id, null)}><X color="#d4d4d4" size={16} />Clear</Button>}
      </div>
      <CalendarDialog
        visible={picking}
        value={state.kind === 'value' && typeof state.value === 'string' ? state.value : isoToday()}
        onCancel={() => setPicking(false)}
        onConfirm={(iso) => {
          setPicking(false)
          void sheets.setCell(row.id, column.id, iso)
        }}
      />
    </div>}

    {column.type === 'checkbox' && <div ref={control} className="flex min-h-14 items-center rounded-2xl border border-input bg-surface-900 px-4">
      <span className="flex-1 text-[17px] text-white">{stored === true ? 'Checked' : 'Not checked'}</span>
      <Switch checked={stored === true} onCheckedChange={(on) => void sheets.setCell(row.id, column.id, on ? true : null)} label={column.name} />
    </div>}

    {(column.type === 'dropdown' || column.type === 'tags') && <div ref={control}>
      <OptionList key={key} column={column} selected={selected} onToggle={choose} onCreate={(text) => void create(text)} />
      {selected.length > 0 && <Button variant="ghost" size="sm" className="mt-2" onClick={() => void sheets.setCell(row.id, column.id, null)}>
        <X color="#d4d4d4" size={16} />Clear
      </Button>}
    </div>}
  </Sheet>
}
