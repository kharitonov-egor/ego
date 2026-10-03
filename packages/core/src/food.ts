import { isDateString } from './money'
import type { FetchLike } from './trello'

/**
 * Food keeps three records: what was eaten, what is in the fridge, and the daily targets. An entry
 * carries its own totals, so editing one never depends on a food database that may change later.
 */

export type FoodSource = 'photo' | 'barcode' | 'text' | 'manual' | 'assistant'
export type FridgeSource = 'barcode' | 'photo' | 'receipt' | 'manual' | 'assistant'

export const FOOD_SOURCES: readonly FoodSource[] = ['photo', 'barcode', 'text', 'manual', 'assistant']
export const FRIDGE_SOURCES: readonly FridgeSource[] = ['barcode', 'photo', 'receipt', 'manual', 'assistant']

/** Calories in kcal; protein, carbs, and fat in grams. */
export interface FoodMacros {
  calories: number
  protein: number
  carbs: number
  fat: number
}

/** One thing on the plate, as the model or the label split it. */
export interface FoodPart extends FoodMacros {
  name: string
}

/** The bytes are in R2 under `food/<mediaId>`; `previewId` is a smaller copy for the list. */
export interface FoodPhoto {
  mediaId: string
  previewId: string | null
  width: number | null
  height: number | null
}

export interface FoodEntryInput extends FoodMacros {
  name: string
  /** The phone's own calendar day the food counts toward. */
  date: string
  /** When it was eaten. */
  eatenAt: string
  /** "1 bowl", "2 slices", "1 can (355 ml)". Empty when unknown. */
  serving: string
  parts: FoodPart[]
  source: FoodSource
  barcode: string | null
  photo: FoodPhoto | null
  note: string
}

export interface FoodEntry extends FoodEntryInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface FridgeItemInput {
  name: string
  /** One emoji, or empty. */
  icon: string
  brand: string | null
  barcode: string | null
  source: FridgeSource
  /** The receipt it was bought on. */
  purchaseId: string | null
  addedAt: string
}

export interface FridgeItem extends FridgeItemInput {
  id: string
  createdAt: string
  updatedAt: string
}

/** Null means no target for that number. */
export interface FoodGoalInput {
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

export interface FoodGoal extends FoodGoalInput {
  id: string
  createdAt: string
  updatedAt: string
}

/** There is one set of daily targets, saved under this ID. */
export const FOOD_GOAL_ID = 'daily'

export const FOOD_NAME_LIMIT = 120
export const FOOD_SERVING_LIMIT = 80
export const FOOD_NOTE_LIMIT = 1000
export const FOOD_PART_LIMIT = 30
export const FOOD_CALORIE_LIMIT = 20000
export const FOOD_GRAM_LIMIT = 3000
export const FRIDGE_NAME_LIMIT = 120
export const FRIDGE_BRAND_LIMIT = 80
export const FRIDGE_ICON_LIMIT = 16

const ID = /^[A-Za-z0-9_-]{1,64}$/
const BARCODE = /^\d{6,14}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

function isAmount(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit
}

function isOptionalCount(value: unknown): boolean {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100000)
}

export function isFoodBarcode(value: unknown): value is string {
  return typeof value === 'string' && BARCODE.test(value)
}

function hasMacros(value: Record<string, unknown>): boolean {
  return isAmount(value.calories, FOOD_CALORIE_LIMIT) &&
    isAmount(value.protein, FOOD_GRAM_LIMIT) &&
    isAmount(value.carbs, FOOD_GRAM_LIMIT) &&
    isAmount(value.fat, FOOD_GRAM_LIMIT)
}

export function isFoodMacros(value: unknown): value is FoodMacros {
  return isRecord(value) && hasMacros(value)
}

export function isFoodPart(value: unknown): value is FoodPart {
  return isRecord(value) && hasMacros(value) && isText(value.name, 1, FOOD_NAME_LIMIT)
}

export function isFoodPhoto(value: unknown): value is FoodPhoto {
  return isRecord(value) &&
    typeof value.mediaId === 'string' && ID.test(value.mediaId) &&
    (value.previewId === null || (typeof value.previewId === 'string' && ID.test(value.previewId))) &&
    isOptionalCount(value.width) && isOptionalCount(value.height)
}

export function isFoodEntryInput(value: unknown): value is FoodEntryInput {
  return isRecord(value) && hasMacros(value) &&
    isText(value.name, 1, FOOD_NAME_LIMIT) &&
    typeof value.date === 'string' && isDateString(value.date) &&
    isTimestamp(value.eatenAt) &&
    isText(value.serving, 0, FOOD_SERVING_LIMIT) &&
    Array.isArray(value.parts) && value.parts.length <= FOOD_PART_LIMIT && value.parts.every(isFoodPart) &&
    (FOOD_SOURCES as readonly unknown[]).includes(value.source) &&
    (value.barcode === null || isFoodBarcode(value.barcode)) &&
    (value.photo === null || isFoodPhoto(value.photo)) &&
    isText(value.note, 0, FOOD_NOTE_LIMIT)
}

export function isFridgeItemInput(value: unknown): value is FridgeItemInput {
  return isRecord(value) &&
    isText(value.name, 1, FRIDGE_NAME_LIMIT) &&
    typeof value.icon === 'string' && value.icon.length <= FRIDGE_ICON_LIMIT &&
    (value.brand === null || isText(value.brand, 1, FRIDGE_BRAND_LIMIT)) &&
    (value.barcode === null || isFoodBarcode(value.barcode)) &&
    (FRIDGE_SOURCES as readonly unknown[]).includes(value.source) &&
    (value.purchaseId === null || (typeof value.purchaseId === 'string' && ID.test(value.purchaseId))) &&
    isTimestamp(value.addedAt)
}

function isTarget(value: unknown, limit: number): boolean {
  return value === null || (isAmount(value, limit) && value > 0)
}

export function isFoodGoalInput(value: unknown): value is FoodGoalInput {
  return isRecord(value) &&
    isTarget(value.calories, FOOD_CALORIE_LIMIT) &&
    isTarget(value.protein, FOOD_GRAM_LIMIT) &&
    isTarget(value.carbs, FOOD_GRAM_LIMIT) &&
    isTarget(value.fat, FOOD_GRAM_LIMIT)
}

/** Every file an entry points at, so the server can check each one finished uploading. */
export function foodMediaIds(input: Pick<FoodEntryInput, 'photo'>): string[] {
  if (!input.photo) return []
  return input.photo.previewId ? [input.photo.mediaId, input.photo.previewId] : [input.photo.mediaId]
}

export const NO_MACROS: FoodMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 }
export const NO_FOOD_GOAL: FoodGoalInput = { calories: null, protein: null, carbs: null, fat: null }

function tidy(value: number): number {
  return Math.round(value * 10) / 10
}

export function sumMacros(list: readonly FoodMacros[]): FoodMacros {
  const total = list.reduce((sum, item) => ({
    calories: sum.calories + item.calories,
    protein: sum.protein + item.protein,
    carbs: sum.carbs + item.carbs,
    fat: sum.fat + item.fat
  }), NO_MACROS)
  return { calories: tidy(total.calories), protein: tidy(total.protein), carbs: tidy(total.carbs), fat: tidy(total.fat) }
}

export function scaleMacros(macros: FoodMacros, factor: number): FoodMacros {
  return {
    calories: tidy(macros.calories * factor),
    protein: tidy(macros.protein * factor),
    carbs: tidy(macros.carbs * factor),
    fat: tidy(macros.fat * factor)
  }
}

/** Atwater's 4, 4, and 9 kcal per gram, for a label that leaves energy out. */
export function caloriesFromMacros(protein: number, carbs: number, fat: number): number {
  return tidy(protein * 4 + carbs * 4 + fat * 9)
}

export interface FoodDay<T extends Pick<FoodEntryInput, 'date' | 'eatenAt'> & FoodMacros> {
  date: string
  entries: T[]
  totals: FoodMacros
}

/** Newest day first, and newest entry first within a day. */
export function foodDays<T extends Pick<FoodEntryInput, 'date' | 'eatenAt'> & FoodMacros>(entries: readonly T[]): FoodDay<T>[] {
  const byDate = new Map<string, T[]>()
  for (const entry of entries) {
    const list = byDate.get(entry.date)
    if (list) list.push(entry)
    else byDate.set(entry.date, [entry])
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, list]) => {
      const sorted = [...list].sort((left, right) => right.eatenAt.localeCompare(left.eatenAt))
      return { date, entries: sorted, totals: sumMacros(sorted) }
    })
}

/** "1,840" for calories, "42" or "4.5" for grams. */
export function formatCalories(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

export function formatGrams(value: number): string {
  return value >= 10 ? String(Math.round(value)) : String(tidy(value))
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

/** Names from a database or a receipt often arrive in capitals. */
export function readableName(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (!/[A-Z]{3}/.test(text) || /[a-z]/.test(text)) return text
  return text.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`)
}

/** What one barcode says about a packaged food. */
export interface FoodProduct {
  barcode: string
  name: string
  brand: string | null
  /** What one serving is, like "1 can (355 ml)". "100 g" when the label gives no serving. */
  serving: string
  /** For one serving as `serving` describes it. */
  macros: FoodMacros
  source: 'usda' | 'openfoodfacts'
}

/** Scanners report UPC-A with 12 digits and EAN-13 with 13. Databases pad them differently. */
export function barcodeKey(barcode: string): string {
  return barcode.replace(/^0+/, '')
}

function numberAt(record: Record<string, unknown>, key: string): number | null {
  const raw = record[key]
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function offMacros(nutriments: Record<string, unknown>, suffix: '_serving' | '_100g'): FoodMacros | null {
  const protein = numberAt(nutriments, `proteins${suffix}`)
  const carbs = numberAt(nutriments, `carbohydrates${suffix}`)
  const fat = numberAt(nutriments, `fat${suffix}`)
  const kilojoules = numberAt(nutriments, `energy-kj${suffix}`) ?? numberAt(nutriments, `energy${suffix}`)
  const calories = numberAt(nutriments, `energy-kcal${suffix}`) ?? (kilojoules === null ? null : kilojoules / 4.184)
  if (calories === null && protein === null && carbs === null && fat === null) return null
  const macros = { protein: tidy(protein ?? 0), carbs: tidy(carbs ?? 0), fat: tidy(fat ?? 0) }
  return { calories: tidy(calories ?? caloriesFromMacros(macros.protein, macros.carbs, macros.fat)), ...macros }
}

/** Reads Open Food Facts' `/api/v2/product/<code>.json` answer. */
export function parseOpenFoodFacts(value: unknown, barcode: string): FoodProduct | null {
  if (!isRecord(value) || value.status !== 1 || !isRecord(value.product)) return null
  const product = value.product
  const name = cleanText(product.product_name_en, FOOD_NAME_LIMIT) || cleanText(product.product_name, FOOD_NAME_LIMIT)
  if (!name) return null
  const brand = cleanText(product.brands, FRIDGE_BRAND_LIMIT).split(',')[0]?.trim() || null
  const nutriments = isRecord(product.nutriments) ? product.nutriments : {}
  const perServing = offMacros(nutriments, '_serving')
  const per100 = offMacros(nutriments, '_100g')
  const servingText = cleanText(product.serving_size, FOOD_SERVING_LIMIT)
  const servingAmount = numberAt(product, 'serving_quantity')
  let macros: FoodMacros
  let serving: string
  if (perServing && servingText) {
    macros = perServing
    serving = servingText
  } else if (per100 && servingAmount && servingAmount > 0) {
    macros = scaleMacros(per100, servingAmount / 100)
    serving = servingText || `${tidy(servingAmount)} g`
  } else if (per100) {
    macros = per100
    serving = product.nutrition_data_per === '100ml' ? '100 ml' : '100 g'
  } else {
    macros = NO_MACROS
    serving = servingText
  }
  return { barcode, name: readableName(name), brand: brand ? readableName(brand) : null, serving, macros, source: 'openfoodfacts' }
}

const USDA_NUTRIENTS = { calories: ['208', '1008', '957', '958'], protein: ['203'], carbs: ['205'], fat: ['204'] } as const

function usdaNutrient(nutrients: readonly Record<string, unknown>[], numbers: readonly string[]): number | null {
  for (const number of numbers) {
    const found = nutrients.find((nutrient) => String(nutrient.nutrientNumber) === number &&
      (number !== '208' || String(nutrient.unitName).toUpperCase() === 'KCAL'))
    const value = found ? numberAt(found, 'value') : null
    if (value !== null) return value
  }
  return null
}

/** Reads FoodData Central's `/foods/search` answer, keeping only the food whose UPC matches. */
export function parseUsdaSearch(value: unknown, barcode: string): FoodProduct | null {
  if (!isRecord(value) || !Array.isArray(value.foods)) return null
  const food = value.foods.find((item): item is Record<string, unknown> => isRecord(item) &&
    typeof item.gtinUpc === 'string' && barcodeKey(item.gtinUpc) === barcodeKey(barcode))
  if (!food) return null
  const name = cleanText(food.description, FOOD_NAME_LIMIT)
  if (!name) return null
  const nutrients = Array.isArray(food.foodNutrients) ? food.foodNutrients.filter(isRecord) : []
  const protein = usdaNutrient(nutrients, USDA_NUTRIENTS.protein)
  const carbs = usdaNutrient(nutrients, USDA_NUTRIENTS.carbs)
  const fat = usdaNutrient(nutrients, USDA_NUTRIENTS.fat)
  const calories = usdaNutrient(nutrients, USDA_NUTRIENTS.calories)
  if (calories === null && protein === null && carbs === null && fat === null) return null
  const per100: FoodMacros = {
    calories: calories ?? caloriesFromMacros(protein ?? 0, carbs ?? 0, fat ?? 0),
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0
  }
  const size = numberAt(food, 'servingSize')
  const unit = cleanText(food.servingSizeUnit, 10).toLowerCase()
  const household = cleanText(food.householdServingFullText, FOOD_SERVING_LIMIT)
  const brand = cleanText(food.brandName, FRIDGE_BRAND_LIMIT) || cleanText(food.brandOwner, FRIDGE_BRAND_LIMIT)
  const measured = size !== null && size > 0 && (unit === 'g' || unit === 'ml' || unit === 'grm' || unit === 'mlt')
  const unitLabel = unit === 'ml' || unit === 'mlt' ? 'ml' : 'g'
  return {
    barcode,
    name: readableName(name),
    brand: brand ? readableName(brand) : null,
    serving: measured ? (household ? `${household} (${tidy(size)} ${unitLabel})` : `${tidy(size)} ${unitLabel}`) : '100 g',
    macros: measured ? scaleMacros(per100, size / 100) : scaleMacros(per100, 1),
    source: 'usda'
  }
}

/**
 * USDA copies the label, so its numbers win. Open Food Facts usually has the name a person would
 * say, where USDA has the full catalogue description.
 */
export function mergeProducts(usda: FoodProduct | null, openFoodFacts: FoodProduct | null): FoodProduct | null {
  if (!usda) return openFoodFacts
  if (!openFoodFacts) return usda
  return { ...usda, name: openFoodFacts.name, brand: openFoodFacts.brand ?? usda.brand }
}

export type FoodAnalysisMode = 'meal' | 'fridge'

/** What the model saw on a plate, a label, or in a description. Totals are the sum of the parts. */
export interface FoodMealDraft extends FoodMacros {
  name: string
  serving: string
  parts: FoodPart[]
  /** Assumptions the estimate rests on, like "about 1 tbsp of oil". */
  note: string
}

export interface FridgeDraftItem {
  name: string
  icon: string
  brand: string | null
}

export type FoodAnalysis =
  | { mode: 'meal'; meal: FoodMealDraft }
  | { mode: 'fridge'; items: FridgeDraftItem[] }

export interface AnalyzeFoodInput {
  apiKey: string
  model: string
  mode: FoodAnalysisMode
  image: { base64: string; mimeType: string } | null
  /** A description, or a hint about the photo like "half of it" or "about 200 g". */
  text: string
}

export type FoodAnalysisFailure = 'not_food' | 'unauthorized' | 'rate_limited' | 'timeout' | 'upstream' | 'invalid'

export type FoodAnalysisResult =
  | { ok: true; data: FoodAnalysis }
  | { ok: false; reason: FoodAnalysisFailure; message: string }

export const FOOD_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_FOOD_IMAGE_BYTES = 10 * 1024 * 1024
export const FOOD_TEXT_LIMIT = 1000
const ANALYSIS_TIMEOUT_MS = 60_000
const MAX_DRAFT_PARTS = 20
const MAX_FRIDGE_DRAFT_ITEMS = 60

const partProperties = {
  name: { type: 'string' },
  calories: { type: 'number', minimum: 0, description: 'kcal for this part as eaten' },
  protein: { type: 'number', minimum: 0, description: 'grams' },
  carbs: { type: 'number', minimum: 0, description: 'grams' },
  fat: { type: 'number', minimum: 0, description: 'grams' }
}

const MEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isFood', 'name', 'serving', 'note', 'parts'],
  properties: {
    isFood: { type: 'boolean', description: 'False when there is no food or drink to log' },
    name: { type: 'string', description: 'A short name for the whole meal, like "Chicken burrito bowl"' },
    serving: { type: 'string', description: 'How much was eaten, like "1 bowl" or "2 slices". Empty when unclear.' },
    note: { type: 'string', description: 'One short line on what the estimate assumes. Empty when it reads a label.' },
    parts: {
      type: 'array', maxItems: MAX_DRAFT_PARTS,
      items: { type: 'object', additionalProperties: false, required: Object.keys(partProperties), properties: partProperties }
    }
  }
}

const fridgeItemProperties = {
  name: { type: 'string', description: 'Plain name, like "Whole milk" or "Eggs"' },
  icon: { type: 'string', description: 'One emoji for the item' },
  brand: { type: ['string', 'null'], description: 'The brand when it is readable, otherwise null' }
}

const FRIDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array', maxItems: MAX_FRIDGE_DRAFT_ITEMS,
      items: { type: 'object', additionalProperties: false, required: Object.keys(fridgeItemProperties), properties: fridgeItemProperties }
    }
  }
}

const MEAL_PROMPT = [
  'Estimate the calories, protein, carbs, and fat of the food or drink a person ate, from a photo, a description, or both.',
  'Split the meal into its parts, one per food on the plate, with each part\'s numbers for the amount eaten.',
  'When a nutrition facts label is visible, read it: use its serving size and its per-serving values exactly, and put that serving in serving.',
  'When a known packaged or restaurant item is visible, use its published values.',
  'Otherwise judge portions from the plate, utensils, hands, and packaging. Count cooking oil, butter, sauces, dressings, and drinks you can see.',
  'The person\'s own words override what you see: "half", "two of these", or "about 200 g" change the amount.',
  'Round calories to whole numbers and grams to one decimal. Never return negative numbers.',
  'Set isFood to false and leave parts empty when there is nothing to eat or drink in it.'
].join(' ')

const FRIDGE_PROMPT = [
  'List the groceries in this photo so they can be kept in a list of food at home: a fridge, a pantry, a shopping bag, or a receipt.',
  'One entry per distinct product. Use plain names a person would say, like "Greek yogurt" or "Baby spinach", not receipt codes.',
  'Skip things that are not food or drink, like bags, paper towels, or cleaning supplies. Pick one fitting emoji per item.',
  'Return an empty list when there is no food in it.'
].join(' ')

interface ChatCompletion {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>
  error?: { message?: string }
}

function rounded(value: number, places: number): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function draftPart(value: unknown): FoodPart | null {
  if (!isRecord(value)) return null
  const name = cleanText(value.name, FOOD_NAME_LIMIT)
  const numbers = [value.calories, value.protein, value.carbs, value.fat]
  if (!name || !numbers.every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)) return null
  const part: FoodPart = {
    name,
    calories: rounded(Number(value.calories), 0),
    protein: rounded(Number(value.protein), 1),
    carbs: rounded(Number(value.carbs), 1),
    fat: rounded(Number(value.fat), 1)
  }
  return isFoodPart(part) ? part : null
}

/** Checks what the model returned and adds the parts up, rather than trusting its arithmetic. */
export function mealDraftFrom(value: unknown): FoodMealDraft | 'not_food' | null {
  if (!isRecord(value)) return null
  if (value.isFood === false) return 'not_food'
  if (!Array.isArray(value.parts) || value.parts.length === 0) return value.isFood === true ? null : 'not_food'
  const parts = value.parts.map(draftPart)
  if (parts.some((part) => part === null)) return null
  const kept = parts.filter((part): part is FoodPart => part !== null).slice(0, FOOD_PART_LIMIT)
  const name = cleanText(value.name, FOOD_NAME_LIMIT) || kept.map((part) => part.name).join(', ').slice(0, FOOD_NAME_LIMIT)
  const totals = sumMacros(kept)
  return {
    name,
    serving: cleanText(value.serving, FOOD_SERVING_LIMIT),
    note: cleanText(value.note, FOOD_NOTE_LIMIT),
    parts: kept,
    ...totals,
    calories: Math.round(totals.calories)
  }
}

export function fridgeDraftFrom(value: unknown): FridgeDraftItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null
  const items: FridgeDraftItem[] = []
  for (const item of value.items) {
    if (!isRecord(item)) return null
    const name = cleanText(item.name, FRIDGE_NAME_LIMIT)
    if (!name) continue
    const icon = typeof item.icon === 'string' ? item.icon.trim() : ''
    const brand = cleanText(item.brand, FRIDGE_BRAND_LIMIT)
    items.push({ name: readableName(name), icon: icon.length <= FRIDGE_ICON_LIMIT ? icon : '', brand: brand ? readableName(brand) : null })
  }
  return items
}

/**
 * Sends one photo or description to OpenRouter with a strict schema. Meals come back as parts with
 * their own numbers; fridge photos come back as a list of products.
 */
export async function analyzeFood(input: AnalyzeFoodInput, fetcher: FetchLike): Promise<FoodAnalysisResult> {
  const text = input.text.trim().slice(0, FOOD_TEXT_LIMIT)
  if (!input.image && !text) return { ok: false, reason: 'invalid', message: 'Add a photo or describe the food.' }
  const prompt = input.mode === 'meal' ? MEAL_PROMPT : FRIDGE_PROMPT
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: text ? `${prompt}\n\nThe person wrote: ${text}` : prompt }]
  if (input.image) content.push({ type: 'image_url', image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}` } })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey.trim()}`,
        'content-type': 'application/json',
        'x-title': 'Ego food'
      },
      body: JSON.stringify({
        model: input.model.trim(),
        messages: [{ role: 'user', content }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: input.mode === 'meal' ? 'food_meal' : 'food_fridge',
            strict: true,
            schema: input.mode === 'meal' ? MEAL_SCHEMA : FRIDGE_SCHEMA
          }
        }
      }),
      signal: controller.signal
    })
  } catch (error: unknown) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'Reading the food took longer than a minute. Try again.' }
    }
    return { ok: false, reason: 'upstream', message: 'OpenRouter is unreachable. Check the connection and try again.' }
  }
  clearTimeout(timer)
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'unauthorized', message: 'OpenRouter rejected the server key. Replace OPENROUTER_API_KEY on the Worker.' }
  }
  if (response.status === 429) return { ok: false, reason: 'rate_limited', message: 'OpenRouter is busy. Wait a moment and try again.' }
  let body: ChatCompletion
  try {
    body = await response.json() as ChatCompletion
  } catch {
    return { ok: false, reason: 'upstream', message: 'OpenRouter returned an unreadable response.' }
  }
  if (!response.ok) return { ok: false, reason: 'upstream', message: body.error?.message ?? `OpenRouter returned HTTP ${response.status}.` }
  const message = body.choices?.[0]?.message
  if (message?.refusal || !message?.content) {
    return { ok: false, reason: 'invalid', message: 'The model could not read that. Try a clearer photo or a few more words.' }
  }
  let parsed: unknown
  try { parsed = JSON.parse(message.content) } catch {
    return { ok: false, reason: 'invalid', message: 'The model returned something unreadable. Try again.' }
  }
  if (input.mode === 'fridge') {
    const items = fridgeDraftFrom(parsed)
    if (!items) return { ok: false, reason: 'invalid', message: 'The model returned something unreadable. Try again.' }
    if (items.length === 0) return { ok: false, reason: 'not_food', message: 'No food showed up in that photo.' }
    return { ok: true, data: { mode: 'fridge', items } }
  }
  const meal = mealDraftFrom(parsed)
  if (meal === 'not_food') return { ok: false, reason: 'not_food', message: 'No food showed up in that. Try another photo.' }
  if (!meal) return { ok: false, reason: 'invalid', message: 'The model returned something unreadable. Try again.' }
  return { ok: true, data: { mode: 'meal', meal } }
}
