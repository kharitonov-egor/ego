import React, { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { SheetRecord } from '@ego/api-contracts'
import { SHEET_ROW_TYPE_LIMIT, type SheetRowType } from '@ego/core'
import { useSheets } from '../../lib/sheets/context'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { Switch } from '../ui/switch'
import { TextSheet } from '../tasks/sheets'

type Naming = { kind: 'first' } | { kind: 'add' } | { kind: 'rename'; type: SheetRowType }

/** Turns row types on or off, and adds, renames, and deletes them. */
export function TypesSheet({ sheet, visible, onClose }: { sheet: SheetRecord; visible: boolean; onClose: () => void }): React.ReactElement {
  const sheets = useSheets()
  const [naming, setNaming] = useState<Naming | null>(null)
  const [deleting, setDeleting] = useState<SheetRowType | null>(null)
  const rows = sheets.data?.rows.filter((row) => row.sheetId === sheet.id) ?? []
  const countOf = (typeId: string): number => rows.filter((row) => row.typeId === typeId).length

  const toggle = (on: boolean): void => {
    if (on && sheet.rowTypes.length === 0) {
      setNaming({ kind: 'first' })
      return
    }
    void sheets.setTypesEnabled(sheet.id, on)
  }

  const save = (name: string): void => {
    const current = naming
    setNaming(null)
    if (!current) return
    if (current.kind === 'first') void sheets.setTypesEnabled(sheet.id, true, name)
    else void sheets.saveRowType(sheet.id, current.kind === 'rename' ? current.type.id : null, name)
  }

  const remove = (type: SheetRowType): void => {
    const others = sheet.rowTypes.filter((item) => item.id !== type.id)
    if (others.length === 0) return
    if (countOf(type.id) === 0) {
      void sheets.deleteRowType(sheet.id, type.id, others[0].id)
      return
    }
    setDeleting(type)
  }

  const others = deleting ? sheet.rowTypes.filter((item) => item.id !== deleting.id) : []
  const moving = deleting ? countOf(deleting.id) : 0

  return <Sheet visible={visible} title="Row types" onClose={onClose}>
    <div className="flex min-h-14 items-center">
      <div className="flex-1 pr-3">
        <p className="text-[17px] text-foreground">Use row types</p>
        <p className="mt-0.5 text-[14px] leading-5 text-surface-400">Each row gets a type, and a column can apply to some types only.</p>
      </div>
      <Switch checked={sheet.typesEnabled} onCheckedChange={toggle} label="Use row types" />
    </div>

    {sheet.typesEnabled && <div className="mt-3">
      {sheet.rowTypes.map((type) => {
        const count = countOf(type.id)
        const last = sheet.rowTypes.length === 1
        return <div key={type.id} className="flex min-h-14 items-center border-b border-surface-900">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] text-foreground">{type.name}</p>
            <p className="text-[13px] text-surface-500">{count === 1 ? '1 row' : `${count} rows`}</p>
          </div>
          <button
            type="button"
            aria-label={`Rename ${type.name}`}
            title="Rename"
            onClick={() => setNaming({ kind: 'rename', type })}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-800 active:bg-surface-800"
          ><Pencil color="#d4d4d4" size={18} /></button>
          <button
            type="button"
            aria-label={`Delete ${type.name}`}
            title="Delete"
            disabled={last}
            onClick={() => remove(type)}
            className={cn('flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-800 active:bg-surface-800', last && 'opacity-30')}
          ><Trash2 color="#fb7185" size={18} /></button>
        </div>
      })}
      {sheet.rowTypes.length === 1 && <p className="mt-2 text-[13px] leading-5 text-surface-500">A sheet with types keeps at least one. Turn types off to stop using them.</p>}
      {sheet.rowTypes.length < SHEET_ROW_TYPE_LIMIT && <Button variant="outline" className="mt-4 w-full" onClick={() => setNaming({ kind: 'add' })}>
        <Plus color="#fafafa" size={18} />Add a type
      </Button>}
    </div>}
    {!sheet.typesEnabled && sheet.rowTypes.length > 0 && <p className="mt-3 text-[14px] leading-5 text-surface-500">
      This sheet keeps its {sheet.rowTypes.length === 1 ? 'type' : `${sheet.rowTypes.length} types`} and each row’s type for when you turn them back on.
    </p>}

    <TextSheet
      visible={naming !== null}
      title={naming?.kind === 'rename' ? 'Rename type' : naming?.kind === 'first' ? 'First type' : 'New type'}
      value={naming?.kind === 'rename' ? naming.type.name : ''}
      placeholder={naming?.kind === 'first' ? 'Like Person' : 'Type name'}
      confirm={naming?.kind === 'rename' ? 'Save' : 'Add'}
      onSave={save}
      onClose={() => setNaming(null)}
    />
    <Sheet visible={deleting !== null} title={`Delete ${deleting?.name ?? 'type'}?`} onClose={() => setDeleting(null)}>
      <p className="mb-3 text-[15px] leading-6 text-surface-300">
        {moving === 1 ? '1 row is' : `${moving} rows are`} this type. Move {moving === 1 ? 'it' : 'them'} to:
      </p>
      {others.map((type) => <button
        key={type.id}
        type="button"
        onClick={() => {
          const target = deleting
          setDeleting(null)
          if (target) void sheets.deleteRowType(sheet.id, target.id, type.id)
        }}
        className="flex min-h-14 w-full items-center border-b border-surface-900 text-left text-[17px] text-foreground hover:bg-surface-900 active:bg-surface-900"
      >{type.name}</button>)}
    </Sheet>
  </Sheet>
}
