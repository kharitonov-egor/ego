import { describe, expect, it } from 'vitest'
import {
  cellFits, cellText, convertCell, isSheetInput, isSheetRowInput, optionsForValues, parseSheetBoolean, parseSheetDate,
  parseSheetNumber, splitTagText,
  type SheetColumn, type SheetInput, type SheetOption
} from '../src/sheets'

const column = (overrides: Partial<SheetColumn> = {}): SheetColumn => ({
  id: 'c-1', name: 'Notes', type: 'text', options: [], typeIds: null, hidden: false, ...overrides
})

const sheet = (overrides: Partial<SheetInput> = {}): SheetInput => ({
  name: 'Connections',
  icon: '👥',
  position: 1024,
  columns: [column({ id: 'name', name: 'Name' })],
  typesEnabled: false,
  rowTypes: [],
  view: { typeId: null, sorts: [], filters: [], groupBy: null },
  archivedAt: null,
  ...overrides
})

const FRIEND: SheetOption = { id: 'o-friend', name: 'Friend', shade: 0 }
const WORK: SheetOption = { id: 'o-work', name: 'Work', shade: 1 }

describe('sheet validation', () => {
  it('accepts a sheet whose first column is a plain text name', () => {
    expect(isSheetInput(sheet())).toBe(true)
    expect(isSheetInput(sheet({
      columns: [column({ id: 'name', name: 'Name' }), column({ id: 'c-2', name: 'Met at', type: 'tags', options: [FRIEND, WORK], typeIds: ['t-1'] })],
      typesEnabled: true,
      rowTypes: [{ id: 't-1', name: 'Person' }],
      view: {
        typeId: 't-1',
        sorts: [{ columnId: 'name', direction: 'asc' }],
        filters: [{ id: 'f-1', columnId: 'c-2', operator: 'anyOf', value: ['o-friend'] }],
        groupBy: null
      }
    }))).toBe(true)
  })

  it('rejects a name column that is not text, hidden, or limited to types', () => {
    expect(isSheetInput(sheet({ columns: [column({ id: 'name', type: 'number' })] }))).toBe(false)
    expect(isSheetInput(sheet({ columns: [column({ id: 'name', hidden: true })] }))).toBe(false)
    expect(isSheetInput(sheet({ columns: [column({ id: 'name', typeIds: ['t-1'] })] }))).toBe(false)
    expect(isSheetInput(sheet({ columns: [] }))).toBe(false)
  })

  it('rejects duplicate IDs, blank names, and too many sorts', () => {
    expect(isSheetInput(sheet({ columns: [column({ id: 'name' }), column({ id: 'name' })] }))).toBe(false)
    expect(isSheetInput(sheet({ name: '  ' }))).toBe(false)
    expect(isSheetInput(sheet({
      columns: [column({ id: 'name' }), column({ id: 'c-2', type: 'dropdown', options: [FRIEND, { ...WORK, id: FRIEND.id }] })]
    }))).toBe(false)
    const sorts = ['a', 'b', 'c', 'd'].map((id) => ({ columnId: id, direction: 'asc' as const }))
    expect(isSheetInput(sheet({ view: { typeId: null, sorts, filters: [], groupBy: null } }))).toBe(false)
  })

  it('checks row cells by shape, not against the sheet', () => {
    expect(isSheetRowInput({ sheetId: 's-1', typeId: null, cells: { name: 'Alex', 'c-2': 3, 'c-3': true, 'c-4': ['o-1', 'o-2'] } })).toBe(true)
    expect(isSheetRowInput({ sheetId: 's-1', typeId: null, cells: { 'c-4': ['o-1', 'o-1'] } })).toBe(false)
    expect(isSheetRowInput({ sheetId: 's-1', typeId: null, cells: { 'c-2': Number.NaN } })).toBe(false)
    expect(isSheetRowInput({ sheetId: 's-1', typeId: null, cells: { 'bad key': 'x' } })).toBe(false)
    expect(isSheetRowInput({ sheetId: 's-1', typeId: null, cells: { name: { nested: true } } })).toBe(false)
  })
})

describe('reading values', () => {
  it('parses numbers people type', () => {
    expect(parseSheetNumber('1,200.50')).toBe(1200.5)
    expect(parseSheetNumber(' $45 ')).toBe(45)
    expect(parseSheetNumber('-3')).toBe(-3)
    expect(parseSheetNumber('12 apples')).toBeNull()
    expect(parseSheetNumber('')).toBeNull()
  })

  it('parses dates in a few common shapes', () => {
    expect(parseSheetDate('2026-03-04')).toBe('2026-03-04')
    expect(parseSheetDate('3/4/2026')).toBe('2026-03-04')
    expect(parseSheetDate('3/4/26')).toBe('2026-03-04')
    expect(parseSheetDate('Mar 4, 2026')).toBe('2026-03-04')
    expect(parseSheetDate('4 March 2026')).toBe('2026-03-04')
    expect(parseSheetDate('2/30/2026')).toBeNull()
    expect(parseSheetDate('1')).toBeNull()
    expect(parseSheetDate('next week')).toBeNull()
  })

  it('parses checkbox words', () => {
    expect(parseSheetBoolean('Yes')).toBe(true)
    expect(parseSheetBoolean('x')).toBe(true)
    expect(parseSheetBoolean('off')).toBe(false)
    expect(parseSheetBoolean('maybe')).toBeNull()
  })

  it('splits tag text on commas and semicolons', () => {
    expect(splitTagText('NYU, hackathon;  ,Work')).toEqual(['NYU', 'hackathon', 'Work'])
  })

  it('reads option IDs as names and drops ones that are gone', () => {
    const tags = column({ type: 'tags', options: [FRIEND, WORK] })
    expect(cellText(tags, ['o-work', 'o-gone', 'o-friend'])).toBe('Work, Friend')
    expect(cellText(column({ type: 'dropdown', options: [FRIEND] }), 'o-friend')).toBe('Friend')
    expect(cellText(column(), true)).toBe('Yes')
    expect(cellText(column(), undefined)).toBe('')
  })

  it('says when a value does not fit its column', () => {
    expect(cellFits(column({ type: 'number' }), 4)).toBe(true)
    expect(cellFits(column({ type: 'number' }), '4')).toBe(false)
    expect(cellFits(column({ type: 'date' }), '2026-03-04')).toBe(true)
    expect(cellFits(column({ type: 'date' }), 'soon')).toBe(false)
    expect(cellFits(column({ type: 'dropdown', options: [FRIEND] }), 'o-friend')).toBe(true)
    expect(cellFits(column({ type: 'dropdown', options: [FRIEND] }), 'o-work')).toBe(false)
    expect(cellFits(column({ type: 'tags', options: [FRIEND, WORK] }), ['o-work'])).toBe(true)
    expect(cellFits(column({ type: 'phone' }), '+1 555 0100')).toBe(true)
  })
})

describe('changing a column type', () => {
  const text = column()

  it('keeps values that convert and returns the rest untouched', () => {
    const number = column({ type: 'number' })
    expect(convertCell('1,200', text, number)).toBe(1200)
    expect(convertCell('a dozen', text, number)).toBe('a dozen')
    expect(convertCell(1200, number, text)).toBe('1200')
    expect(convertCell('Mar 4, 2026', text, column({ type: 'date' }))).toBe('2026-03-04')
    expect(convertCell('someday', text, column({ type: 'date' }))).toBe('someday')
  })

  it('turns checkbox words into ticks and leaves unchecked cells empty', () => {
    const checkbox = column({ type: 'checkbox' })
    expect(convertCell('yes', text, checkbox)).toBe(true)
    expect(convertCell('no', text, checkbox)).toBeNull()
    expect(convertCell(true, checkbox, text)).toBe('Yes')
    expect(convertCell(true, checkbox, column({ type: 'number' }))).toBe(1)
  })

  it('matches text to options by name, ignoring case', () => {
    const dropdown = column({ type: 'dropdown', options: [FRIEND, WORK] })
    expect(convertCell('friend', text, dropdown)).toBe('o-friend')
    expect(convertCell('Family', text, dropdown)).toBe('Family')
    const tags = column({ type: 'tags', options: [FRIEND, WORK] })
    expect(convertCell('Work, friend', text, tags)).toEqual(['o-work', 'o-friend'])
    expect(convertCell('Work, family', text, tags)).toBe('Work, family')
  })

  it('carries option IDs between dropdown and tags', () => {
    const dropdown = column({ type: 'dropdown', options: [FRIEND, WORK] })
    const tags = column({ type: 'tags', options: [FRIEND, WORK] })
    expect(convertCell('o-work', dropdown, tags)).toEqual(['o-work'])
    expect(convertCell(['o-work'], tags, dropdown)).toBe('o-work')
    expect(convertCell(['o-work', 'o-friend'], tags, dropdown)).toEqual(['o-work', 'o-friend'])
    expect(convertCell('o-friend', dropdown, text)).toBe('Friend')
  })

  it('builds options from the values a column already holds', () => {
    let next = 0
    const options = optionsForValues([FRIEND], ['Work', 'friend', 'NYU, Work', ''], true, () => `o-${++next}`)
    expect(options.map((option) => option.name)).toEqual(['Friend', 'Work', 'NYU'])
    expect(options.map((option) => option.shade)).toEqual([0, 1, 2])
    expect(optionsForValues([], ['NYU, Work'], false, () => 'o-x').map((option) => option.name)).toEqual(['NYU, Work'])
  })
})
