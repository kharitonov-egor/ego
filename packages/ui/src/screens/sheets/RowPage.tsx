import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Copy, Ellipsis, Trash2 } from 'lucide-react'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import { SHEET_TEXT_LIMIT, type SheetCellValue } from '@ego/core'
import { formatIso, timeAgo } from '@ego/local/dates'
import { withCell } from '@ego/local/sheets/edits'
import { formColumns, nameColumn, rowName } from '@ego/local/sheets/view'
import { localDay } from '@ego/local/tasks/board'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Field } from '../../components/sheets/Fields'
import { PopupMenu, anchorBelow, type MenuAnchor } from '../../components/ui/menu'
import { SheetsError, SheetsGate, SheetsMessage } from '../../components/sheets/ui'
import { Button, IconButton } from '../../components/ui/button'
import { useSheets } from '../../lib/sheets/context'
import { cn } from '../../lib/utils'

function TypeChoice({ sheet, typeId, onChange }: { sheet: SheetRecord; typeId: string | null; onChange: (typeId: string) => void }): React.ReactElement {
  return <div role="radiogroup" aria-label="Row type" className="mb-6 flex flex-wrap gap-2">
    {sheet.rowTypes.map((type) => {
      const selected = type.id === typeId
      return <button
        key={type.id}
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => onChange(type.id)}
        className={cn('flex h-10 items-center rounded-full px-4 text-[15px] font-semibold transition-colors',
          selected ? 'bg-white text-black' : 'border border-surface-700 text-surface-200 hover:bg-surface-800')}
      >{type.name}</button>
    })}
  </div>
}

/**
 * The row's name, written large. A saved row saves it when the field loses focus or the page
 * closes; Enter in a new row's name adds the row.
 */
function NameInput({ value, live, onCommit, onSubmit }: {
  value: string
  live: boolean
  onCommit: (name: string) => void
  onSubmit: () => void
}): React.ReactElement {
  const [text, setText] = useState(value)
  const field = useRef<HTMLTextAreaElement>(null)
  const latest = useRef({ text, value, onCommit })
  latest.current = { text, value, onCommit }
  useEffect(() => { if (!live) setText(value) }, [live, value])
  useLayoutEffect(() => {
    const element = field.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [text])
  const commit = (): void => {
    const { text: current, value: saved } = latest.current
    if (current.trim() !== '' && current.trim() !== saved.trim()) latest.current.onCommit(current.trim())
  }
  useEffect(() => () => { if (!live) commit() }, [])
  return <textarea
    ref={field}
    value={text}
    onChange={(event) => {
      const next = event.target.value.replace(/\n/g, ' ')
      setText(next)
      if (live) onCommit(next)
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' || event.ctrlKey || event.nativeEvent.isComposing) return
      event.preventDefault()
      if (live) onSubmit()
      else event.currentTarget.blur()
    }}
    onBlur={live ? undefined : commit}
    autoFocus={live}
    rows={1}
    placeholder="Name"
    aria-label="Name"
    maxLength={SHEET_TEXT_LIMIT}
    className="mb-5 w-full resize-none overflow-hidden bg-transparent p-0 text-[26px] font-bold leading-9 text-white outline-none placeholder:text-surface-600"
  />
}

function RowPage({ rowId, sheetId, initialType }: { rowId: string; sheetId: string; initialType: string | null }): React.ReactElement {
  const sheets = useSheets()
  const navigate = useNavigate()
  const location = useLocation()
  const isNew = rowId === 'new'
  const row: SheetRowRecord | undefined = isNew ? undefined : sheets.data?.rows.find((item) => item.id === rowId)
  const sheet = sheets.data?.sheets.find((item) => item.id === (row?.sheetId ?? sheetId))
  const [draft, setDraft] = useState<Record<string, SheetCellValue>>({})
  const [draftType, setDraftType] = useState<string | null>(initialType)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const saving = useRef(false)
  const leaving = useRef(false)

  const back = (): void => {
    if (location.key === 'default') navigate(sheet ? `/sheets/${sheet.id}` : '/sheets', { replace: true })
    else navigate(-1)
  }

  const typeId = isNew ? draftType : row?.typeId ?? null
  const name = sheet ? (isNew ? rowName(sheet, { cells: draft }) : row ? rowName(sheet, row) : '') : ''
  const canSave = isNew && sheet !== undefined && name.trim() !== '' && (!sheet.typesEnabled || typeId !== null)

  const save = (): void => {
    if (!sheet || !canSave || saving.current) return
    saving.current = true
    void sheets.createRow(sheet.id, typeId, withCell(draft, nameColumn(sheet).id, name.trim())).then((id) => {
      saving.current = false
      if (id) back()
    })
  }
  const latestSave = useRef(save)
  latestSave.current = save

  useEffect(() => {
    if (!isNew) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || document.querySelector('[aria-modal="true"], [role="menu"]')) return
      event.preventDefault()
      latestSave.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isNew])

  if (!sheet || (!isNew && !row)) {
    if (leaving.current) return <Screen><span /></Screen>
    return <Screen>
      <ScreenHeader title="" back={sheet ? `/sheets/${sheet.id}` : '/sheets'} />
      <SheetsMessage title="This row is gone" detail="It was deleted, maybe on another device." action="Back" onAction={back} />
    </Screen>
  }

  const cells = isNew ? draft : row?.cells ?? {}
  const commit = (columnId: string) => (value: SheetCellValue | null): void => {
    if (isNew) setDraft((current) => withCell(current, columnId, value))
    else if (row) void sheets.setCell(row.id, columnId, value)
  }
  const chooseType = (next: string): void => {
    if (isNew) setDraftType(next)
    else if (row && next !== row.typeId) void sheets.updateRow(row.id, (input) => ({ ...input, typeId: next }))
  }
  const asking = isNew && sheet.typesEnabled && typeId === null

  return <Screen>
    <ScreenHeader
      title={isNew ? `New in ${sheet.name}` : sheet.name}
      back={`/sheets/${sheet.id}`}
      right={isNew
        ? <Button variant="ghost" size="sm" disabled={!canSave} title="Save (Ctrl+Enter)" onClick={save} className="text-[16px] font-bold">Save</Button>
        : <IconButton label="Row menu" onClick={(event) => setMenu(anchorBelow(event.currentTarget))}><Ellipsis size={21} /></IconButton>}
    />
    <SheetsError />
    <ScreenBody width="narrow" className="pb-12">
      {asking
        ? <div>
          <h2 className="mb-1 text-[22px] font-bold text-white">What kind of row is this?</h2>
          <p className="mb-5 text-[15px] leading-6 text-surface-400">The type decides which columns it has.</p>
          <TypeChoice sheet={sheet} typeId={null} onChange={chooseType} />
        </div>
        : <>
          <NameInput value={name} live={isNew} onCommit={commit(nameColumn(sheet).id)} onSubmit={save} />
          {sheet.typesEnabled && sheet.rowTypes.length > 0 && <TypeChoice sheet={sheet} typeId={typeId} onChange={chooseType} />}
          {formColumns(sheet, typeId).map((column) => <Field
            key={`${column.id}:${column.type}`}
            column={column}
            value={cells[column.id]}
            live={isNew}
            onCommit={commit(column.id)}
            onCreateOption={(optionName) => sheets.addOption(sheet.id, column.id, optionName)}
          />)}
          {formColumns(sheet, typeId).length === 0 && <p className="mb-5 text-[15px] leading-6 text-surface-500">
            This sheet has no other columns yet. Add them from the grid’s header.
          </p>}
          {isNew
            ? <Button size="lg" className="mt-2 w-full" disabled={!canSave} onClick={save}>Add row</Button>
            : row && <p className="mt-2 text-[13px] text-surface-500">
              Added {formatIso(localDay(new Date(row.createdAt)))} · Edited {timeAgo(row.updatedAt, new Date())}
            </p>}
        </>}
    </ScreenBody>
    {row && <PopupMenu anchor={menu} title={name || 'Untitled'} onClose={() => setMenu(null)} items={[
      { label: 'Duplicate', Icon: Copy, onPress: () => void sheets.duplicateRow(row.id).then((id) => { if (id) navigate(`/sheets/row/${id}`, { replace: true }) }) },
      {
        label: 'Delete', Icon: Trash2, destructive: true,
        onPress: () => {
          leaving.current = true
          sheets.deleteRow(row.id)
          back()
        }
      }
    ]} />}
  </Screen>
}

export default function RowScreen({ rowId, sheetId, typeId }: { rowId: string; sheetId: string; typeId: string | null }): React.ReactElement {
  return <SheetsGate header={<ScreenHeader title="" back={sheetId ? `/sheets/${sheetId}` : '/sheets'} />}>
    <RowPage rowId={rowId} sheetId={sheetId} initialType={typeId} />
  </SheetsGate>
}
