import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  SHEET_FILTER_LIMIT, cellFits, cellText, isEmptyCell,
  type SheetCellValue, type SheetColumn, type SheetColumnType, type SheetFilter, type SheetFilterOperator,
  type SheetInput, type SheetOption, type SheetRowType, type SheetSortDirection, type SheetView
} from '@ego/core'

type SheetLike = Pick<SheetInput, 'columns' | 'typesEnabled' | 'rowTypes' | 'view'>

export function nameColumn(sheet: Pick<SheetInput, 'columns'>): SheetColumn {
  return sheet.columns[0]
}

export function rowName(sheet: Pick<SheetInput, 'columns'>, row: Pick<SheetRowRecord, 'cells'>): string {
  const value = row.cells[nameColumn(sheet).id]
  return typeof value === 'string' ? value : value === undefined ? '' : cellText(nameColumn(sheet), value)
}

export function rowTypeOf(sheet: SheetLike, typeId: string | null): SheetRowType | null {
  if (!sheet.typesEnabled || typeId === null) return null
  return sheet.rowTypes.find((type) => type.id === typeId) ?? null
}

/** A column limited to some row types does not apply to a row of another type, or to one with no type. */
export function columnApplies(sheet: SheetLike, column: SheetColumn, typeId: string | null): boolean {
  if (!sheet.typesEnabled || column.typeIds === null) return true
  const type = rowTypeOf(sheet, typeId)
  return type !== null && column.typeIds.includes(type.id)
}

/** The type chip that is on, if it still names a type. */
export function activeTypeId(sheet: SheetLike): string | null {
  return rowTypeOf(sheet, sheet.view.typeId)?.id ?? null
}

/** Columns the grid draws, name first. A type chip hides the columns that type does not use. */
export function gridColumns(sheet: SheetLike): SheetColumn[] {
  const typeId = activeTypeId(sheet)
  return sheet.columns.filter((column, index) => index === 0 ||
    (!column.hidden && (typeId === null || columnApplies(sheet, column, typeId))))
}

/** The fields a row's page shows, hidden columns included. */
export function formColumns(sheet: SheetLike, typeId: string | null): SheetColumn[] {
  return sheet.columns.slice(1).filter((column) => columnApplies(sheet, column, typeId))
}

export type CellState =
  | { kind: 'empty' }
  | { kind: 'value'; value: SheetCellValue }
  | { kind: 'mismatch'; text: string }
  | { kind: 'none' }

/** What a cell holds as far as the grid is concerned. `none` is a column that does not apply to the row. */
export function cellState(sheet: SheetLike, column: SheetColumn, row: Pick<SheetRowRecord, 'cells' | 'typeId'>): CellState {
  if (!columnApplies(sheet, column, row.typeId)) return { kind: 'none' }
  const value = row.cells[column.id]
  if (value === undefined || isEmptyCell(value)) return { kind: 'empty' }
  if (cellFits(column, value)) return { kind: 'value', value }
  const text = cellText(column, value)
  return text === '' ? { kind: 'mismatch', text: 'Removed option' } : { kind: 'mismatch', text }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Mar 4", with the year only when it is not this one. */
export function dateLabel(iso: string, today: Date): string {
  const [year, month, day] = iso.split('-').map(Number)
  return `${MONTHS[month - 1]} ${day}${year !== today.getFullYear() ? `, ${year}` : ''}`
}

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 })

export function numberLabel(value: number): string {
  return NUMBER.format(value)
}

/** "linkedin.com/in/alex" for "https://www.linkedin.com/in/alex/". */
export function linkLabel(text: string): string {
  return text.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
}

export function linkUrl(text: string): string {
  const trimmed = text.trim()
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** WhatsApp wants the number with its country code and nothing else. */
export function phoneDigits(text: string): string {
  return text.replace(/[^\d]/g, '')
}

export function optionOf(column: Pick<SheetColumn, 'options'>, id: string): SheetOption | null {
  return column.options.find((option) => option.id === id) ?? null
}

/** A value as one line of text, the way the grid would read it aloud. */
export function valueLabel(column: SheetColumn, value: SheetCellValue, today: Date): string {
  if (column.type === 'date' && typeof value === 'string') return dateLabel(value, today)
  if (column.type === 'number' && typeof value === 'number') return numberLabel(value)
  if (column.type === 'link' && typeof value === 'string') return linkLabel(value)
  if (column.type === 'checkbox') return value === true ? 'Checked' : ''
  return cellText(column, value)
}

export const OPERATOR_LABELS: Record<SheetFilterOperator, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  is: 'is',
  isNot: 'is not',
  empty: 'is empty',
  notEmpty: 'is not empty',
  greater: 'is more than',
  less: 'is less than',
  before: 'is before',
  after: 'is after',
  checked: 'is checked',
  unchecked: 'is not checked',
  anyOf: 'is any of',
  noneOf: 'is none of',
  allOf: 'has all of'
}

export function operatorsFor(type: SheetColumnType): SheetFilterOperator[] {
  switch (type) {
    case 'text':
    case 'longText':
    case 'phone':
    case 'email':
    case 'link':
      return ['contains', 'notContains', 'is', 'isNot', 'empty', 'notEmpty']
    case 'number':
      return ['is', 'isNot', 'greater', 'less', 'empty', 'notEmpty']
    case 'date':
      return ['is', 'before', 'after', 'empty', 'notEmpty']
    case 'checkbox':
      return ['checked', 'unchecked']
    case 'dropdown':
      return ['anyOf', 'noneOf', 'empty', 'notEmpty']
    case 'tags':
      return ['anyOf', 'allOf', 'noneOf', 'empty', 'notEmpty']
  }
}

/** Operators that need no value to compare against. */
export function operatorTakesValue(operator: SheetFilterOperator): boolean {
  return !['empty', 'notEmpty', 'checked', 'unchecked'].includes(operator)
}

export function sortLabels(type: SheetColumnType): Record<SheetSortDirection, string> {
  switch (type) {
    case 'number': return { asc: '1 → 9', desc: '9 → 1' }
    case 'date': return { asc: 'Oldest first', desc: 'Newest first' }
    case 'checkbox': return { asc: 'Unchecked first', desc: 'Checked first' }
    case 'dropdown':
    case 'tags': return { asc: 'Option order', desc: 'Reverse order' }
    default: return { asc: 'A → Z', desc: 'Z → A' }
  }
}

function filterReady(filter: SheetFilter): boolean {
  if (!operatorTakesValue(filter.operator)) return true
  const value = filter.value
  if (value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** Filters that name a live column, use an operator its type offers, and have something to compare. */
export function activeFilters(sheet: SheetLike): SheetFilter[] {
  return sheet.view.filters.filter((filter) => {
    const column = sheet.columns.find((item) => item.id === filter.columnId)
    return column !== undefined && operatorsFor(column.type).includes(filter.operator) && filterReady(filter)
  })
}

function fittingValue(sheet: SheetLike, column: SheetColumn, row: Pick<SheetRowRecord, 'cells' | 'typeId'>): SheetCellValue | undefined {
  const state = cellState(sheet, column, row)
  return state.kind === 'value' ? state.value : undefined
}

function optionIds(value: SheetCellValue | undefined): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value : []
}

export function matchesFilter(sheet: SheetLike, filter: SheetFilter, row: Pick<SheetRowRecord, 'cells' | 'typeId'>): boolean {
  const column = sheet.columns.find((item) => item.id === filter.columnId)
  if (!column) return true
  const state = cellState(sheet, column, row)
  const empty = state.kind === 'empty' || state.kind === 'none'
  const value = fittingValue(sheet, column, row)
  const wanted = filter.value
  switch (filter.operator) {
    case 'empty': return empty
    case 'notEmpty': return !empty
    case 'checked': return value === true
    case 'unchecked': return value !== true
    case 'contains':
    case 'notContains': {
      const text = state.kind === 'mismatch' ? state.text : value === undefined ? '' : cellText(column, value)
      const found = typeof wanted === 'string' && text.toLowerCase().includes(wanted.trim().toLowerCase())
      return filter.operator === 'contains' ? found : !found
    }
    case 'is':
    case 'isNot': {
      let same = false
      if (column.type === 'number') same = typeof value === 'number' && value === Number(wanted)
      else if (typeof value === 'string' && typeof wanted === 'string') same = value.trim().toLowerCase() === wanted.trim().toLowerCase()
      return filter.operator === 'is' ? same : !same
    }
    case 'greater': return typeof value === 'number' && value > Number(wanted)
    case 'less': return typeof value === 'number' && value < Number(wanted)
    case 'before': return typeof value === 'string' && typeof wanted === 'string' && value < wanted
    case 'after': return typeof value === 'string' && typeof wanted === 'string' && value > wanted
    case 'anyOf':
    case 'noneOf': {
      const ids = optionIds(value)
      const any = Array.isArray(wanted) && wanted.some((id) => ids.includes(id))
      return filter.operator === 'anyOf' ? any : !any
    }
    case 'allOf': {
      const ids = optionIds(value)
      return Array.isArray(wanted) && wanted.every((id) => ids.includes(id))
    }
  }
}

/** Everything a search can find in a row: every cell it shows, dates both ways, and its type. */
export function searchText(sheet: SheetLike, row: Pick<SheetRowRecord, 'cells' | 'typeId'>, today: Date): string {
  const parts: string[] = []
  for (const column of sheet.columns) {
    const state = cellState(sheet, column, row)
    if (state.kind === 'mismatch') parts.push(state.text)
    if (state.kind !== 'value') continue
    parts.push(cellText(column, state.value))
    if (column.type === 'date' && typeof state.value === 'string') parts.push(dateLabel(state.value, today))
  }
  const type = rowTypeOf(sheet, row.typeId)
  if (type) parts.push(type.name)
  return parts.join('\n').toLowerCase()
}

interface SortKey {
  /** Fitting values first, then ones that do not fit, then empty cells, whichever way the sort runs. */
  rank: 0 | 1 | 2
  number: number
  text: string
}

function sortKey(sheet: SheetLike, column: SheetColumn, row: Pick<SheetRowRecord, 'cells' | 'typeId'>): SortKey {
  const state = cellState(sheet, column, row)
  if (column.type === 'checkbox' && state.kind !== 'none' && state.kind !== 'mismatch') {
    return { rank: 0, number: state.kind === 'value' && state.value === true ? 1 : 0, text: '' }
  }
  if (state.kind === 'empty' || state.kind === 'none') return { rank: 2, number: 0, text: '' }
  if (state.kind === 'mismatch') return { rank: 1, number: 0, text: state.text.toLowerCase() }
  const value = state.value
  if (typeof value === 'number') return { rank: 0, number: value, text: '' }
  if (column.type === 'dropdown' || column.type === 'tags') {
    const ids = optionIds(value)
    const first = ids.length > 0 ? column.options.findIndex((option) => option.id === ids[0]) : -1
    return { rank: 0, number: first, text: cellText(column, value).toLowerCase() }
  }
  return { rank: 0, number: 0, text: cellText(column, value).toLowerCase() }
}

function compareKeys(left: SortKey, right: SortKey, direction: SheetSortDirection): number {
  if (left.rank !== right.rank) return left.rank - right.rank
  const sign = direction === 'asc' ? 1 : -1
  if (left.number !== right.number) return (left.number - right.number) * sign
  return left.text.localeCompare(right.text) * sign
}

/** Newest first unless a sort says otherwise. Ties keep that order. */
export function sortRows<T extends Pick<SheetRowRecord, 'id' | 'cells' | 'typeId' | 'createdAt'>>(sheet: SheetLike, rows: readonly T[]): T[] {
  const sorts = sheet.view.sorts
    .map((sort) => ({ sort, column: sheet.columns.find((column) => column.id === sort.columnId) }))
    .filter((entry): entry is { sort: typeof entry.sort; column: SheetColumn } => entry.column !== undefined)
  const keyed = rows.map((row) => ({ row, keys: sorts.map(({ column }) => sortKey(sheet, column, row)) }))
  keyed.sort((left, right) => {
    for (let index = 0; index < sorts.length; index += 1) {
      const order = compareKeys(left.keys[index], right.keys[index], sorts[index].sort.direction)
      if (order !== 0) return order
    }
    if (left.row.createdAt !== right.row.createdAt) return left.row.createdAt < right.row.createdAt ? 1 : -1
    return left.row.id < right.row.id ? 1 : -1
  })
  return keyed.map((entry) => entry.row)
}

export const NO_VALUE_SECTION = '__none'

export type GridItem<T> =
  | { kind: 'section'; key: string; title: string; count: number; option: SheetOption | null; collapsed: boolean }
  | { kind: 'row'; row: T }

export interface Grid<T> {
  items: GridItem<T>[]
  /** Every row in the sheet. */
  total: number
  /** Rows left after the type chip, filters, and search. */
  shown: number
  /** Rows in display order, collapsed sections included, for stepping from cell to cell. */
  ordered: T[]
}

/** The rows a sheet shows, filtered, searched, sorted, and split into sections when grouped. */
export function sheetGrid<T extends SheetRowRecord>(
  sheet: SheetLike, rows: readonly T[], search: string, collapsed: ReadonlySet<string>, today: Date
): Grid<T> {
  const typeId = activeTypeId(sheet)
  const filters = activeFilters(sheet)
  const query = search.trim().toLowerCase()
  const kept = rows.filter((row) => (typeId === null || row.typeId === typeId) &&
    filters.every((filter) => matchesFilter(sheet, filter, row)) &&
    (query === '' || searchText(sheet, row, today).includes(query)))
  const ordered = sortRows(sheet, kept)
  const group = sheet.view.groupBy ? sheet.columns.find((column) => column.id === sheet.view.groupBy && column.type === 'dropdown') : undefined
  if (!group) return { items: ordered.map((row) => ({ kind: 'row', row })), total: rows.length, shown: kept.length, ordered }
  const sections = new Map<string, T[]>()
  for (const row of ordered) {
    const value = fittingValue(sheet, group, row)
    const key = typeof value === 'string' ? value : NO_VALUE_SECTION
    sections.set(key, [...sections.get(key) ?? [], row])
  }
  const items: GridItem<T>[] = []
  const grouped: T[] = []
  const keys = [...group.options.map((option) => option.id), NO_VALUE_SECTION]
  for (const key of keys) {
    const members = sections.get(key)
    if (!members) continue
    const option = key === NO_VALUE_SECTION ? null : optionOf(group, key)
    const closed = collapsed.has(key)
    items.push({ kind: 'section', key, title: option?.name ?? 'No value', count: members.length, option, collapsed: closed })
    grouped.push(...members)
    if (!closed) items.push(...members.map((row): GridItem<T> => ({ kind: 'row', row })))
  }
  return { items, total: rows.length, shown: kept.length, ordered: grouped }
}

/**
 * Drops what a structural change left pointing at nothing: sorts and filters on deleted columns,
 * filters whose operator the column's new type does not offer, a group on a column that is no
 * longer a dropdown, and a type chip for a deleted type.
 */
export function cleanView(sheet: Pick<SheetInput, 'columns' | 'rowTypes' | 'view'>): SheetView {
  const column = (id: string): SheetColumn | undefined => sheet.columns.find((item) => item.id === id)
  const filters = sheet.view.filters.filter((filter) => {
    const target = column(filter.columnId)
    return target !== undefined && operatorsFor(target.type).includes(filter.operator)
  }).slice(0, SHEET_FILTER_LIMIT)
  const group = sheet.view.groupBy ? column(sheet.view.groupBy) : undefined
  return {
    typeId: sheet.view.typeId !== null && sheet.rowTypes.some((type) => type.id === sheet.view.typeId) ? sheet.view.typeId : null,
    sorts: sheet.view.sorts.filter((sort) => column(sort.columnId) !== undefined),
    filters,
    groupBy: group?.type === 'dropdown' ? group.id : null
  }
}

export function sheetSummary(sheet: SheetRecord, rows: readonly SheetRowRecord[]): string {
  const count = rows.filter((row) => row.sheetId === sheet.id).length
  const columns = sheet.columns.length
  return `${count === 1 ? '1 row' : `${count} rows`} · ${columns === 1 ? '1 column' : `${columns} columns`}`
}
