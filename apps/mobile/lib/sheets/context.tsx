import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import {
  SHEET_OPTION_LIMIT, SHEET_OPTION_NAME_LIMIT, SHEET_ROW_TYPE_LIMIT, SHEET_ROW_TYPE_NAME_LIMIT, isSheetInput, isSheetRowInput,
  nextShade,
  type SheetCellValue, type SheetColumn, type SheetInput, type SheetRowInput
} from '@ego/core'
import type { LocalDatabase } from '@ego/local/database/types'
import { useLedger, type LocalWrite } from '../ledger-context'
import {
  createSheet as createSheetCommand, createSheetRow, deleteSheet as deleteSheetCommand, deleteSheetRow, newId,
  updateSheet as updateSheetCommand, updateSheetRow
} from '@ego/local/sync/commands'
import { endPosition, placeAt } from '@ego/local/tasks/board'
import {
  blankSheet, connectionsSheet, copiedRows, keptCells, removeColumn, removeRowType, replaceColumn, rowInput, sheetInput,
  shiftColumn, turnOnTypes, withCell, type RowWrite, type SheetEdit
} from '@ego/local/sheets/edits'
import { localSheetRevision, localSheets, type SheetData, type SheetTable } from '@ego/local/sheets/repository'
import { rowName } from '@ego/local/sheets/view'

/** How long a deleted row waits, hidden, for Undo before the delete is written. */
const UNDO_MS = 5000

export interface DeletedRow {
  id: string
  sheetId: string
  name: string
}

interface SheetsContextValue {
  enabled: boolean
  /** Null until the local database has been read. A row waiting on Undo is already left out. */
  data: SheetData | null
  error: string | null
  dismissError: () => void
  createSheet: (template: 'blank' | 'connections', name?: string, icon?: string) => Promise<string | null>
  updateSheet: (sheetId: string, change: (input: SheetInput) => SheetInput) => Promise<boolean>
  moveSheet: (sheetId: string, index: number) => Promise<boolean>
  duplicateSheet: (sheetId: string) => Promise<string | null>
  deleteSheet: (sheetId: string) => Promise<boolean>
  /** Adds a column, or replaces one and converts its cells. */
  saveColumn: (sheetId: string, column: SheetColumn) => Promise<boolean>
  deleteColumn: (sheetId: string, columnId: string) => Promise<boolean>
  moveColumn: (sheetId: string, columnId: string, step: -1 | 1) => Promise<boolean>
  addOption: (sheetId: string, columnId: string, name: string) => Promise<string | null>
  setTypesEnabled: (sheetId: string, enabled: boolean, firstType?: string) => Promise<boolean>
  saveRowType: (sheetId: string, typeId: string | null, name: string) => Promise<string | null>
  deleteRowType: (sheetId: string, typeId: string, replacementId: string) => Promise<boolean>
  createRow: (sheetId: string, typeId: string | null, cells: Record<string, SheetCellValue>) => Promise<string | null>
  updateRow: (rowId: string, change: (input: SheetRowInput) => SheetRowInput) => Promise<boolean>
  setCell: (rowId: string, columnId: string, value: SheetCellValue | null) => Promise<boolean>
  duplicateRow: (rowId: string) => Promise<string | null>
  deleteRow: (rowId: string) => void
  deletedRow: DeletedRow | null
  undoDelete: () => void
}

const SheetsContext = createContext<SheetsContextValue | null>(null)

function stamp(now: string): { createdAt: string; updatedAt: string; revision: number } {
  return { createdAt: now, updatedAt: now, revision: 1 }
}

async function revisionOf(db: LocalDatabase, table: SheetTable, id: string): Promise<number> {
  const revision = await localSheetRevision(db, table, id)
  if (revision === null) throw new Error('That was deleted on another device')
  return revision
}

function patchRows(rows: readonly SheetRowRecord[], writes: readonly RowWrite[], at: string): SheetRowRecord[] {
  const byId = new Map(writes.map((write) => [write.id, write.input]))
  return rows.map((row) => {
    const input = byId.get(row.id)
    return input ? { ...row, ...input, updatedAt: at } : row
  })
}

async function writeRows(tx: LocalDatabase, writes: readonly RowWrite[], time: string): Promise<void> {
  for (const write of writes) await updateSheetRow(tx, write.id, await revisionOf(tx, 'sheet_rows', write.id), write.input, time)
}

/**
 * Sheets shares the ledger's database and outbox, the way Tasks does. Every change shows on screen
 * before it is written, and writes run one at a time in the order they were made.
 */
export function SheetsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, ready, enabled, sheetsVersion, write } = useLedger()
  const [data, setDataState] = useState<SheetData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const [deletedRow, setDeletedRow] = useState<DeletedRow | null>(null)
  const dataRef = useRef<SheetData | null>(null)
  const pending = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const deleting = useRef<{ row: DeletedRow; timer: ReturnType<typeof setTimeout> } | null>(null)

  const setData = useCallback((next: SheetData | null): void => {
    dataRef.current = next
    setDataState(next)
  }, [])

  useEffect(() => {
    if (!db || !ready) {
      setData(null)
      return
    }
    let active = true
    void localSheets(db)
      .then((next) => { if (active && pending.current === 0) setData(next) })
      .catch(() => { if (active) setError('This phone could not read its sheets') })
    return () => { active = false }
  }, [db, ready, sheetsVersion, reloads, setData])

  const commit = useCallback(async (patch: ((current: SheetData) => SheetData) | null, work: LocalWrite, failure: string): Promise<boolean> => {
    pending.current += 1
    if (patch && dataRef.current) setData(patch(dataRef.current))
    const next = queue.current.then(() => write(work, 'sheets'))
    queue.current = next.catch(() => undefined)
    const saved = await next.catch(() => false)
    pending.current -= 1
    if (!saved) setError(failure)
    if (pending.current === 0) setReloads((count) => count + 1)
    return saved
  }, [setData, write])

  const sheetOf = (sheetId: string): SheetRecord | undefined => dataRef.current?.sheets.find((sheet) => sheet.id === sheetId)
  const rowsOf = (sheetId: string): SheetRowRecord[] => dataRef.current?.rows.filter((row) => row.sheetId === sheetId) ?? []

  /** Writes a sheet's new state and any rows it carries with it, as one change. */
  const applyEdit = useCallback((sheetId: string, edit: SheetEdit, failure: string): Promise<boolean> => {
    if (!isSheetInput(edit.input)) {
      setError('That sheet could not be saved as it is')
      return Promise.resolve(false)
    }
    const at = new Date().toISOString()
    return commit(
      (current) => ({
        sheets: current.sheets.map((sheet) => sheet.id === sheetId ? { ...sheet, ...edit.input, updatedAt: at } : sheet),
        rows: patchRows(current.rows, edit.rows, at)
      }),
      (database, time) => database.transaction(async (tx) => {
        await updateSheetCommand(tx, sheetId, await revisionOf(tx, 'sheets', sheetId), edit.input, time)
        await writeRows(tx, edit.rows, time)
      }),
      failure)
  }, [commit])

  const createSheet = useCallback(async (template: 'blank' | 'connections', name = '', icon = ''): Promise<string | null> => {
    const current = dataRef.current
    if (!current) return null
    const position = endPosition(current.sheets.filter((sheet) => sheet.archivedAt === null))
    const input = template === 'connections' ? connectionsSheet(position, newId) : blankSheet(name, icon, position, newId)
    if (!isSheetInput(input)) {
      setError('Give the sheet a name')
      return null
    }
    const id = newId()
    const at = new Date().toISOString()
    const saved = await commit(
      (data) => ({ ...data, sheets: [...data.sheets, { id, ...input, ...stamp(at) }] }),
      async (database, time) => { await createSheetCommand(database, input, time, id) },
      'This phone could not create that sheet')
    return saved ? id : null
  }, [commit])

  const updateSheet = useCallback((sheetId: string, change: (input: SheetInput) => SheetInput): Promise<boolean> => {
    const sheet = sheetOf(sheetId)
    if (!sheet) return Promise.resolve(false)
    return applyEdit(sheetId, { input: change(sheetInput(sheet)), rows: [] }, 'This phone could not save that sheet')
  }, [applyEdit])

  const moveSheet = useCallback(async (sheetId: string, index: number): Promise<boolean> => {
    const current = dataRef.current
    if (!current) return false
    const siblings = current.sheets.filter((sheet) => sheet.archivedAt === null && sheet.id !== sheetId).sort((a, b) => a.position - b.position)
    const placement = placeAt(siblings, index, sheetId)
    const positions = placement.renumber ?? [{ id: sheetId, position: placement.position }]
    return commit(
      (data) => ({ ...data, sheets: data.sheets.map((sheet) => ({ ...sheet, position: positions.find((item) => item.id === sheet.id)?.position ?? sheet.position })) }),
      (database, time) => database.transaction(async (tx) => {
        for (const { id, position } of positions) {
          const sheet = current.sheets.find((item) => item.id === id)
          if (sheet) await updateSheetCommand(tx, id, await revisionOf(tx, 'sheets', id), { ...sheetInput(sheet), position }, time)
        }
      }),
      'This phone could not reorder your sheets')
  }, [commit])

  const duplicateSheet = useCallback(async (sheetId: string): Promise<string | null> => {
    const current = dataRef.current
    const sheet = sheetOf(sheetId)
    if (!current || !sheet) return null
    const id = newId()
    const at = new Date().toISOString()
    const input: SheetInput = {
      ...sheetInput(sheet),
      name: `${sheet.name.trim()} copy`.slice(0, 120),
      position: endPosition(current.sheets.filter((item) => item.archivedAt === null)),
      archivedAt: null
    }
    const rows = copiedRows(rowsOf(sheetId).filter((row) => row.id !== deleting.current?.row.id), id, newId)
    const saved = await commit(
      (data) => ({
        sheets: [...data.sheets, { id, ...input, ...stamp(at) }],
        rows: [...data.rows, ...rows.map((row) => ({ id: row.id, ...row.input, ...stamp(at) }))]
      }),
      (database, time) => database.transaction(async (tx) => {
        await createSheetCommand(tx, input, time, id)
        for (const row of rows) await createSheetRow(tx, row.input, time, row.id)
      }),
      'This phone could not copy that sheet')
    return saved ? id : null
  }, [commit])

  const deleteSheet = useCallback((sheetId: string): Promise<boolean> => commit(
    (data) => ({ sheets: data.sheets.filter((sheet) => sheet.id !== sheetId), rows: data.rows.filter((row) => row.sheetId !== sheetId) }),
    async (database, time) => { await deleteSheetCommand(database, sheetId, await revisionOf(database, 'sheets', sheetId), time) },
    'This phone could not delete that sheet'), [commit])

  const saveColumn = useCallback((sheetId: string, column: SheetColumn): Promise<boolean> => {
    const sheet = sheetOf(sheetId)
    if (!sheet) return Promise.resolve(false)
    const input = sheetInput(sheet)
    const edit: SheetEdit = input.columns.some((item) => item.id === column.id)
      ? replaceColumn(input, rowsOf(sheetId), column, newId)
      : { input: { ...input, columns: [...input.columns, column] }, rows: [] }
    return applyEdit(sheetId, edit, 'This phone could not save that column')
  }, [applyEdit])

  const deleteColumn = useCallback((sheetId: string, columnId: string): Promise<boolean> =>
    updateSheet(sheetId, (input) => removeColumn(input, columnId)), [updateSheet])

  const moveColumn = useCallback((sheetId: string, columnId: string, step: -1 | 1): Promise<boolean> =>
    updateSheet(sheetId, (input) => shiftColumn(input, columnId, step)), [updateSheet])

  const addOption = useCallback(async (sheetId: string, columnId: string, name: string): Promise<string | null> => {
    const sheet = sheetOf(sheetId)
    const column = sheet?.columns.find((item) => item.id === columnId)
    const trimmed = name.trim().slice(0, SHEET_OPTION_NAME_LIMIT)
    if (!sheet || !column || trimmed === '') return null
    if (column.options.length >= SHEET_OPTION_LIMIT) {
      setError(`A column holds up to ${SHEET_OPTION_LIMIT} options`)
      return null
    }
    const id = newId()
    const options = [...column.options, { id, name: trimmed, shade: nextShade(column.options) }]
    const saved = await updateSheet(sheetId, (input) => ({
      ...input, columns: input.columns.map((item) => item.id === columnId ? { ...item, options } : item)
    }))
    return saved ? id : null
  }, [updateSheet])

  const setTypesEnabled = useCallback((sheetId: string, on: boolean, firstType?: string): Promise<boolean> => {
    const sheet = sheetOf(sheetId)
    if (!sheet) return Promise.resolve(false)
    const input = sheetInput(sheet)
    if (!on) return applyEdit(sheetId, { input: { ...input, typesEnabled: false, view: { ...input.view, typeId: null } }, rows: [] }, 'This phone could not turn row types off')
    const first = firstType?.trim() ? { id: newId(), name: firstType.trim().slice(0, SHEET_ROW_TYPE_NAME_LIMIT) } : null
    return applyEdit(sheetId, turnOnTypes(input, rowsOf(sheetId), first), 'This phone could not turn row types on')
  }, [applyEdit])

  const saveRowType = useCallback(async (sheetId: string, typeId: string | null, name: string): Promise<string | null> => {
    const sheet = sheetOf(sheetId)
    const trimmed = name.trim().slice(0, SHEET_ROW_TYPE_NAME_LIMIT)
    if (!sheet || trimmed === '') return null
    if (typeId === null && sheet.rowTypes.length >= SHEET_ROW_TYPE_LIMIT) {
      setError(`A sheet holds up to ${SHEET_ROW_TYPE_LIMIT} row types`)
      return null
    }
    const id = typeId ?? newId()
    const saved = await updateSheet(sheetId, (input) => ({
      ...input,
      rowTypes: typeId === null
        ? [...input.rowTypes, { id, name: trimmed }]
        : input.rowTypes.map((type) => type.id === typeId ? { ...type, name: trimmed } : type)
    }))
    return saved ? id : null
  }, [updateSheet])

  const deleteRowType = useCallback((sheetId: string, typeId: string, replacementId: string): Promise<boolean> => {
    const sheet = sheetOf(sheetId)
    if (!sheet) return Promise.resolve(false)
    return applyEdit(sheetId, removeRowType(sheetInput(sheet), rowsOf(sheetId), typeId, replacementId), 'This phone could not delete that type')
  }, [applyEdit])

  const createRow = useCallback(async (sheetId: string, typeId: string | null, cells: Record<string, SheetCellValue>): Promise<string | null> => {
    const sheet = sheetOf(sheetId)
    if (!sheet) return null
    const input: SheetRowInput = { sheetId, typeId: sheet.typesEnabled ? typeId : null, cells: keptCells(sheet, cells) }
    if (!isSheetRowInput(input)) {
      setError('That row is too long to save')
      return null
    }
    const id = newId()
    const at = new Date().toISOString()
    const saved = await commit(
      (data) => ({ ...data, rows: [...data.rows, { id, ...input, ...stamp(at) }] }),
      async (database, time) => { await createSheetRow(database, input, time, id) },
      'This phone could not add that row')
    return saved ? id : null
  }, [commit])

  const updateRow = useCallback((rowId: string, change: (input: SheetRowInput) => SheetRowInput): Promise<boolean> => {
    const row = dataRef.current?.rows.find((item) => item.id === rowId)
    const sheet = row ? sheetOf(row.sheetId) : undefined
    if (!row || !sheet) return Promise.resolve(false)
    const changed = change(rowInput(row))
    const input: SheetRowInput = { ...changed, sheetId: row.sheetId, cells: keptCells(sheet, changed.cells) }
    if (!isSheetRowInput(input)) {
      setError('That is too long to save')
      return Promise.resolve(false)
    }
    return commit(
      (data) => ({ ...data, rows: patchRows(data.rows, [{ id: rowId, input }], new Date().toISOString()) }),
      async (database, time) => { await updateSheetRow(database, rowId, await revisionOf(database, 'sheet_rows', rowId), input, time) },
      'This phone could not save that row')
  }, [commit])

  const setCell = useCallback((rowId: string, columnId: string, value: SheetCellValue | null): Promise<boolean> =>
    updateRow(rowId, (input) => ({ ...input, cells: withCell(input.cells, columnId, value) })), [updateRow])

  const duplicateRow = useCallback(async (rowId: string): Promise<string | null> => {
    const row = dataRef.current?.rows.find((item) => item.id === rowId)
    return row ? createRow(row.sheetId, row.typeId, row.cells) : null
  }, [createRow])

  const finishDelete = useCallback((rowId: string): void => {
    void commit(
      (data) => ({ ...data, rows: data.rows.filter((row) => row.id !== rowId) }),
      async (database, time) => { await deleteSheetRow(database, rowId, await revisionOf(database, 'sheet_rows', rowId), time) },
      'This phone could not delete that row')
  }, [commit])

  const flushDelete = useCallback((): void => {
    const waiting = deleting.current
    if (!waiting) return
    clearTimeout(waiting.timer)
    deleting.current = null
    setDeletedRow(null)
    finishDelete(waiting.row.id)
  }, [finishDelete])

  const deleteRow = useCallback((rowId: string): void => {
    const row = dataRef.current?.rows.find((item) => item.id === rowId)
    const sheet = row ? sheetOf(row.sheetId) : undefined
    if (!row || !sheet) return
    flushDelete()
    const deleted: DeletedRow = { id: rowId, sheetId: row.sheetId, name: rowName(sheet, row) || 'Untitled' }
    deleting.current = { row: deleted, timer: setTimeout(flushDelete, UNDO_MS) }
    setDeletedRow(deleted)
  }, [flushDelete])

  const undoDelete = useCallback((): void => {
    const waiting = deleting.current
    if (!waiting) return
    clearTimeout(waiting.timer)
    deleting.current = null
    setDeletedRow(null)
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushDelete()
    })
    return () => subscription.remove()
  }, [flushDelete])

  const dismissError = useCallback(() => setError(null), [])

  const visible = useMemo<SheetData | null>(() => data && deletedRow
    ? { ...data, rows: data.rows.filter((row) => row.id !== deletedRow.id) }
    : data, [data, deletedRow])

  const value = useMemo<SheetsContextValue>(() => ({
    enabled, data: visible, error, dismissError,
    createSheet, updateSheet, moveSheet, duplicateSheet, deleteSheet,
    saveColumn, deleteColumn, moveColumn, addOption,
    setTypesEnabled, saveRowType, deleteRowType,
    createRow, updateRow, setCell, duplicateRow, deleteRow, deletedRow, undoDelete
  }), [addOption, createRow, createSheet, deleteColumn, deleteRow, deleteRowType, deleteSheet, deletedRow, dismissError,
    duplicateRow, duplicateSheet, enabled, error, moveColumn, moveSheet, saveColumn, saveRowType, setCell, setTypesEnabled,
    undoDelete, updateRow, updateSheet, visible])

  return <SheetsContext.Provider value={value}>{children}</SheetsContext.Provider>
}

export function useSheets(): SheetsContextValue {
  const context = useContext(SheetsContext)
  if (!context) throw new Error('useSheets must be used inside SheetsProvider')
  return context
}
