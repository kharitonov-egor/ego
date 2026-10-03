import type { MoodRecord } from '@ego/api-contracts'
import type { MoodLevel } from '@ego/core'
import type { LocalDatabase } from '../database/types'

interface MoodRow {
  id: string
  date: string
  mood: MoodLevel
  note: string
  created_at: string
  updated_at: string
  revision: number
}

/** One row per day, so even years of entries stay a small read. */
export async function localMoods(db: LocalDatabase): Promise<MoodRecord[]> {
  const rows = await db.all<MoodRow>('SELECT * FROM mood_entries WHERE deleted_at IS NULL ORDER BY date DESC')
  return rows.map((row) => ({
    id: row.id, date: row.date, mood: row.mood, note: row.note,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }))
}

export async function localMoodRevision(db: LocalDatabase, date: string): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(
    'SELECT revision FROM mood_entries WHERE date = ? AND deleted_at IS NULL', [date])
  return rows[0]?.revision ?? null
}
