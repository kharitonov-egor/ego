import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  EMPTY_SHEET_VIEW, cellFits, cellText, convertCell, isEmptyCell, optionsForValues,
  type SheetCellValue, type SheetColumn, type SheetColumnType, type SheetInput, type SheetRowInput, type SheetRowType
} from '@ego/core'
import { cleanView } from './view'

export interface RowWrite {
  id: string
  input: SheetRowInput
}

export interface SheetEdit {
  input: SheetInput
  rows: RowWrite[]
}

export function sheetInput(sheet: SheetRecord): SheetInput {
  return {
    name: sheet.name, icon: sheet.icon, position: sheet.position, columns: sheet.columns, typesEnabled: sheet.typesEnabled,
    rowTypes: sheet.rowTypes, view: sheet.view, archivedAt: sheet.archivedAt
  }
}

export function rowInput(row: SheetRowRecord): SheetRowInput {
  return { sheetId: row.sheetId, typeId: row.typeId, cells: row.cells }
}

/** Sets one cell. An empty value leaves the cell out, so "empty" has one spelling. */
export function withCell(cells: Readonly<Record<string, SheetCellValue>>, columnId: string, value: SheetCellValue | null): Record<string, SheetCellValue> {
  const next = { ...cells }
  if (value === null || isEmptyCell(value) || (typeof value === 'string' && value.trim() === '')) delete next[columnId]
  else next[columnId] = value
  return next
}

/** Cells of deleted columns go when the row is next saved. */
export function keptCells(sheet: Pick<SheetInput, 'columns'>, cells: Readonly<Record<string, SheetCellValue>>): Record<string, SheetCellValue> {
  const ids = new Set(sheet.columns.map((column) => column.id))
  return Object.fromEntries(Object.entries(cells).filter(([id]) => ids.has(id)))
}

export function newColumn(id: string, name: string, type: SheetColumnType): SheetColumn {
  return { id, name: name.trim(), type, options: [], typeIds: null, hidden: false }
}

export function blankSheet(name: string, icon: string, position: number, newId: () => string): SheetInput {
  return {
    name: name.trim(),
    icon,
    position,
    columns: [newColumn(newId(), 'Name', 'text')],
    typesEnabled: false,
    rowTypes: [],
    view: EMPTY_SHEET_VIEW,
    archivedAt: null
  }
}

/** The sheet the empty Sheets screen offers: names only, with people and companies as row types. */
export function connectionsSheet(position: number, newId: () => string): SheetInput {
  return {
    ...blankSheet('Connections', '👥', position, newId),
    typesEnabled: true,
    rowTypes: [{ id: newId(), name: 'Person' }, { id: newId(), name: 'Company' }]
  }
}

function withSheet(input: SheetInput, change: Partial<SheetInput>): SheetInput {
  const next = { ...input, ...change }
  return { ...next, view: cleanView(next) }
}

export interface ColumnEdit extends SheetEdit {
  /** Values that do not fit the column's new type and now show in red. */
  unfit: number
}

/**
 * Swaps in a column's new definition and brings its cells along. A type change converts each
 * value it can; a text column turning into a dropdown or tags gets an option for every value it
 * held. Cells pointing at a deleted option lose it. Anything that cannot convert stays as typed.
 */
export function replaceColumn(input: SheetInput, rows: readonly SheetRowRecord[], next: SheetColumn, newId: () => string): ColumnEdit {
  const index = input.columns.findIndex((column) => column.id === next.id)
  if (index < 0) return { input, rows: [], unfit: 0 }
  const previous = input.columns[index]
  const owned = rows.filter((row) => row.cells[previous.id] !== undefined)
  const holdsOptions = (type: SheetColumnType): boolean => type === 'dropdown' || type === 'tags'
  let column = next
  if (holdsOptions(next.type) && !holdsOptions(previous.type)) {
    const texts = owned.map((row) => cellText(previous, row.cells[previous.id]))
    column = { ...next, options: optionsForValues(next.options, texts, next.type === 'tags', newId) }
  }
  const liveOptions = new Set(column.options.map((option) => option.id))
  const writes: RowWrite[] = []
  let unfit = 0
  for (const row of owned) {
    const value = row.cells[previous.id]
    let converted: SheetCellValue | null = previous.type === column.type ? value : convertCell(value, previous, column)
    if (holdsOptions(column.type) && holdsOptions(previous.type)) {
      if (typeof converted === 'string' && previous.options.some((option) => option.id === converted) && !liveOptions.has(converted)) converted = null
      if (Array.isArray(converted)) converted = converted.filter((id) => liveOptions.has(id) || !previous.options.some((option) => option.id === id))
    }
    if (converted !== null && !isEmptyCell(converted) && !cellFits(column, converted)) unfit += 1
    if (JSON.stringify(converted) === JSON.stringify(value)) continue
    writes.push({ id: row.id, input: { ...rowInput(row), cells: withCell(row.cells, column.id, converted) } })
  }
  const columns = input.columns.map((item, position) => position === index ? column : item)
  return { input: withSheet(input, { columns }), rows: writes, unfit }
}

/** Rows that would show red if `next` replaced its column now, before anything is saved. */
export function unfitAfter(input: SheetInput, rows: readonly SheetRowRecord[], next: SheetColumn): number {
  return replaceColumn(input, rows, next, () => 'preview').unfit
}

export function removeColumn(input: SheetInput, columnId: string): SheetInput {
  if (input.columns[0]?.id === columnId) return input
  return withSheet(input, { columns: input.columns.filter((column) => column.id !== columnId) })
}

/** Moves a column one place left or right. The name column stays first. */
export function shiftColumn(input: SheetInput, columnId: string, step: -1 | 1): SheetInput {
  const index = input.columns.findIndex((column) => column.id === columnId)
  const target = index + step
  if (index < 1 || target < 1 || target >= input.columns.length) return input
  const columns = [...input.columns]
  const [moved] = columns.splice(index, 1)
  columns.splice(target, 0, moved)
  return { ...input, columns }
}

/**
 * Turning types on gives every row without one the first type. The first time, that type is
 * `first`; after that the sheet keeps the types it had while they were off.
 */
export function turnOnTypes(input: SheetInput, rows: readonly SheetRowRecord[], first: SheetRowType | null): SheetEdit {
  const rowTypes = input.rowTypes.length > 0 ? input.rowTypes : first ? [first] : []
  const fallback = rowTypes[0]
  if (!fallback) return { input, rows: [] }
  const known = new Set(rowTypes.map((type) => type.id))
  const writes = rows
    .filter((row) => row.typeId === null || !known.has(row.typeId))
    .map((row) => ({ id: row.id, input: { ...rowInput(row), typeId: fallback.id } }))
  return { input: withSheet(input, { typesEnabled: true, rowTypes }), rows: writes }
}

/** A type goes only with somewhere for its rows to go, and a sheet with types keeps at least one. */
export function removeRowType(input: SheetInput, rows: readonly SheetRowRecord[], typeId: string, replacementId: string): SheetEdit {
  if (typeId === replacementId || !input.rowTypes.some((type) => type.id === replacementId)) return { input, rows: [] }
  const rowTypes = input.rowTypes.filter((type) => type.id !== typeId)
  const columns = input.columns.map((column) => {
    if (column.typeIds === null || !column.typeIds.includes(typeId)) return column
    const typeIds = column.typeIds.filter((id) => id !== typeId)
    return { ...column, typeIds: typeIds.length > 0 ? typeIds : [replacementId] }
  })
  const writes = rows
    .filter((row) => row.typeId === typeId)
    .map((row) => ({ id: row.id, input: { ...rowInput(row), typeId: replacementId } }))
  return { input: withSheet(input, { rowTypes, columns }), rows: writes }
}

/** A copy of a sheet: same columns and types, every row copied under new IDs. */
export function copiedRows(rows: readonly SheetRowRecord[], sheetId: string, newId: () => string): RowWrite[] {
  return rows.map((row) => ({ id: newId(), input: { sheetId, typeId: row.typeId, cells: row.cells } }))
}
