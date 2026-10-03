import type { SheetRecord, SheetRowRecord } from '@ego/api-contracts'
import { parseSheetCells, parseSheetColumns, parseSheetRowTypes, parseSheetView } from '@ego/core'
import type { LocalDatabase } from '../database/types'

export interface SheetData {
  sheets: SheetRecord[]
  rows: SheetRowRecord[]
}

interface SheetRow {
  id: string
  name: string
  icon: string
  position: number
  columns: string
  types_enabled: number
  row_types: string
  view: string
  archived_at: string | null
  created_at: string
  updated_at: string
  revision: number
}

interface SheetRowRow {
  id: string
  sheet_id: string
  type_id: string | null
  cells: string
  created_at: string
  updated_at: string
  revision: number
}

/** Every live sheet and the rows under them. Rows under a deleted sheet stay on disk but never show. */
export async function localSheets(db: LocalDatabase): Promise<SheetData> {
  const [sheets, rows] = await Promise.all([
    db.all<SheetRow>('SELECT * FROM sheets WHERE deleted_at IS NULL ORDER BY position, created_at'),
    db.all<SheetRowRow>(`SELECT r.* FROM sheet_rows r
      JOIN sheets s ON s.id = r.sheet_id AND s.deleted_at IS NULL
      WHERE r.deleted_at IS NULL ORDER BY r.created_at, r.id`)
  ])
  return {
    sheets: sheets.map((row) => ({
      id: row.id, name: row.name, icon: row.icon, position: row.position, columns: parseSheetColumns(row.columns),
      typesEnabled: row.types_enabled === 1, rowTypes: parseSheetRowTypes(row.row_types), view: parseSheetView(row.view),
      archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
    })),
    rows: rows.map((row) => ({
      id: row.id, sheetId: row.sheet_id, typeId: row.type_id, cells: parseSheetCells(row.cells),
      createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
    }))
  }
}

export type SheetTable = 'sheets' | 'sheet_rows'

export async function localSheetRevision(db: LocalDatabase, table: SheetTable, id: string): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(`SELECT revision FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
  return rows[0]?.revision ?? null
}
