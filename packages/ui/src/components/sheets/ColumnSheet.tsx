import React, { useEffect, useMemo, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  SHEET_COLUMN_NAME_LIMIT, SHEET_COLUMN_TYPES, SHEET_COLUMN_TYPE_LABELS, SHEET_OPTION_LIMIT, SHEET_OPTION_NAME_LIMIT,
  SHEET_SHADES, nextShade,
  type SheetColumn, type SheetColumnType, type SheetOption
} from '@ego/core'
import { sheetInput, unfitAfter } from '@ego/local/sheets/edits'
import { newId } from '@ego/local/sync/commands'
import { useSheets } from '../../lib/sheets/context'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { COLUMN_TYPE_ICONS, SHADES, UNFIT } from './ui'

function Heading({ children }: { children: string }): React.ReactElement {
  return <h3 className="mb-2 mt-5 text-[15px] font-medium text-surface-200">{children}</h3>
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    onClick={onPress}
    className={cn('flex min-h-11 items-center justify-center rounded-xl border px-3.5 text-[15px] font-semibold transition-colors',
      selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface-900 text-foreground hover:bg-surface-800')}
  >{label}</button>
}

function usedBy(rows: readonly SheetRowRecord[], columnId: string, optionIds: ReadonlySet<string>): number {
  return rows.filter((row) => {
    const value = row.cells[columnId]
    const ids = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    return ids.some((id) => optionIds.has(id))
  }).length
}

/** Adds a column, or edits one: its name, its type, its options, and which row types it applies to. */
export function ColumnSheet({ sheet, column, visible, onClose }: {
  sheet: SheetRecord
  /** Null adds a new column. */
  column: SheetColumn | null
  visible: boolean
  onClose: () => void
}): React.ReactElement {
  const sheets = useSheets()
  const isName = column !== null && sheet.columns[0]?.id === column.id
  const [name, setName] = useState('')
  const [type, setType] = useState<SheetColumnType>('text')
  const [options, setOptions] = useState<SheetOption[]>([])
  const [typeIds, setTypeIds] = useState<string[] | null>(null)
  const [adding, setAdding] = useState('')

  useEffect(() => {
    if (!visible) return
    setName(column?.name ?? '')
    setType(column?.type ?? 'text')
    setOptions(column?.options ?? [])
    setTypeIds(column?.typeIds ?? null)
    setAdding('')
  }, [column, visible])

  const rows = useMemo(() => sheets.data?.rows.filter((row) => row.sheetId === sheet.id) ?? [], [sheet.id, sheets.data])
  const draft: SheetColumn = {
    id: column?.id ?? 'draft',
    name: name.trim(),
    type,
    options: options.map((option) => ({ ...option, name: option.name.trim() })).filter((option) => option.name !== ''),
    typeIds: isName ? null : typeIds,
    hidden: column?.hidden ?? false
  }
  const holdsOptions = type === 'dropdown' || type === 'tags'
  const unfit = column ? unfitAfter(sheetInput(sheet), rows, draft) : 0
  const removed = column ? new Set(column.options.filter((option) => !draft.options.some((kept) => kept.id === option.id)).map((option) => option.id)) : new Set<string>()
  const clearing = column && holdsOptions && removed.size > 0 ? usedBy(rows, column.id, removed) : 0
  const fromText = column !== null && column.type !== 'dropdown' && column.type !== 'tags' && holdsOptions && rows.some((row) => row.cells[column.id] !== undefined)

  const addOption = (): void => {
    const text = adding.trim()
    if (text === '' || options.length >= SHEET_OPTION_LIMIT) return
    if (options.some((option) => option.name.trim().toLowerCase() === text.toLowerCase())) {
      setAdding('')
      return
    }
    setOptions([...options, { id: newId(), name: text, shade: nextShade(options) }])
    setAdding('')
  }

  const save = (): void => {
    if (draft.name === '') return
    const next: SheetColumn = { ...draft, id: column?.id ?? newId() }
    onClose()
    void sheets.saveColumn(sheet.id, next)
  }

  const toggleType = (id: string): void => {
    const current = typeIds ?? []
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    setTypeIds(next.length === 0 || next.length === sheet.rowTypes.length ? null : next)
  }

  return <Sheet
    visible={visible}
    title={column ? 'Edit column' : 'New column'}
    onClose={onClose}
    footer={<Button size="lg" className="w-full" disabled={draft.name === ''} onClick={save}>
      <Check color="#0a0a0a" size={18} />{column ? 'Save column' : 'Add column'}
    </Button>}
  >
    <input
      value={name}
      onChange={(event) => setName(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        save()
      }}
      placeholder="Column name"
      aria-label="Column name"
      maxLength={SHEET_COLUMN_NAME_LIMIT}
      className={inputClass}
    />

    <Heading>Type</Heading>
    {isName
      ? <p className="text-[15px] leading-5 text-surface-400">The first column names each row, so it is always text.</p>
      : <div role="radiogroup" aria-label="Type" className="grid grid-cols-2 gap-2">
        {SHEET_COLUMN_TYPES.map((item) => {
          const Icon = COLUMN_TYPE_ICONS[item]
          const selected = item === type
          return <button
            key={item}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setType(item)}
            className={cn('flex min-h-12 items-center rounded-xl border px-3 text-left transition-colors',
              selected ? 'border-primary bg-primary' : 'border-input bg-surface-900 hover:bg-surface-800')}
          >
            <Icon color={selected ? '#0a0a0a' : '#d4d4d4'} size={18} />
            <span className={cn('ml-2.5 text-[15px] font-semibold', selected ? 'text-primary-foreground' : 'text-foreground')}>{SHEET_COLUMN_TYPE_LABELS[item]}</span>
          </button>
        })}
      </div>}

    {holdsOptions && <>
      <Heading>Options</Heading>
      {options.map((option, index) => {
        const shade = SHADES[option.shade]
        return <div key={option.id} className="mb-2 flex items-center gap-2">
          <button
            type="button"
            aria-label={`Shade for ${option.name || 'this option'}`}
            title="Changes to the next grey"
            onClick={() => setOptions(options.map((item, at) => at === index
              ? { ...item, shade: SHEET_SHADES[(SHEET_SHADES.indexOf(item.shade) + 1) % SHEET_SHADES.length] }
              : item))}
            style={{ backgroundColor: shade.background, borderColor: shade.border }}
            className="h-11 w-11 shrink-0 rounded-full border"
          />
          <input
            value={option.name}
            onChange={(event) => setOptions(options.map((item, at) => at === index ? { ...item, name: event.target.value } : item))}
            aria-label="Option name"
            maxLength={SHEET_OPTION_NAME_LIMIT}
            className={cn(inputClass, 'flex-1')}
          />
          <button
            type="button"
            aria-label={`Delete ${option.name || 'option'}`}
            title="Delete"
            onClick={() => setOptions(options.filter((_, at) => at !== index))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-surface-800 active:bg-surface-800"
          ><Trash2 color="#a3a3a3" size={18} /></button>
        </div>
      })}
      <div className="flex items-center gap-2">
        <input
          value={adding}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            addOption()
          }}
          placeholder="New option"
          aria-label="New option"
          maxLength={SHEET_OPTION_NAME_LIMIT}
          className={cn(inputClass, 'flex-1')}
        />
        <button
          type="button"
          aria-label="Add option"
          title="Add option"
          onClick={addOption}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-800 hover:bg-surface-700 active:bg-surface-700"
        ><Plus color="#fafafa" size={20} /></button>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-surface-500">Click a circle to change its grey.</p>
      {fromText && <p className="mt-1 text-[13px] leading-5 text-surface-400">Every value already in this column becomes an option when you save.</p>}
    </>}

    {sheet.typesEnabled && !isName && sheet.rowTypes.length > 0 && <>
      <Heading>Applies to</Heading>
      <div className="flex flex-wrap gap-2">
        <Chip label="All types" selected={typeIds === null} onPress={() => setTypeIds(null)} />
        {sheet.rowTypes.map((rowType) => <Chip
          key={rowType.id}
          label={rowType.name}
          selected={typeIds !== null && typeIds.includes(rowType.id)}
          onPress={() => toggleType(rowType.id)}
        />)}
      </div>
      <p className="mt-2 text-[13px] leading-5 text-surface-500">Rows of other types show a dash in this column.</p>
    </>}

    {(unfit > 0 || clearing > 0) && <div className="mt-5 rounded-2xl border border-red-400/40 px-4 py-3">
      {unfit > 0 && <p style={{ color: UNFIT }} className="text-[15px] leading-5">
        {unfit === 1 ? '1 value doesn’t' : `${unfit} values don’t`} fit {SHEET_COLUMN_TYPE_LABELS[type].toLowerCase()}. They stay as typed and show in red until you fix them.
      </p>}
      {clearing > 0 && <p style={{ color: UNFIT }} className={cn('text-[15px] leading-5', unfit > 0 && 'mt-2')}>
        Removing {removed.size === 1 ? 'that option' : 'those options'} clears {clearing === 1 ? 'it from 1 row' : `them from ${clearing} rows`}.
      </p>}
    </div>}
  </Sheet>
}
