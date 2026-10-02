import { describe, expect, it } from 'vitest'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import type { SheetColumn, SheetView } from '@ego/core'
import {
  connectionsSheet, removeRowType, replaceColumn, rowInput, sheetInput, shiftColumn, turnOnTypes, withCell
} from '../lib/sheets/edits'
import {
  activeFilters, cellState, cleanView, dateLabel, gridColumns, linkLabel, linkUrl, sheetGrid, sortRows
} from '../lib/sheets/view'

const STAMP = '2026-09-01T00:00:00.000Z'
const TODAY = new Date(2026, 9, 2)

const column = (overrides: Partial<SheetColumn> = {}): SheetColumn => ({
  id: 'c-x', name: 'Column', type: 'text', options: [], typeIds: null, hidden: false, ...overrides
})

const CLOSENESS = column({
  id: 'c-close', name: 'Closeness', type: 'dropdown',
  options: [{ id: 'o-close', name: 'Close friend', shade: 0 }, { id: 'o-friend', name: 'Friend', shade: 1 }]
})
const MET = column({
  id: 'c-met', name: 'Met at', type: 'tags', typeIds: ['t-person'],
  options: [{ id: 'o-nyu', name: 'NYU', shade: 0 }, { id: 'o-hack', name: 'Hackathon', shade: 1 }]
})
const SIZE = column({ id: 'c-size', name: 'Size', type: 'number', typeIds: ['t-company'] })
const BIRTHDAY = column({ id: 'c-birthday', name: 'Birthday', type: 'date', typeIds: ['t-person'] })

const sheet = (overrides: Partial<SheetRecord> = {}, view: Partial<SheetView> = {}): SheetRecord => ({
  id: 's-1', name: 'Connections', icon: '👥', position: 1024,
  columns: [column({ id: 'name', name: 'Name' }), CLOSENESS, MET, SIZE, BIRTHDAY],
  typesEnabled: true,
  rowTypes: [{ id: 't-person', name: 'Person' }, { id: 't-company', name: 'Company' }],
  view: { typeId: null, sorts: [], filters: [], groupBy: null, ...view },
  archivedAt: null, createdAt: STAMP, updatedAt: STAMP, revision: 1,
  ...overrides
})

let order = 0
const row = (id: string, cells: SheetRowRecord['cells'], typeId: string | null = 't-person'): SheetRowRecord => {
  order += 1
  return { id, sheetId: 's-1', typeId, cells, createdAt: `2026-09-${String(order).padStart(2, '0')}T00:00:00.000Z`, updatedAt: STAMP, revision: 1 }
}

const alex = row('r-alex', { name: 'Alex', 'c-close': 'o-close', 'c-met': ['o-nyu', 'o-hack'], 'c-birthday': '1999-03-04' })
const sam = row('r-sam', { name: 'sam', 'c-close': 'o-friend', 'c-met': ['o-hack'] })
const stripe = row('r-stripe', { name: 'Stripe', 'c-size': 8000 }, 't-company')
const dana = row('r-dana', { name: 'Dana' })
const ROWS = [alex, sam, stripe, dana]

const names = (rows: readonly SheetRowRecord[]): string[] => rows.map((item) => String(item.cells.name))

describe('which cells apply', () => {
  it('marks columns a row type does not use', () => {
    expect(cellState(sheet(), SIZE, alex)).toEqual({ kind: 'none' })
    expect(cellState(sheet(), SIZE, stripe)).toEqual({ kind: 'value', value: 8000 })
    expect(cellState(sheet({ typesEnabled: false }), SIZE, alex)).toEqual({ kind: 'empty' })
  })

  it('points at values that no longer fit', () => {
    const odd = row('r-odd', { name: 'Odd', 'c-size': 'about 50', 'c-close': 'o-deleted' }, 't-company')
    expect(cellState(sheet(), SIZE, odd)).toEqual({ kind: 'mismatch', text: 'about 50' })
    expect(cellState(sheet(), CLOSENESS, odd)).toEqual({ kind: 'mismatch', text: 'o-deleted' })
    expect(cellState(sheet(), CLOSENESS, { ...odd, cells: { 'c-close': ['o-gone'] } })).toEqual({ kind: 'mismatch', text: 'Removed option' })
  })

  it('hides the columns a type chip does not use, keeping the name first', () => {
    expect(gridColumns(sheet()).map((item) => item.id)).toEqual(['name', 'c-close', 'c-met', 'c-size', 'c-birthday'])
    expect(gridColumns(sheet({}, { typeId: 't-company' })).map((item) => item.id)).toEqual(['name', 'c-close', 'c-size'])
    const hidden = sheet({ columns: [column({ id: 'name' }), { ...CLOSENESS, hidden: true }] })
    expect(gridColumns(hidden).map((item) => item.id)).toEqual(['name'])
  })
})

describe('the grid', () => {
  it('shows the newest rows first when nothing is sorted', () => {
    expect(names(sheetGrid(sheet(), ROWS, '', new Set(), TODAY).ordered)).toEqual(['Dana', 'Stripe', 'sam', 'Alex'])
  })

  it('sorts by name ignoring case, and leaves empty cells last both ways', () => {
    const byName = sheet({}, { sorts: [{ columnId: 'name', direction: 'asc' }] })
    expect(names(sortRows(byName, ROWS))).toEqual(['Alex', 'Dana', 'sam', 'Stripe'])
    const byCloseness = sheet({}, { sorts: [{ columnId: 'c-close', direction: 'desc' }] })
    expect(names(sortRows(byCloseness, ROWS))).toEqual(['sam', 'Alex', 'Dana', 'Stripe'])
  })

  it('filters by type chip, rules, and search together', () => {
    const people = sheet({}, { typeId: 't-person' })
    expect(names(sheetGrid(people, ROWS, '', new Set(), TODAY).ordered)).toEqual(['Dana', 'sam', 'Alex'])
    const nyu = sheet({}, { filters: [{ id: 'f-1', columnId: 'c-met', operator: 'anyOf', value: ['o-nyu'] }] })
    expect(names(sheetGrid(nyu, ROWS, '', new Set(), TODAY).ordered)).toEqual(['Alex'])
    const big = sheet({}, { filters: [{ id: 'f-1', columnId: 'c-size', operator: 'greater', value: 100 }] })
    expect(names(sheetGrid(big, ROWS, '', new Set(), TODAY).ordered)).toEqual(['Stripe'])
    expect(names(sheetGrid(sheet(), ROWS, 'hackathon', new Set(), TODAY).ordered)).toEqual(['sam', 'Alex'])
    expect(names(sheetGrid(sheet(), ROWS, 'mar 4', new Set(), TODAY).ordered)).toEqual(['Alex'])
    expect(names(sheetGrid(sheet(), ROWS, 'company', new Set(), TODAY).ordered)).toEqual(['Stripe'])
  })

  it('ignores filters that are not filled in yet', () => {
    const unfinished = sheet({}, { filters: [{ id: 'f-1', columnId: 'c-met', operator: 'anyOf', value: [] }] })
    expect(activeFilters(unfinished)).toEqual([])
    expect(sheetGrid(unfinished, ROWS, '', new Set(), TODAY).shown).toBe(4)
  })

  it('groups by a dropdown in option order, with empty cells last', () => {
    const grouped = sheet({}, { groupBy: 'c-close', sorts: [{ columnId: 'name', direction: 'asc' }] })
    const grid = sheetGrid(grouped, ROWS, '', new Set(['__none']), TODAY)
    expect(grid.items.map((item) => item.kind === 'section' ? `[${item.title} ${item.count}]` : String(item.row.cells.name)))
      .toEqual(['[Close friend 1]', 'Alex', '[Friend 1]', 'sam', '[No value 2]'])
    expect(names(grid.ordered)).toEqual(['Alex', 'sam', 'Dana', 'Stripe'])
  })
})

describe('labels', () => {
  it('drops the year for this year', () => {
    expect(dateLabel('2026-03-04', TODAY)).toBe('Mar 4')
    expect(dateLabel('1999-03-04', TODAY)).toBe('Mar 4, 1999')
  })

  it('shortens links and adds a scheme to bare ones', () => {
    expect(linkLabel('https://www.linkedin.com/in/alex/')).toBe('linkedin.com/in/alex')
    expect(linkUrl('linkedin.com/in/alex')).toBe('https://linkedin.com/in/alex')
    expect(linkUrl('mailto:a@b.co')).toBe('mailto:a@b.co')
  })
})

describe('editing structure', () => {
  let next = 0
  const newId = (): string => `n-${++next}`

  it('turns a text column into a dropdown with an option per value', () => {
    const where = column({ id: 'c-where', name: 'City', type: 'text' })
    const input = { ...sheetInput(sheet()), columns: [...sheet().columns, where] }
    const rows = [row('r-1', { name: 'A', 'c-where': 'NYC' }), row('r-2', { name: 'B', 'c-where': 'nyc' }), row('r-3', { name: 'C', 'c-where': 'SF' })]
    const edit = replaceColumn(input, rows, { ...where, type: 'dropdown' }, newId)
    const city = edit.input.columns.find((item) => item.id === 'c-where')
    expect(city?.options.map((option) => option.name)).toEqual(['NYC', 'SF'])
    expect(edit.rows.map((write) => write.input.cells['c-where'])).toEqual([city?.options[0].id, city?.options[0].id, city?.options[1].id])
    expect(edit.unfit).toBe(0)
  })

  it('keeps values a number column cannot read and counts them', () => {
    const notes = column({ id: 'c-notes', type: 'text' })
    const input = { ...sheetInput(sheet()), columns: [...sheet().columns, notes] }
    const rows = [row('r-1', { 'c-notes': '42' }), row('r-2', { 'c-notes': 'lots' })]
    const edit = replaceColumn(input, rows, { ...notes, type: 'number' }, newId)
    expect(edit.rows.map((write) => write.input.cells['c-notes'])).toEqual([42])
    expect(edit.unfit).toBe(1)
  })

  it('clears a deleted option from the cells that used it and drops its filters', () => {
    const input = {
      ...sheetInput(sheet({}, { filters: [{ id: 'f-1', columnId: 'c-close', operator: 'anyOf', value: ['o-close'] }], groupBy: 'c-close' }))
    }
    const edit = replaceColumn(input, ROWS, { ...CLOSENESS, options: [CLOSENESS.options[1]] }, newId)
    expect(edit.rows).toEqual([{ id: 'r-alex', input: { ...rowInput(alex), cells: withCell(alex.cells, 'c-close', null) } }])
    expect(edit.input.view.groupBy).toBe('c-close')
    const retyped = replaceColumn(input, ROWS, { ...CLOSENESS, type: 'text' }, newId)
    expect(retyped.input.view.filters).toEqual([])
    expect(retyped.input.view.groupBy).toBeNull()
  })

  it('moves columns but never past the name', () => {
    const input = sheetInput(sheet())
    expect(shiftColumn(input, 'c-close', -1)).toBe(input)
    expect(shiftColumn(input, 'c-close', 1).columns.map((item) => item.id)).toEqual(['name', 'c-met', 'c-close', 'c-size', 'c-birthday'])
  })

  it('gives untyped rows the first type when types turn on', () => {
    const plain = { ...sheetInput(sheet()), typesEnabled: false, rowTypes: [] }
    const edit = turnOnTypes(plain, [dana, { ...sam, typeId: null }], { id: 't-new', name: 'Person' })
    expect(edit.input).toMatchObject({ typesEnabled: true, rowTypes: [{ id: 't-new', name: 'Person' }] })
    expect(edit.rows.map((write) => write.input.typeId)).toEqual(['t-new', 't-new'])
  })

  it('moves a deleted type\'s rows and columns to its replacement', () => {
    const edit = removeRowType(sheetInput(sheet({}, { typeId: 't-company' })), ROWS, 't-company', 't-person')
    expect(edit.input.rowTypes.map((type) => type.name)).toEqual(['Person'])
    expect(edit.input.columns.find((item) => item.id === 'c-size')?.typeIds).toEqual(['t-person'])
    expect(edit.input.view.typeId).toBeNull()
    expect(edit.rows).toEqual([{ id: 'r-stripe', input: { ...rowInput(stripe), typeId: 't-person' } }])
  })

  it('starts Connections with a name column and two types', () => {
    const input = connectionsSheet(1024, newId)
    expect(input.columns.map((item) => item.name)).toEqual(['Name'])
    expect(input.rowTypes.map((type) => type.name)).toEqual(['Person', 'Company'])
    expect(cleanView(input)).toEqual(input.view)
  })
})
