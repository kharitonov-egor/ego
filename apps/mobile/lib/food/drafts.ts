import {
  FOOD_NAME_LIMIT, FRIDGE_NAME_LIMIT, isFoodEntryInput,
  type FoodEntryInput, type FoodMealDraft, type FoodPhoto, type FoodProduct, type FoodSource, type FridgeDraftItem,
  type FridgeItemInput, type FridgeSource
} from '@ego/core'
import { isoFromParts, parseIso } from '@ego/local/dates'

/** The phone's own calendar day and clock for a moment, so a late dinner counts toward the day it was eaten. */
export function localDay(at: Date): string {
  return isoFromParts(at.getFullYear(), at.getMonth(), at.getDate())
}

export function entryFromMeal(meal: FoodMealDraft, source: FoodSource, photo: FoodPhoto | null, at: Date): FoodEntryInput {
  return {
    name: meal.name, date: localDay(at), eatenAt: at.toISOString(), serving: meal.serving,
    calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat,
    parts: meal.parts, source, barcode: null, photo, note: meal.note
  }
}

/** The brand leads the name unless the name already carries it, the way the package reads. */
export function productName(product: Pick<FoodProduct, 'name' | 'brand'>): string {
  const brand = product.brand?.trim()
  const named = brand && !product.name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${product.name}` : product.name
  return named.slice(0, FOOD_NAME_LIMIT)
}

export function entryFromProduct(product: FoodProduct, photo: FoodPhoto | null, at: Date): FoodEntryInput {
  return {
    name: productName(product), date: localDay(at), eatenAt: at.toISOString(), serving: product.serving,
    ...product.macros, parts: [], source: 'barcode', barcode: product.barcode, photo, note: ''
  }
}

export function fridgeItemsFrom(items: readonly FridgeDraftItem[], source: FridgeSource, at: Date): FridgeItemInput[] {
  return items.map((item) => ({
    name: item.name.slice(0, FRIDGE_NAME_LIMIT), icon: item.icon, brand: item.brand, barcode: null, source, purchaseId: null,
    addedAt: at.toISOString()
  }))
}

export function fridgeItemFromProduct(product: FoodProduct, at: Date): FridgeItemInput {
  return {
    name: product.name.slice(0, FRIDGE_NAME_LIMIT), icon: '', brand: product.brand, barcode: product.barcode, source: 'barcode',
    purchaseId: null, addedAt: at.toISOString()
  }
}

/** Moves an entry to another day and time on the phone's clock, keeping everything else. */
export function entryAt(entry: FoodEntryInput, date: string, time: string): FoodEntryInput {
  const [hours, minutes] = time.split(':').map(Number)
  const day = parseIso(date)
  day.setHours(hours, minutes, 0, 0)
  return { ...entry, date, eatenAt: day.toISOString() }
}

/** "12:30" on the phone's clock. */
export function clockOf(iso: string): string {
  const at = new Date(iso)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Today, October 2", "Yesterday, October 1", then the weekday, with the year only when it differs. */
export function dayTitle(date: string, today: string): string {
  const day = parseIso(date)
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  const monthDay = day.toLocaleDateString('en-US', { month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  if (date === today) return `Today, ${monthDay}`
  const yesterday = parseIso(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date === localDay(yesterday)) return `Yesterday, ${monthDay}`
  return `${day.toLocaleDateString('en-US', { weekday: 'long' })}, ${monthDay}`
}

/** "Today", "Yesterday", or "Sep 28", for when a fridge item was added. */
export function addedLabel(iso: string, today: string): string {
  const date = localDay(new Date(iso))
  if (date === today) return 'Added today'
  const yesterday = parseIso(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date === localDay(yesterday)) return 'Added yesterday'
  const sameYear = date.slice(0, 4) === today.slice(0, 4)
  return `Added ${parseIso(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}`
}

/**
 * Trims an edited entry and rounds what was typed, so the saved numbers match what the list shows.
 * Only the input's own fields are kept, since an edit starts from a stored record.
 */
export function cleanEntry(entry: FoodEntryInput): FoodEntryInput | null {
  const round = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places
  const clean: FoodEntryInput = {
    name: entry.name.trim(),
    date: entry.date,
    eatenAt: entry.eatenAt,
    serving: entry.serving.trim(),
    calories: round(entry.calories, 0),
    protein: round(entry.protein, 1),
    carbs: round(entry.carbs, 1),
    fat: round(entry.fat, 1),
    parts: entry.parts,
    source: entry.source,
    barcode: entry.barcode,
    photo: entry.photo,
    note: entry.note.trim()
  }
  return isFoodEntryInput(clean) ? clean : null
}
