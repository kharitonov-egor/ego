import type { HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import type { HabitEntryKind, HabitKind } from '@ego/core'
import type { LocalDatabase } from '../database/types'

interface HabitRow {
  id: string
  name: string
  icon: string
  kind: HabitKind
  start_date: string
  position: number
  created_at: string
  updated_at: string
  revision: number
}

interface HabitEntryRow {
  id: string
  habit_id: string
  date: string
  kind: HabitEntryKind
  created_at: string
  updated_at: string
  revision: number
}

export async function localHabits(db: LocalDatabase): Promise<HabitRecord[]> {
  const rows = await db.all<HabitRow>('SELECT * FROM habits WHERE deleted_at IS NULL ORDER BY position, created_at')
  return rows.map((row) => ({
    id: row.id, name: row.name, icon: row.icon, kind: row.kind, startDate: row.start_date, position: row.position,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }))
}

/** A deleted habit keeps its entries, so the join is what hides them. */
export async function localHabitEntries(db: LocalDatabase): Promise<HabitEntryRecord[]> {
  const rows = await db.all<HabitEntryRow>(`SELECT e.* FROM habit_entries e
    JOIN habits h ON h.id = e.habit_id AND h.deleted_at IS NULL
    WHERE e.deleted_at IS NULL ORDER BY e.date, e.created_at`)
  return rows.map((row) => ({
    id: row.id, habitId: row.habit_id, date: row.date, kind: row.kind,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }))
}

export async function localRevision(db: LocalDatabase, table: 'habits' | 'habit_entries', id: string): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(
    `SELECT revision FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
  return rows[0]?.revision ?? null
}
