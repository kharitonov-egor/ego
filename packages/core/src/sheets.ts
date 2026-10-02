import { isDateString } from './money'
import { isTaskId, isTaskPosition } from './tasks'

/**
 * Sheets are small spreadsheets. A sheet is written as one record holding its columns, their
 * options, its row types, and how it is sorted and filtered. Each row is its own record whose
 * cells are keyed by column ID, so changing a column's type never rewrites the column itself.
 */

export const SHEET_COLUMN_TYPES = [
  'text', 'longText', 'number', 'date', 'checkbox', 'dropdown', 'tags', 'phone', 'email', 'link'
] as const
export type SheetColumnType = typeof SHEET_COLUMN_TYPES[number]

export const SHEET_COLUMN_TYPE_LABELS: Record<SheetColumnType, string> = {
  text: 'Text',
  longText: 'Long text',
  number: 'Number',
  date: 'Date',
  checkbox: 'Checkbox',
  dropdown: 'Dropdown',
  tags: 'Tags',
  phone: 'Phone',
  email: 'Email',
  link: 'Link'
}

/** Five greys from near white to near black. Options cycle through them as they are added. */
export const SHEET_SHADES = [0, 1, 2, 3, 4] as const
export type SheetShade = typeof SHEET_SHADES[number]

export interface SheetOption {
  id: string
  name: string
  shade: SheetShade
}

export interface SheetRowType {
  id: string
  name: string
}

export interface SheetColumn {
  id: string
  name: string
  type: SheetColumnType
  /** Dropdown and tags choices, in the order pickers list them. Other types keep theirs for a switch back. */
  options: SheetOption[]
  /** The row types this column applies to. Null applies it to every type. */
  typeIds: string[] | null
  /** Hidden from the grid only. The row page still shows it. */
  hidden: boolean
}

export type SheetSortDirection = 'asc' | 'desc'

export interface SheetSort {
  columnId: string
  direction: SheetSortDirection
}

export const SHEET_FILTER_OPERATORS = [
  'contains', 'notContains', 'is', 'isNot', 'empty', 'notEmpty', 'greater', 'less', 'before', 'after',
  'checked', 'unchecked', 'anyOf', 'noneOf', 'allOf'
] as const
export type SheetFilterOperator = typeof SHEET_FILTER_OPERATORS[number]

export type SheetFilterValue = string | number | string[] | null

export interface SheetFilter {
  id: string
  columnId: string
  operator: SheetFilterOperator
  value: SheetFilterValue
}

export interface SheetView {
  /** The row type chip above the grid. Null shows every type. */
  typeId: string | null
  sorts: SheetSort[]
  /** Every filter has to match. */
  filters: SheetFilter[]
  /** A dropdown column whose options split the grid into sections. */
  groupBy: string | null
}

export interface SheetInput {
  name: string
  /** One emoji, or empty. */
  icon: string
  position: number
  /** The first column is the row's name: always text, always shown, never deleted. */
  columns: SheetColumn[]
  typesEnabled: boolean
  rowTypes: SheetRowType[]
  view: SheetView
  archivedAt: string | null
}

export interface Sheet extends SheetInput {
  id: string
  createdAt: string
  updatedAt: string
}

/**
 * Text, phone, email, link, and dates are strings, numbers are numbers, a checked box is `true`,
 * a dropdown holds one option ID and tags hold several. An empty cell is left out of `cells`.
 * A value that does not fit its column's type is kept as it is, so the grid can point at it.
 */
export type SheetCellValue = string | number | boolean | string[]

export interface SheetRowInput {
  sheetId: string
  typeId: string | null
  cells: Record<string, SheetCellValue>
}

export interface SheetRow extends SheetRowInput {
  id: string
  createdAt: string
  updatedAt: string
}

export const SHEET_NAME_LIMIT = 120
export const SHEET_ICON_LIMIT = 16
export const SHEET_COLUMN_LIMIT = 100
export const SHEET_COLUMN_NAME_LIMIT = 60
export const SHEET_OPTION_LIMIT = 200
export const SHEET_OPTION_NAME_LIMIT = 60
export const SHEET_ROW_TYPE_LIMIT = 20
export const SHEET_ROW_TYPE_NAME_LIMIT = 40
export const SHEET_SORT_LIMIT = 3
export const SHEET_FILTER_LIMIT = 20
export const SHEET_FILTER_TEXT_LIMIT = 500
export const SHEET_TEXT_LIMIT = 10000
export const SHEET_TAG_LIMIT = 50
/** Room above the column limit for cells left behind by deleted columns. */
export const SHEET_CELL_LIMIT = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function uniqueIds(values: readonly { id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length
}

function isIdList(value: unknown, limit: number): value is string[] {
  return Array.isArray(value) && value.length <= limit && value.every(isTaskId) && new Set(value).size === value.length
}

export function isSheetColumnType(value: unknown): value is SheetColumnType {
  return (SHEET_COLUMN_TYPES as readonly unknown[]).includes(value)
}

function isOption(value: unknown): value is SheetOption {
  return isRecord(value) && isTaskId(value.id) && isText(value.name, 1, SHEET_OPTION_NAME_LIMIT) &&
    (SHEET_SHADES as readonly unknown[]).includes(value.shade)
}

function isColumn(value: unknown): value is SheetColumn {
  return isRecord(value) &&
    isTaskId(value.id) &&
    isText(value.name, 1, SHEET_COLUMN_NAME_LIMIT) &&
    isSheetColumnType(value.type) &&
    Array.isArray(value.options) && value.options.length <= SHEET_OPTION_LIMIT && value.options.every(isOption) &&
    uniqueIds(value.options) &&
    (value.typeIds === null || isIdList(value.typeIds, SHEET_ROW_TYPE_LIMIT)) &&
    typeof value.hidden === 'boolean'
}

function isRowType(value: unknown): value is SheetRowType {
  return isRecord(value) && isTaskId(value.id) && isText(value.name, 1, SHEET_ROW_TYPE_NAME_LIMIT)
}

function isSort(value: unknown): value is SheetSort {
  return isRecord(value) && isTaskId(value.columnId) && (value.direction === 'asc' || value.direction === 'desc')
}

function isFilterValue(value: unknown): value is SheetFilterValue {
  if (value === null) return true
  if (typeof value === 'string') return value.length <= SHEET_FILTER_TEXT_LIMIT
  if (typeof value === 'number') return Number.isFinite(value)
  return isIdList(value, SHEET_OPTION_LIMIT)
}

function isFilter(value: unknown): value is SheetFilter {
  return isRecord(value) && isTaskId(value.id) && isTaskId(value.columnId) &&
    (SHEET_FILTER_OPERATORS as readonly unknown[]).includes(value.operator) && isFilterValue(value.value)
}

function isView(value: unknown): value is SheetView {
  return isRecord(value) &&
    (value.typeId === null || isTaskId(value.typeId)) &&
    Array.isArray(value.sorts) && value.sorts.length <= SHEET_SORT_LIMIT && value.sorts.every(isSort) &&
    Array.isArray(value.filters) && value.filters.length <= SHEET_FILTER_LIMIT && value.filters.every(isFilter) &&
    uniqueIds(value.filters) &&
    (value.groupBy === null || isTaskId(value.groupBy))
}

export function isSheetInput(value: unknown): value is SheetInput {
  if (!isRecord(value)) return false
  if (!isText(value.name, 1, SHEET_NAME_LIMIT)) return false
  if (typeof value.icon !== 'string' || value.icon.length > SHEET_ICON_LIMIT) return false
  if (!isTaskPosition(value.position)) return false
  if (!Array.isArray(value.columns) || value.columns.length < 1 || value.columns.length > SHEET_COLUMN_LIMIT ||
    !value.columns.every(isColumn) || !uniqueIds(value.columns)) return false
  const name = value.columns[0] as SheetColumn
  if (name.type !== 'text' || name.hidden || name.typeIds !== null) return false
  if (typeof value.typesEnabled !== 'boolean') return false
  if (!Array.isArray(value.rowTypes) || value.rowTypes.length > SHEET_ROW_TYPE_LIMIT ||
    !value.rowTypes.every(isRowType) || !uniqueIds(value.rowTypes)) return false
  if (!isView(value.view)) return false
  return value.archivedAt === null || isTimestamp(value.archivedAt)
}

function isCellValue(value: unknown): value is SheetCellValue {
  if (typeof value === 'string') return value.length <= SHEET_TEXT_LIMIT
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  return isIdList(value, SHEET_TAG_LIMIT)
}

export function isSheetRowInput(value: unknown): value is SheetRowInput {
  if (!isRecord(value) || !isTaskId(value.sheetId)) return false
  if (value.typeId !== null && !isTaskId(value.typeId)) return false
  if (!isRecord(value.cells)) return false
  const entries = Object.entries(value.cells)
  return entries.length <= SHEET_CELL_LIMIT && entries.every(([key, cell]) => isTaskId(key) && isCellValue(cell))
}

export function isEmptyCell(value: SheetCellValue | undefined): boolean {
  return value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0)
}

/** Whether a stored value reads as its column's type. One that does not is drawn in red. */
export function cellFits(column: Pick<SheetColumn, 'type' | 'options'>, value: SheetCellValue): boolean {
  switch (column.type) {
    case 'text':
    case 'longText':
    case 'phone':
    case 'email':
    case 'link':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'date':
      return typeof value === 'string' && isDateString(value)
    case 'checkbox':
      return typeof value === 'boolean'
    case 'dropdown':
      return typeof value === 'string' && column.options.some((option) => option.id === value)
    case 'tags':
      return Array.isArray(value) && value.every((id) => column.options.some((option) => option.id === id))
  }
}

function optionName(options: readonly SheetOption[], id: string): string | null {
  return options.find((option) => option.id === id)?.name ?? null
}

/**
 * A cell as plain text, for search and for showing a value that no longer fits. Option IDs read
 * as option names when the column still has them.
 */
export function cellText(column: Pick<SheetColumn, 'options'>, value: SheetCellValue | undefined): string {
  if (value === undefined || value === false) return ''
  if (value === true) return 'Yes'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    return value.map((id) => optionName(column.options, id)).filter((name): name is string => name !== null).join(', ')
  }
  return optionName(column.options, value) ?? value
}

/** "1,200.50", "$45", and " 7 " all read as numbers. */
export function parseSheetNumber(text: string): number | null {
  const cleaned = text.trim().replace(/[,\s]/g, '').replace(/^[$€£]/, '')
  if (cleaned === '' || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function isoDate(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isDateString(iso) ? iso : null
}

function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year
}

/** ISO dates, US slashes ("3/4/2026"), and month names ("Mar 4, 2026" or "4 March 2026"). */
export function parseSheetDate(text: string): string | null {
  const trimmed = text.trim().toLowerCase()
  if (isDateString(trimmed)) return trimmed
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(trimmed)
  if (numeric) return isoDate(fullYear(Number(numeric[3])), Number(numeric[1]), Number(numeric[2]))
  const monthFirst = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(trimmed)
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(trimmed)
  const parts = monthFirst
    ? { month: monthFirst[1], day: monthFirst[2], year: monthFirst[3] }
    : dayFirst ? { month: dayFirst[2], day: dayFirst[1], year: dayFirst[3] } : null
  if (!parts) return null
  const month = MONTHS.indexOf(parts.month.slice(0, 3)) + 1
  return month > 0 ? isoDate(Number(parts.year), month, Number(parts.day)) : null
}

const TRUE_WORDS = ['yes', 'y', 'true', '1', 'x', '✓', '✔', 'checked', 'on', 'done']
const FALSE_WORDS = ['no', 'n', 'false', '0', 'unchecked', 'off']

export function parseSheetBoolean(text: string): boolean | null {
  const word = text.trim().toLowerCase()
  if (TRUE_WORDS.includes(word)) return true
  if (FALSE_WORDS.includes(word)) return false
  return null
}

function matchOption(options: readonly SheetOption[], name: string): SheetOption | null {
  const wanted = name.trim().toLowerCase()
  return options.find((option) => option.name.trim().toLowerCase() === wanted) ?? null
}

/** Tags written as text, like "NYU, hackathon". */
export function splitTagText(text: string): string[] {
  return text.split(/[,;\n]/).map((part) => part.trim()).filter((part) => part.length > 0)
}

export function nextShade(options: readonly SheetOption[]): SheetShade {
  return SHEET_SHADES[options.length % SHEET_SHADES.length]
}

/**
 * Options for the values a column is about to hold as a dropdown or tags, so a text column of
 * "Friend" and "Work" turns into those two options. Existing options come first and keep their IDs.
 */
export function optionsForValues(
  existing: readonly SheetOption[], texts: readonly string[], split: boolean, newId: () => string
): SheetOption[] {
  const options = [...existing]
  for (const text of texts) {
    for (const name of split ? splitTagText(text) : [text.trim()]) {
      if (name === '' || name.length > SHEET_OPTION_NAME_LIMIT || options.length >= SHEET_OPTION_LIMIT) continue
      if (matchOption(options, name)) continue
      options.push({ id: newId(), name, shade: nextShade(options) })
    }
  }
  return options
}

/**
 * The value a cell takes when its column changes from `from` to `to`. Null empties the cell. A
 * value that cannot be read as the new type comes back unchanged, so nothing typed is lost.
 */
export function convertCell(
  value: SheetCellValue, from: Pick<SheetColumn, 'type' | 'options'>, to: Pick<SheetColumn, 'type' | 'options'>
): SheetCellValue | null {
  if (isEmptyCell(value)) return null
  const holdsOptions = from.type === 'dropdown' || from.type === 'tags'
  if (!holdsOptions && cellFits(to, value)) return value
  if (holdsOptions && (to.type === 'dropdown' || to.type === 'tags')) {
    const ids = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    if (ids.length > 0 && ids.every((id) => to.options.some((option) => option.id === id))) {
      if (to.type === 'tags') return ids
      if (ids.length === 1) return ids[0]
    }
  }
  const text = cellText(from, value).trim()
  if (text === '') return null
  switch (to.type) {
    case 'text':
    case 'longText':
    case 'phone':
    case 'email':
    case 'link':
      return text
    case 'number':
      if (typeof value === 'boolean') return value ? 1 : 0
      return parseSheetNumber(text) ?? value
    case 'date':
      return parseSheetDate(text) ?? value
    case 'checkbox': {
      if (typeof value === 'number') return value !== 0 ? true : null
      const checked = parseSheetBoolean(text)
      return checked === null ? value : checked ? true : null
    }
    case 'dropdown':
      return matchOption(to.options, text)?.id ?? value
    case 'tags': {
      const matched = splitTagText(text).map((name) => matchOption(to.options, name))
      if (matched.some((option) => option === null)) return value
      return [...new Set(matched.map((option) => (option as SheetOption).id))]
    }
  }
}

export const EMPTY_SHEET_VIEW: SheetView = { typeId: null, sorts: [], filters: [], groupBy: null }

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Reads the JSON columns of a stored sheet or row, dropping anything that is not the right shape. */
export function parseSheetColumns(raw: string): SheetColumn[] {
  const value = parsed(raw)
  return Array.isArray(value) ? value.filter(isColumn) : []
}

export function parseSheetRowTypes(raw: string): SheetRowType[] {
  const value = parsed(raw)
  return Array.isArray(value) ? value.filter(isRowType) : []
}

export function parseSheetView(raw: string): SheetView {
  const value = parsed(raw)
  return isView(value) ? value : EMPTY_SHEET_VIEW
}

export function parseSheetCells(raw: string): Record<string, SheetCellValue> {
  const value = parsed(raw)
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, SheetCellValue] => isCellValue(entry[1])))
}
