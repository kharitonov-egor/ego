import type { FoodEntryRecord, FoodGoalRecord, FridgeItemRecord } from '@ego/api-contracts'
import {
  FOOD_GOAL_ID, isFoodPart, isFoodPhoto,
  type FoodPart, type FoodPhoto, type FoodSource, type FridgeSource
} from '@ego/core'
import type { LocalDatabase } from '../database/types'

export interface FoodData {
  entries: FoodEntryRecord[]
  fridge: FridgeItemRecord[]
  goal: FoodGoalRecord | null
}

interface EntryRow {
  id: string
  name: string
  date: string
  eaten_at: string
  serving: string
  calories: number
  protein: number
  carbs: number
  fat: number
  parts: string
  source: FoodSource
  barcode: string | null
  photo: string | null
  note: string
  created_at: string
  updated_at: string
  revision: number
}

interface FridgeRow {
  id: string
  name: string
  icon: string
  brand: string | null
  barcode: string | null
  source: FridgeSource
  purchase_id: string | null
  added_at: string
  created_at: string
  updated_at: string
  revision: number
}

interface GoalRow {
  id: string
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  created_at: string
  updated_at: string
  revision: number
}

function parsed(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parts(raw: string): FoodPart[] {
  const value = parsed(raw)
  return Array.isArray(value) ? value.filter(isFoodPart) : []
}

function photo(raw: string | null): FoodPhoto | null {
  const value = parsed(raw)
  return isFoodPhoto(value) ? value : null
}

/** A year of meals is a few thousand rows, small enough to read at once and group on the phone. */
export async function localFood(db: LocalDatabase): Promise<FoodData> {
  const [entries, fridge, goals] = await Promise.all([
    db.all<EntryRow>('SELECT * FROM food_entries WHERE deleted_at IS NULL ORDER BY date DESC, eaten_at DESC'),
    db.all<FridgeRow>('SELECT * FROM fridge_items WHERE deleted_at IS NULL ORDER BY added_at DESC, id'),
    db.all<GoalRow>('SELECT * FROM food_goals WHERE id = ? AND deleted_at IS NULL', [FOOD_GOAL_ID])
  ])
  const goal = goals[0]
  return {
    entries: entries.map((row) => ({
      id: row.id, name: row.name, date: row.date, eatenAt: row.eaten_at, serving: row.serving,
      calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat, parts: parts(row.parts),
      source: row.source, barcode: row.barcode, photo: photo(row.photo), note: row.note,
      createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
    })),
    fridge: fridge.map((row) => ({
      id: row.id, name: row.name, icon: row.icon, brand: row.brand, barcode: row.barcode, source: row.source,
      purchaseId: row.purchase_id, addedAt: row.added_at, createdAt: row.created_at, updatedAt: row.updated_at,
      revision: row.revision
    })),
    goal: goal
      ? {
        id: goal.id, calories: goal.calories, protein: goal.protein, carbs: goal.carbs, fat: goal.fat,
        createdAt: goal.created_at, updatedAt: goal.updated_at, revision: goal.revision
      }
      : null
  }
}

/** Entries whose photo the server refused, so they wait on the phone until the user tries again. */
export async function failedFoodUploads(db: LocalDatabase): Promise<Set<string>> {
  const rows = await db.all<{ message_id: string }>(`SELECT DISTINCT message_id FROM diary_uploads
    WHERE scope = 'food' AND failed_at IS NOT NULL AND uploaded_at IS NULL`)
  return new Set(rows.map((row) => row.message_id))
}

export type FoodTable = 'food_entries' | 'fridge_items' | 'food_goals'

export async function localFoodRevision(db: LocalDatabase, table: FoodTable, id: string): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(`SELECT revision FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
  return rows[0]?.revision ?? null
}
