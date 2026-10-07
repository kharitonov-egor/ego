import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Copy, Ellipsis, EyeOff, Group, ListFilter, Pencil,
  Plus, Search, Shapes, Trash2, X, type LucideIcon
} from 'lucide-react'
import type { SheetRowRecord } from '@ego/api-contracts'
import type { SheetCellValue, SheetColumn } from '@ego/core'
import {
  activeFilters, activeTypeId, cellState, gridColumns, rowName, sheetGrid, sortLabels
} from '@ego/local/sheets/view'
import { Screen, ScreenHeader } from '../../components/screen'
import { CellEditor } from '../../components/sheets/CellEditor'
import { ColumnSheet } from '../../components/sheets/ColumnSheet'
import { Grid, type GridHandlers, type GridScroll } from '../../components/sheets/Grid'
import { PopupMenu, anchorBelow, type MenuAnchor, type MenuItem } from '../../components/ui/menu'
import { BoardSheet } from '../../components/tasks/sheets'
import type { CellRef } from '../../components/sheets/navigation'
import { TypesSheet } from '../../components/sheets/TypesSheet'
import { FilterSheet, GroupSheet, HiddenSheet, SortSheet } from '../../components/sheets/ViewSheets'
import { SheetsError, SheetsGate, SheetsMessage } from '../../components/sheets/ui'
import { IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { UNDO_MS, useSheets } from '../../lib/sheets/context'
import { cn } from '../../lib/utils'

type Panel = 'rename' | 'types' | 'sort' | 'filter' | 'group' | 'hidden'

type MenuTarget =
  | { kind: 'sheet' }
  | { kind: 'column'; column: SheetColumn }
  | { kind: 'row'; row: SheetRowRecord }

/**
 * The cell being edited, and every cell in the order the grid showed when the editor opened. The
 * arrows walk that order, so a row a pick filters out of view does not lose the editor its place.
 */
interface Editing extends CellRef {
  order: CellRef[]
  seed: string | null
}

interface ClearedCell extends CellRef {
  value: SheetCellValue
  label: string
}

/** What a sheet's page was showing, so coming back from a row finds it as it was left. */
interface SavedView {
  searching: boolean
  search: string
  collapsed: ReadonlySet<string>
  selected: CellRef | null
  scroll: GridScroll
}

const savedViews = new Map<string, SavedView>()

function ToolButton({ Icon, label, active, onPress }: { Icon: LucideIcon; label: string; active: boolean; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    aria-pressed={active}
    onClick={onPress}
    className={cn('flex h-9 max-w-[180px] items-center rounded-full px-3 transition-colors',
      active ? 'bg-white text-black hover:bg-surface-200' : 'border border-surface-700 text-surface-200 hover:bg-surface-800')}
  >
    <Icon size={15} />
    <span className="ml-1.5 truncate text-[14px] font-semibold">{label}</span>
  </button>
}

function TypeChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    role="tab"
    aria-selected={selected}
    onClick={onPress}
    className={cn('flex h-9 shrink-0 items-center rounded-full px-4 text-[14px] font-semibold transition-colors',
      selected ? 'bg-white text-black' : 'bg-surface-900 text-surface-300 hover:bg-surface-800')}
  >{label}</button>
}

function UndoToast({ text, onUndo }: { text: string; onUndo: () => void }): React.ReactElement {
  return <div role="status" className="flex h-14 items-center rounded-2xl border border-surface-700 bg-surface-900 pl-4 pr-2 shadow-2xl">
    <span className="flex-1 truncate text-[15px] text-surface-100">{text}</span>
    <button type="button" title="Undo (Ctrl+Z)" onClick={onUndo} className="flex h-11 items-center rounded-xl px-3 text-[15px] font-bold text-white hover:bg-surface-800 active:bg-surface-800">Undo</button>
  </div>
}

function typingIn(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
}

function SheetView({ sheetId }: { sheetId: string }): React.ReactElement {
  const sheets = useSheets()
  const navigate = useNavigate()
  const [saved] = useState(() => savedViews.get(sheetId))
  const [panel, setPanel] = useState<Panel | null>(null)
  const [menu, setMenu] = useState<{ target: MenuTarget; at: MenuAnchor } | null>(null)
  const [searching, setSearching] = useState(saved?.searching ?? false)
  const [search, setSearch] = useState(saved?.search ?? '')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(saved?.collapsed ?? new Set())
  const [selected, setSelected] = useState<CellRef | null>(saved?.selected ?? null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [columnEdit, setColumnEdit] = useState<{ column: SheetColumn | null } | null>(null)
  const [deletingColumn, setDeletingColumn] = useState<SheetColumn | null>(null)
  const [deletingSheet, setDeletingSheet] = useState(false)
  const [cleared, setCleared] = useState<ClearedCell | null>(null)
  /** Which toast Ctrl+Z answers when a cleared cell and a deleted row are both waiting. */
  const [lastUndo, setLastUndo] = useState<'row' | 'cell'>('row')
  const searchInput = useRef<HTMLInputElement>(null)
  const gridElement = useRef<HTMLDivElement>(null)
  const scroll = useRef<GridScroll>(saved?.scroll ?? { top: 0, left: 0 })
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaving = useRef(false)
  const today = useMemo(() => new Date(), [])

  const data = sheets.data
  const sheet = data?.sheets.find((item) => item.id === sheetId)
  const rows = useMemo(() => data?.rows.filter((row) => row.sheetId === sheetId) ?? [], [data, sheetId])
  const columns = useMemo(() => sheet ? gridColumns(sheet) : [], [sheet])
  const query = searching ? search : ''
  const grid = useMemo(() => sheet ? sheetGrid(sheet, rows, query, collapsed, today) : null, [collapsed, query, rows, sheet, today])
  const deleted = sheets.deletedRow?.sheetId === sheetId ? sheets.deletedRow : null

  const view = useRef({ searching, search, collapsed, selected })
  view.current = { searching, search, collapsed, selected }
  useEffect(() => () => {
    if (!leaving.current) savedViews.set(sheetId, { ...view.current, scroll: scroll.current })
  }, [sheetId])

  useEffect(() => () => { if (clearTimer.current) clearTimeout(clearTimer.current) }, [])
  useEffect(() => { if (deleted) setLastUndo('row') }, [deleted?.id])

  const leave = (): void => {
    leaving.current = true
    savedViews.delete(sheetId)
    navigate('/sheets', { replace: true })
  }
  const focusGrid = (): void => gridElement.current?.focus({ preventScroll: true })

  const openRow = useCallback((row: SheetRowRecord) => navigate(`/sheets/row/${row.id}`), [navigate])

  const undoClear = (): void => {
    if (!cleared) return
    if (clearTimer.current) clearTimeout(clearTimer.current)
    setCleared(null)
    const row = sheets.data?.rows.find((item) => item.id === cleared.rowId)
    if (row && row.cells[cleared.columnId] === undefined) void sheets.setCell(cleared.rowId, cleared.columnId, cleared.value)
  }
  const undoLatest = (): void => {
    if (cleared && (lastUndo === 'cell' || !deleted)) undoClear()
    else if (deleted) sheets.undoDelete()
  }
  const latestUndo = useRef(undoLatest)
  latestUndo.current = undoLatest
  const canUndo = cleared !== null || deleted !== null

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || document.querySelector('[aria-modal="true"], [role="menu"]')) return
      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        setSearching(true)
        searchInput.current?.focus()
      } else if (key === 'z' && !event.shiftKey && canUndo && !typingIn(event.target)) {
        event.preventDefault()
        latestUndo.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canUndo])

  const cellOrder = (): CellRef[] => sheet && grid
    ? grid.ordered.flatMap((row) => columns.slice(1)
      .filter((column) => cellState(sheet, column, row).kind !== 'none')
      .map((column) => ({ rowId: row.id, columnId: column.id })))
    : []
  const edit = (row: SheetRowRecord, column: SheetColumn, seed: string | null): void => {
    setSelected({ rowId: row.id, columnId: column.id })
    setEditing({ rowId: row.id, columnId: column.id, order: cellOrder(), seed })
  }

  const handlers: GridHandlers = {
    openRow,
    rowMenu: (row, at) => setMenu({ target: { kind: 'row', row }, at }),
    editCell: edit,
    toggleCell: (row, column) => {
      if (sheet && cellState(sheet, column, row).kind === 'mismatch') edit(row, column, null)
      else void sheets.setCell(row.id, column.id, row.cells[column.id] === true ? null : true)
    },
    clearCell: (row, column) => {
      const value = row.cells[column.id]
      if (value === undefined || !sheet) return
      void sheets.setCell(row.id, column.id, null)
      if (clearTimer.current) clearTimeout(clearTimer.current)
      clearTimer.current = setTimeout(() => setCleared(null), UNDO_MS)
      setCleared({ rowId: row.id, columnId: column.id, value, label: `Cleared ${column.name} for ${rowName(sheet, row) || 'Untitled'}` })
      setLastUndo('cell')
    },
    columnMenu: (column, at) => setMenu({ target: { kind: 'column', column }, at }),
    addColumn: () => setColumnEdit({ column: null }),
    toggleSection: (key) => setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    }),
    select: setSelected
  }

  if (!data || !sheet || !grid) {
    if (leaving.current) return <Screen><span /></Screen>
    return <Screen>
      <ScreenHeader title="" back="/sheets" />
      <SheetsMessage title="This sheet is gone" detail="It was deleted, maybe on another device." action="Back" onAction={leave} />
    </Screen>
  }

  const editRow = editing ? rows.find((row) => row.id === editing.rowId) ?? null : null
  const editColumn = editing ? sheet.columns.find((column) => column.id === editing.columnId) ?? null : null

  /** The next cell that still exists, across the row and then on to the next row. */
  const stepFrom = (direction: -1 | 1): void => {
    if (!editing) return
    const { order } = editing
    let index = order.findIndex((cell) => cell.rowId === editing.rowId && cell.columnId === editing.columnId)
    if (index < 0) {
      setEditing(null)
      return
    }
    for (index += direction; index >= 0 && index < order.length; index += direction) {
      const cell = order[index]
      if (rows.some((row) => row.id === cell.rowId) && sheet.columns.some((column) => column.id === cell.columnId)) {
        setSelected({ rowId: cell.rowId, columnId: cell.columnId })
        setEditing({ ...cell, order, seed: null })
        return
      }
    }
    setEditing(null)
  }

  const typeId = activeTypeId(sheet)
  const filterCount = activeFilters(sheet).length
  const sortColumn = sheet.view.sorts[0] ? sheet.columns.find((column) => column.id === sheet.view.sorts[0].columnId) : undefined
  const groupColumn = sheet.view.groupBy ? sheet.columns.find((column) => column.id === sheet.view.groupBy) : undefined
  const hiddenCount = sheet.columns.filter((column) => column.hidden).length
  const filtering = filterCount > 0 || query.trim() !== '' || typeId !== null
  const setType = (next: string | null): void => {
    if (next !== sheet.view.typeId) void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, typeId: next } }))
  }
  const sortBy = (column: SheetColumn, direction: 'asc' | 'desc'): void => {
    void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, sorts: [{ columnId: column.id, direction }] } }))
  }
  const closeSearch = (): void => {
    setSearch('')
    setSearching(false)
    focusGrid()
  }

  const columnItems = (column: SheetColumn): MenuItem[] => {
    const index = sheet.columns.findIndex((item) => item.id === column.id)
    const labels = sortLabels(column.type)
    const isName = index === 0
    const items: MenuItem[] = [
      { label: isName ? 'Rename column' : 'Edit column', Icon: Pencil, onPress: () => setColumnEdit({ column }) },
      { label: `Sort ${labels.asc}`, Icon: ArrowUp, onPress: () => sortBy(column, 'asc') },
      { label: `Sort ${labels.desc}`, Icon: ArrowDown, onPress: () => sortBy(column, 'desc') }
    ]
    if (column.type === 'dropdown') {
      const grouped = sheet.view.groupBy === column.id
      items.push({
        label: grouped ? 'Stop grouping' : 'Group by this column',
        Icon: Group,
        onPress: () => void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, groupBy: grouped ? null : column.id } }))
      })
    }
    if (isName) return items
    items.push(
      {
        label: 'Hide column', Icon: EyeOff,
        onPress: () => void sheets.updateSheet(sheet.id, (input) => ({
          ...input, columns: input.columns.map((item) => item.id === column.id ? { ...item, hidden: true } : item)
        }))
      },
      { label: 'Move left', Icon: ArrowLeft, disabled: index <= 1, onPress: () => void sheets.moveColumn(sheet.id, column.id, -1) },
      { label: 'Move right', Icon: ArrowRight, disabled: index >= sheet.columns.length - 1, onPress: () => void sheets.moveColumn(sheet.id, column.id, 1) },
      { label: 'Delete column', Icon: Trash2, destructive: true, onPress: () => setDeletingColumn(column) }
    )
    return items
  }

  const sheetItems: MenuItem[] = [
    { label: 'Rename sheet', Icon: Pencil, onPress: () => setPanel('rename') },
    { label: 'Add a column', Icon: Columns3, onPress: () => setColumnEdit({ column: null }) },
    { label: sheet.typesEnabled ? 'Row types' : 'Turn on row types', Icon: Shapes, onPress: () => setPanel('types') },
    ...hiddenCount > 0 ? [{ label: `Hidden columns (${hiddenCount})`, Icon: EyeOff, onPress: () => setPanel('hidden') }] : [],
    { label: 'Duplicate sheet', Icon: Copy, onPress: () => void sheets.duplicateSheet(sheet.id).then((id) => { if (id) navigate(`/sheets/${id}`, { replace: true }) }) },
    {
      label: 'Archive sheet', Icon: Archive,
      onPress: () => {
        void sheets.updateSheet(sheet.id, (input) => ({ ...input, archivedAt: new Date().toISOString() }))
        leave()
      }
    },
    { label: 'Delete sheet', Icon: Trash2, destructive: true, onPress: () => setDeletingSheet(true) }
  ]

  const rowItems = (row: SheetRowRecord): MenuItem[] => [
    { label: 'Open', Icon: ArrowRight, onPress: () => openRow(row) },
    { label: 'Duplicate', Icon: Copy, onPress: () => void sheets.duplicateRow(row.id) },
    { label: 'Delete', Icon: Trash2, destructive: true, onPress: () => sheets.deleteRow(row.id) }
  ]

  const menuTitle = !menu ? '' : menu.target.kind === 'sheet' ? sheet.name
    : menu.target.kind === 'column' ? menu.target.column.name : rowName(sheet, menu.target.row) || 'Untitled'
  const menuItems = !menu ? [] : menu.target.kind === 'sheet' ? sheetItems
    : menu.target.kind === 'column' ? columnItems(menu.target.column) : rowItems(menu.target.row)

  const empty = <div className="flex flex-col items-center px-8 pt-16">
    <p className="text-center text-[18px] font-semibold text-surface-200">{grid.total === 0 ? 'No rows yet' : 'No rows match'}</p>
    <p className="mt-2 max-w-md text-center text-[15px] leading-6 text-surface-500">
      {grid.total === 0 ? 'Click + to add the first one. Click a column’s name to sort, group, or change it.' : 'Try another search, type, or filter.'}
    </p>
  </div>

  return <Screen>
    <ScreenHeader
      title={`${sheet.icon ? `${sheet.icon} ` : ''}${sheet.name}`}
      back="/sheets"
      right={<>
        <IconButton label="Search rows (Ctrl+F)" onClick={() => searching ? closeSearch() : setSearching(true)}><Search size={20} /></IconButton>
        <IconButton label="Sheet menu" onClick={(event) => {
          const at = anchorBelow(event.currentTarget)
          focusGrid()
          setMenu({ target: { kind: 'sheet' }, at })
        }}><Ellipsis size={21} /></IconButton>
      </>}
    />
    <SheetsError />
    {sheet.typesEnabled && sheet.rowTypes.length > 0 && <div role="tablist" aria-label="Row types" className="flex shrink-0 gap-1.5 overflow-x-auto px-5 pb-2 pt-3">
      <TypeChip label="All" selected={typeId === null} onPress={() => setType(null)} />
      {sheet.rowTypes.map((type) => <TypeChip key={type.id} label={type.name} selected={typeId === type.id} onPress={() => setType(type.id)} />)}
    </div>}
    {searching && <div className="mx-5 mt-2 flex h-11 max-w-xl shrink-0 items-center rounded-xl border border-surface-700 bg-surface-900 px-3 focus-within:border-surface-400">
      <Search color="#737373" size={17} />
      <input
        ref={searchInput}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          closeSearch()
        }}
        autoFocus
        placeholder="Search this sheet"
        aria-label="Search this sheet"
        className="ml-2 flex-1 bg-transparent text-[16px] text-white outline-none placeholder:text-surface-500"
      />
      <IconButton label="Close search" onClick={closeSearch} className="-mr-1.5 h-8 w-8"><X color="#a3a3a3" size={18} /></IconButton>
    </div>}
    <div className="flex shrink-0 items-center gap-2 px-5 pb-3 pt-3">
      <ToolButton Icon={ListFilter} label={filterCount > 0 ? `Filter ${filterCount}` : 'Filter'} active={filterCount > 0} onPress={() => setPanel('filter')} />
      <ToolButton Icon={ArrowUp} label={sortColumn ? sortColumn.name : 'Sort'} active={sortColumn !== undefined} onPress={() => setPanel('sort')} />
      <ToolButton Icon={Group} label={groupColumn ? groupColumn.name : 'Group'} active={groupColumn !== undefined} onPress={() => setPanel('group')} />
      <span className="ml-auto truncate text-[13px] text-surface-500">
        {filtering ? `${grid.shown} of ${grid.total}` : grid.total === 1 ? '1 row' : `${grid.total} rows`}
      </span>
    </div>
    <div className="relative flex min-h-0 flex-1 flex-col border-t border-border">
      <Grid
        sheet={sheet}
        columns={columns}
        items={grid.items}
        today={today}
        empty={empty}
        selected={selected}
        handlers={handlers}
        scroller={gridElement}
        initialScroll={scroll.current}
        onScroll={(next) => { scroll.current = next }}
      />
      {canUndo && <div className={cn('absolute bottom-6 left-6 flex w-[420px] max-w-[calc(100%-128px)] gap-2', lastUndo === 'cell' ? 'flex-col' : 'flex-col-reverse')}>
        {deleted && <UndoToast text={`Deleted ${deleted.name}`} onUndo={sheets.undoDelete} />}
        {cleared && <UndoToast text={cleared.label} onUndo={undoClear} />}
      </div>}
      <button
        type="button"
        aria-label="Add a row"
        title="Add a row"
        onClick={() => navigate(`/sheets/row/new?sheetId=${encodeURIComponent(sheet.id)}&typeId=${encodeURIComponent(typeId ?? '')}`)}
        className="absolute bottom-6 right-6 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-2xl transition-colors hover:bg-surface-200 active:bg-surface-300"
      ><Plus color="#0a0a0a" size={30} strokeWidth={2.5} /></button>
    </div>

    <CellEditor
      sheet={sheet}
      row={editRow}
      column={editColumn}
      seed={editing?.seed ?? null}
      onClose={() => setEditing(null)}
      onStep={stepFrom}
    />
    <PopupMenu anchor={menu?.at ?? null} title={menuTitle} items={menuItems} onClose={() => setMenu(null)} />
    <ColumnSheet sheet={sheet} column={columnEdit?.column ?? null} visible={columnEdit !== null} onClose={() => setColumnEdit(null)} />
    <SortSheet sheet={sheet} visible={panel === 'sort'} onClose={() => setPanel(null)} />
    <FilterSheet sheet={sheet} visible={panel === 'filter'} onClose={() => setPanel(null)} />
    <GroupSheet sheet={sheet} visible={panel === 'group'} onClose={() => setPanel(null)} />
    <HiddenSheet sheet={sheet} visible={panel === 'hidden'} onClose={() => setPanel(null)} />
    <TypesSheet sheet={sheet} visible={panel === 'types'} onClose={() => setPanel(null)} />
    <BoardSheet
      visible={panel === 'rename'}
      title="Rename sheet"
      name={sheet.name}
      icon={sheet.icon}
      confirm="Save"
      placeholder="Sheet name"
      onClose={() => setPanel(null)}
      onSave={(name, icon) => {
        setPanel(null)
        void sheets.updateSheet(sheet.id, (input) => ({ ...input, name: name.trim(), icon }))
      }}
    />
    <ConfirmDialog
      visible={deletingColumn !== null}
      title={`Delete ${deletingColumn?.name ?? 'this column'}?`}
      detail="Its values disappear from every row, on every device."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeletingColumn(null)}
      onConfirm={() => {
        if (deletingColumn) void sheets.deleteColumn(sheet.id, deletingColumn.id)
        setDeletingColumn(null)
      }}
    />
    <ConfirmDialog
      visible={deletingSheet}
      title="Delete this sheet?"
      detail="Its rows go with it, on every device. This cannot be undone."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeletingSheet(false)}
      onConfirm={() => {
        setDeletingSheet(false)
        void sheets.deleteSheet(sheet.id)
        leave()
      }}
    />
  </Screen>
}

export default function SheetScreen({ sheetId }: { sheetId: string }): React.ReactElement {
  return <SheetsGate header={<ScreenHeader title="" back="/sheets" />}><SheetView sheetId={sheetId} /></SheetsGate>
}
