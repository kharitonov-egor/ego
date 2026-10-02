import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns3, Copy, Ellipsis, EyeOff, Group, ListFilter, Pencil,
  Plus, Search, Shapes, Trash2, X, type LucideIcon
} from 'lucide-react-native'
import type { SheetRowRecord } from '@ego/api-contracts'
import type { SheetColumn } from '@ego/core'
import { HeaderIcon, MenuSheet, type MenuItem } from '../../components/gym/ui'
import { ConfirmDialog } from '../../components/money/Common'
import { CellEditor } from '../../components/sheets/CellEditor'
import { ColumnSheet } from '../../components/sheets/ColumnSheet'
import { Grid, type GridHandlers } from '../../components/sheets/Grid'
import { TypesSheet } from '../../components/sheets/TypesSheet'
import { FilterSheet, GroupSheet, HiddenSheet, SortSheet } from '../../components/sheets/ViewSheets'
import { SheetsError, SheetsGate, SheetsHeaderRight, SheetsMessage } from '../../components/sheets/ui'
import { BoardSheet } from '../../components/tasks/sheets'
import { useSheets } from '../../lib/sheets/context'
import {
  activeFilters, activeTypeId, cellState, gridColumns, rowName, sheetGrid, sortLabels
} from '../../lib/sheets/view'

type Panel = 'menu' | 'rename' | 'types' | 'sort' | 'filter' | 'group' | 'hidden'

interface CellRef {
  rowId: string
  columnId: string
}

/**
 * The cell being edited, and every cell in the order the grid showed when the editor opened. The
 * arrows walk that order, so a row a pick filters out of view does not lose the editor its place.
 */
interface Editing extends CellRef {
  order: CellRef[]
}

function ToolButton({ Icon, label, active, onPress }: { Icon: LucideIcon; label: string; active: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={{ maxWidth: 132 }}
    className={`h-9 flex-row items-center rounded-full px-3 ${active ? 'bg-white' : 'border border-surface-700 active:bg-surface-800'}`}
  >
    <Icon color={active ? '#0a0a0a' : '#d4d4d4'} size={15} />
    <Text numberOfLines={1} className={`ml-1.5 flex-shrink text-[14px] font-semibold ${active ? 'text-black' : 'text-surface-200'}`}>{label}</Text>
  </Pressable>
}

function TypeChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="tab"
    accessibilityState={{ selected }}
    onPress={onPress}
    className={`h-9 justify-center rounded-full px-4 ${selected ? 'bg-white' : 'bg-surface-900 active:bg-surface-800'}`}
  >
    <Text className={`text-[14px] font-semibold ${selected ? 'text-black' : 'text-surface-300'}`}>{label}</Text>
  </Pressable>
}

function SheetView({ sheetId }: { sheetId: string }): React.ReactElement {
  const sheets = useSheets()
  const router = useRouter()
  const navigation = useNavigation()
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  const [panel, setPanel] = useState<Panel | null>(null)
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [editing, setEditing] = useState<Editing | null>(null)
  const [columnMenu, setColumnMenu] = useState<SheetColumn | null>(null)
  const [columnEdit, setColumnEdit] = useState<{ column: SheetColumn | null } | null>(null)
  const [deletingColumn, setDeletingColumn] = useState<SheetColumn | null>(null)
  const [rowMenu, setRowMenu] = useState<SheetRowRecord | null>(null)
  const [deletingSheet, setDeletingSheet] = useState(false)
  const leaving = useRef(false)
  const today = useMemo(() => new Date(), [])

  const data = sheets.data
  const sheet = data?.sheets.find((item) => item.id === sheetId)
  const rows = useMemo(() => data?.rows.filter((row) => row.sheetId === sheetId) ?? [], [data, sheetId])
  const columns = useMemo(() => sheet ? gridColumns(sheet) : [], [sheet])
  const query = searching ? search : ''
  const grid = useMemo(() => sheet ? sheetGrid(sheet, rows, query, collapsed, today) : null, [collapsed, query, rows, sheet, today])

  useLayoutEffect(() => {
    navigation.setOptions({
      title: sheet ? `${sheet.icon ? `${sheet.icon} ` : ''}${sheet.name}` : '',
      headerRight: () => <SheetsHeaderRight>
        <HeaderIcon label="Search rows" onPress={() => setSearching((open) => !open)}><Search color="#fafafa" size={21} /></HeaderIcon>
        <HeaderIcon label="Sheet menu" onPress={() => setPanel('menu')}><Ellipsis color="#fafafa" size={22} /></HeaderIcon>
      </SheetsHeaderRight>
    })
  }, [navigation, sheet])

  const openRow = useCallback((row: SheetRowRecord) => router.push({ pathname: '/sheets/row/[id]', params: { id: row.id } }), [router])

  const cellOrder = (): CellRef[] => sheet && grid
    ? grid.ordered.flatMap((row) => columns.slice(1)
      .filter((column) => cellState(sheet, column, row).kind !== 'none')
      .map((column) => ({ rowId: row.id, columnId: column.id })))
    : []
  const edit = (row: SheetRowRecord, column: SheetColumn): void => setEditing({ rowId: row.id, columnId: column.id, order: cellOrder() })

  const handlers: GridHandlers = {
    openRow,
    rowMenu: setRowMenu,
    editCell: edit,
    toggleCell: (row, column) => {
      if (sheet && cellState(sheet, column, row).kind === 'mismatch') edit(row, column)
      else void sheets.setCell(row.id, column.id, row.cells[column.id] === true ? null : true)
    },
    columnMenu: setColumnMenu,
    addColumn: () => setColumnEdit({ column: null }),
    toggleSection: (key) => setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (!data || !sheet || !grid) {
    if (leaving.current) return <View className="flex-1 bg-surface-950" />
    return <SheetsMessage title="This sheet is gone" detail="It was deleted, maybe on another device." action="Back" onAction={() => router.back()} />
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
        setEditing({ ...cell, order })
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
  const deleted = sheets.deletedRow?.sheetId === sheetId ? sheets.deletedRow : null
  const setType = (next: string | null): void => {
    if (next !== sheet.view.typeId) void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, typeId: next } }))
  }
  const sortBy = (column: SheetColumn, direction: 'asc' | 'desc'): void => {
    void sheets.updateSheet(sheet.id, (input) => ({ ...input, view: { ...input.view, sorts: [{ columnId: column.id, direction }] } }))
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
    { label: 'Duplicate sheet', Icon: Copy, onPress: () => void sheets.duplicateSheet(sheet.id).then((id) => { if (id) router.replace({ pathname: '/sheets/[id]', params: { id } }) }) },
    {
      label: 'Archive sheet', Icon: Archive,
      onPress: () => {
        void sheets.updateSheet(sheet.id, (input) => ({ ...input, archivedAt: new Date().toISOString() }))
        router.back()
      }
    },
    { label: 'Delete sheet', Icon: Trash2, destructive: true, onPress: () => setDeletingSheet(true) }
  ]

  const rowItems = (row: SheetRowRecord): MenuItem[] => [
    { label: 'Open', Icon: ArrowRight, onPress: () => openRow(row) },
    { label: 'Duplicate', Icon: Copy, onPress: () => void sheets.duplicateRow(row.id) },
    { label: 'Delete', Icon: Trash2, destructive: true, onPress: () => sheets.deleteRow(row.id) }
  ]

  const empty = <View style={{ width: screenWidth }} className="items-center px-8 pt-16">
    <Text className="text-center text-[18px] font-semibold text-surface-200">{grid.total === 0 ? 'No rows yet' : 'No rows match'}</Text>
    <Text className="mt-2 text-center text-[15px] leading-6 text-surface-500">
      {grid.total === 0 ? 'Tap + to add the first one. Tap a column’s name to sort, group, or change it.' : 'Try another search, type, or filter.'}
    </Text>
  </View>

  return <View className="flex-1 bg-surface-950">
    <SheetsError />
    {sheet.typesEnabled && sheet.rowTypes.length > 0 && <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="flex-grow-0"
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 6 }}
    >
      <TypeChip label="All" selected={typeId === null} onPress={() => setType(null)} />
      {sheet.rowTypes.map((type) => <TypeChip key={type.id} label={type.name} selected={typeId === type.id} onPress={() => setType(type.id)} />)}
    </ScrollView>}
    {searching && <View className="mx-3 mb-2 h-11 flex-row items-center rounded-xl border border-surface-700 bg-surface-900 px-3">
      <Search color="#737373" size={17} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        autoFocus
        placeholder="Search this sheet"
        placeholderTextColor="#737373"
        accessibilityLabel="Search this sheet"
        returnKeyType="search"
        className="ml-2 flex-1 text-[16px] text-white"
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Close search" hitSlop={8} onPress={() => {
        setSearch('')
        setSearching(false)
      }}><X color="#a3a3a3" size={18} /></Pressable>
    </View>}
    <View className="mb-2 flex-row items-center gap-2 px-3">
      <ToolButton Icon={ListFilter} label={filterCount > 0 ? `Filter ${filterCount}` : 'Filter'} active={filterCount > 0} onPress={() => setPanel('filter')} />
      <ToolButton Icon={ArrowUp} label={sortColumn ? sortColumn.name : 'Sort'} active={sortColumn !== undefined} onPress={() => setPanel('sort')} />
      <ToolButton Icon={Group} label={groupColumn ? groupColumn.name : 'Group'} active={groupColumn !== undefined} onPress={() => setPanel('group')} />
      <Text numberOfLines={1} className="ml-auto text-[13px] text-surface-500">
        {filtering ? `${grid.shown} of ${grid.total}` : grid.total === 1 ? '1 row' : `${grid.total} rows`}
      </Text>
    </View>
    <Grid
      sheet={sheet}
      columns={columns}
      items={grid.items}
      today={today}
      empty={empty}
      bottomInset={insets.bottom + 110}
      handlers={handlers}
    />

    {deleted && <View style={{ bottom: insets.bottom + 24 }} className="absolute left-4 right-24 h-14 flex-row items-center rounded-2xl border border-surface-700 bg-surface-900 pl-4 pr-2">
      <Text numberOfLines={1} className="flex-1 text-[15px] text-surface-100">Deleted {deleted.name}</Text>
      <Pressable accessibilityRole="button" onPress={sheets.undoDelete} className="h-11 justify-center rounded-xl px-3 active:bg-surface-800">
        <Text className="text-[15px] font-bold text-white">Undo</Text>
      </Pressable>
    </View>}
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add a row"
      onPress={() => router.push({ pathname: '/sheets/row/[id]', params: { id: 'new', sheetId: sheet.id, typeId: typeId ?? '' } })}
      style={{ bottom: insets.bottom + 20 }}
      className="absolute right-5 h-16 w-16 items-center justify-center rounded-full bg-white active:bg-surface-300"
    ><Plus color="#0a0a0a" size={30} strokeWidth={2.5} /></Pressable>

    <CellEditor
      sheet={sheet}
      row={editRow}
      column={editColumn}
      onClose={() => setEditing(null)}
      onStep={stepFrom}
    />
    <MenuSheet visible={columnMenu !== null} title={columnMenu?.name ?? ''} items={columnMenu ? columnItems(columnMenu) : []} onClose={() => setColumnMenu(null)} />
    <MenuSheet visible={rowMenu !== null} title={rowMenu ? rowName(sheet, rowMenu) || 'Untitled' : ''} items={rowMenu ? rowItems(rowMenu) : []} onClose={() => setRowMenu(null)} />
    <MenuSheet visible={panel === 'menu'} title={sheet.name} items={sheetItems} onClose={() => setPanel(null)} />
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
      hideNavigation={false}
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
      hideNavigation={false}
      onCancel={() => setDeletingSheet(false)}
      onConfirm={() => {
        setDeletingSheet(false)
        leaving.current = true
        void sheets.deleteSheet(sheet.id)
        router.back()
      }}
    />
  </View>
}

export default function SheetScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <SheetsGate><SheetView sheetId={id} /></SheetsGate>
}
