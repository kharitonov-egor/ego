import { afterEach, describe, expect, it } from 'vitest'
import type { FoodEntryInput, FoodMealDraft } from '@ego/core'
import type { LocalDatabase } from '../lib/database/types'
import { queueUploads, releaseReadyMessages } from '../lib/diary/uploads'
import {
  addedLabel, cleanEntry, clockOf, dayTitle, entryAt, entryFromMeal, entryFromProduct, fridgeItemsFrom, localDay, productName
} from '../lib/food/drafts'
import { failedFoodUploads, localFood, localFoodRevision } from '../lib/food/repository'
import { createFridgeItem, deleteFoodEntry, deleteFridgeItem, saveFoodEntry, saveFoodGoal } from '../lib/sync/commands'
import { allOperations } from '../lib/sync/outbox'
import { openTestLedger } from './local-db'

const NOW = '2026-10-02T16:30:00.000Z'
const LUNCH = new Date(2026, 9, 2, 12, 30)

const meal: FoodMealDraft = {
  name: 'Burrito bowl', serving: '1 bowl', note: 'About 1 tbsp of oil',
  parts: [{ name: 'Chicken', calories: 280, protein: 40, carbs: 0, fat: 12 }, { name: 'Rice', calories: 360, protein: 5, carbs: 60, fat: 10 }],
  calories: 640, protein: 45, carbs: 60, fat: 22
}

const entry = (overrides: Partial<FoodEntryInput> = {}): FoodEntryInput => ({
  ...entryFromMeal(meal, 'photo', null, LUNCH), ...overrides
})

let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

describe('drafts', () => {
  it('logs a meal on the phone\'s own day and clock', () => {
    const logged = entryFromMeal(meal, 'photo', { mediaId: 'm', previewId: 'p', width: 10, height: 10 }, LUNCH)
    expect(logged).toMatchObject({ name: 'Burrito bowl', date: '2026-10-02', calories: 640, source: 'photo', note: 'About 1 tbsp of oil' })
    expect(clockOf(logged.eatenAt)).toBe('12:30')
    expect(localDay(new Date(2026, 9, 2, 23, 59))).toBe('2026-10-02')
  })

  it('leads a scanned product with its brand only when the name leaves it out', () => {
    expect(productName({ name: 'Greek Yogurt', brand: 'Chobani' })).toBe('Chobani Greek Yogurt')
    expect(productName({ name: 'Chobani Greek Yogurt', brand: 'Chobani' })).toBe('Chobani Greek Yogurt')
    expect(productName({ name: 'Oats', brand: null })).toBe('Oats')
    const scanned = entryFromProduct({
      barcode: '012345678905', name: 'Greek Yogurt', brand: 'Chobani', serving: '1 cup (170 g)',
      macros: { calories: 100, protein: 17, carbs: 6, fat: 0.7 }, source: 'usda'
    }, null, LUNCH)
    expect(scanned).toMatchObject({ name: 'Chobani Greek Yogurt', serving: '1 cup (170 g)', barcode: '012345678905', source: 'barcode', protein: 17 })
  })

  it('moves an entry to another day and time', () => {
    const moved = entryAt(entry(), '2026-10-01', '19:05')
    expect(moved.date).toBe('2026-10-01')
    expect(clockOf(moved.eatenAt)).toBe('19:05')
    expect(localDay(new Date(moved.eatenAt))).toBe('2026-10-01')
  })

  it('cleans an edit and refuses one with no name', () => {
    expect(cleanEntry(entry({ name: '  Bowl  ', calories: 640.4, protein: 45.26 }))).toMatchObject({ name: 'Bowl', calories: 640, protein: 45.3 })
    expect(cleanEntry(entry({ name: ' ' }))).toBeNull()
    expect(cleanEntry(entry({ fat: -1 }))).toBeNull()
  })

  it('titles days and fridge items the way the screen reads them', () => {
    expect(dayTitle('2026-10-02', '2026-10-02')).toBe('Today, October 2')
    expect(dayTitle('2026-10-01', '2026-10-02')).toBe('Yesterday, October 1')
    expect(dayTitle('2026-09-30', '2026-10-02')).toBe('Wednesday, September 30')
    expect(dayTitle('2025-12-31', '2026-10-02')).toBe('Wednesday, December 31, 2025')
    expect(addedLabel(new Date(2026, 9, 2, 9).toISOString(), '2026-10-02')).toBe('Added today')
    expect(addedLabel(new Date(2026, 8, 28, 9).toISOString(), '2026-10-02')).toBe('Added Sep 28')
    expect(fridgeItemsFrom([{ name: 'Eggs', icon: '🥚', brand: null }], 'photo', LUNCH)[0]).toMatchObject({ name: 'Eggs', source: 'photo', purchaseId: null })
  })
})

describe('the food log on the phone', () => {
  it('reads entries newest first, the fridge, and the targets', async () => {
    db = await openTestLedger()
    await saveFoodEntry(db, 'f-1', null, entry({ name: 'Breakfast', date: '2026-10-01', eatenAt: '2026-10-01T12:00:00.000Z' }), NOW)
    await saveFoodEntry(db, 'f-2', null, entry(), NOW)
    await createFridgeItem(db, { name: 'Milk', icon: '🥛', brand: null, barcode: null, source: 'manual', purchaseId: null, addedAt: NOW }, NOW, 'i-1')
    await saveFoodGoal(db, { calories: 2200, protein: 150, carbs: null, fat: null }, null, NOW)
    const food = await localFood(db)
    expect(food.entries.map((item) => item.id)).toEqual(['f-2', 'f-1'])
    expect(food.entries[0].parts.map((part) => part.name)).toEqual(['Chicken', 'Rice'])
    expect(food.fridge.map((item) => item.name)).toEqual(['Milk'])
    expect(food.goal).toMatchObject({ id: 'daily', calories: 2200, protein: 150, carbs: null, revision: 1 })

    await saveFoodGoal(db, { calories: 2000, protein: 150, carbs: null, fat: null }, 1, NOW)
    expect((await allOperations(db)).filter((operation) => operation.entity === 'foodGoal').map((operation) => operation.commandType))
      .toEqual(['create', 'update'])
    await deleteFridgeItem(db, 'i-1', 1, NOW)
    expect((await localFood(db)).fridge).toEqual([])
  })

  it('holds an entry until its photo uploads, and folds an edit into it', async () => {
    db = await openTestLedger()
    const photo = { mediaId: 'm-1', previewId: 'm-1-small', width: 1600, height: 1200 }
    await db.transaction(async (tx) => {
      await saveFoodEntry(tx, 'f-1', null, entry({ photo }), NOW, true)
      await queueUploads(tx, [
        { mediaId: 'm-1', messageId: 'f-1', localUri: 'file:///m-1.jpg', contentType: 'image/jpeg', size: 10, scope: 'food' },
        { mediaId: 'm-1-small', messageId: 'f-1', localUri: 'file:///m-1-small.jpg', contentType: 'image/jpeg', size: 5, scope: 'food' }
      ], NOW)
    })
    await saveFoodEntry(db, 'f-1', 1, entry({ photo, calories: 700 }), NOW)
    expect(await failedFoodUploads(db)).toEqual(new Set())
    await db.run("UPDATE diary_uploads SET failed_at = ? WHERE media_id = 'm-1'", [NOW])
    expect(await failedFoodUploads(db)).toEqual(new Set(['f-1']))
    await db.run('UPDATE diary_uploads SET failed_at = NULL')
    const queued = await allOperations(db)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ commandType: 'create', status: 'held' })
    expect(await releaseReadyMessages(db)).toBe(0)
    await db.run('UPDATE diary_uploads SET uploaded_at = ?', [NOW])
    expect(await releaseReadyMessages(db)).toBe(1)
    expect((await localFood(db)).entries[0].calories).toBe(700)
    expect(await localFoodRevision(db, 'food_entries', 'f-1')).toBe(1)
  })

  it('drops an entry the server never saw, with its photo', async () => {
    db = await openTestLedger()
    await db.transaction(async (tx) => {
      await saveFoodEntry(tx, 'f-1', null, entry({ photo: { mediaId: 'm-1', previewId: null, width: null, height: null } }), NOW, true)
      await queueUploads(tx, [{ mediaId: 'm-1', messageId: 'f-1', localUri: 'file:///m-1.jpg', contentType: 'image/jpeg', size: 10, scope: 'food' }], NOW)
    })
    expect(await deleteFoodEntry(db, 'f-1', 1, NOW)).toEqual(['file:///m-1.jpg'])
    expect(await allOperations(db)).toEqual([])
    expect((await localFood(db)).entries).toEqual([])
  })
})

describe('editing a stored entry', () => {
  it('sends only the entry\'s own fields', () => {
    const stored = { ...entry(), id: 'f-1', createdAt: NOW, updatedAt: NOW, revision: 3 }
    expect(Object.keys(cleanEntry(stored) ?? {}).sort()).toEqual([
      'barcode', 'calories', 'carbs', 'date', 'eatenAt', 'fat', 'name', 'note', 'parts', 'photo', 'protein', 'serving', 'source'
    ])
  })
})
