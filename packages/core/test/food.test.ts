import { describe, expect, it, vi } from 'vitest'
import {
  analyzeFood, barcodeKey, caloriesFromMacros, foodDays, foodMediaIds, fridgeDraftFrom, isFoodEntryInput, isFoodGoalInput,
  isFridgeItemInput, mealDraftFrom, mergeProducts, parseOpenFoodFacts, parseUsdaSearch, readableName, sumMacros,
  validateAssistantArguments,
  type FoodEntryInput
} from '../src'

const entry = (overrides: Partial<FoodEntryInput> = {}): FoodEntryInput => ({
  name: 'Oatmeal', date: '2026-10-02', eatenAt: '2026-10-02T12:30:00.000Z', serving: '1 bowl',
  calories: 300, protein: 10, carbs: 54, fat: 6, parts: [], source: 'manual', barcode: null, photo: null, note: '',
  ...overrides
})

describe('food records', () => {
  it('accepts a whole entry and refuses broken ones', () => {
    expect(isFoodEntryInput(entry())).toBe(true)
    expect(isFoodEntryInput(entry({ photo: { mediaId: 'm-1', previewId: null, width: 1600, height: 1200 } }))).toBe(true)
    expect(isFoodEntryInput(entry({ name: '  ' }))).toBe(false)
    expect(isFoodEntryInput(entry({ calories: -1 }))).toBe(false)
    expect(isFoodEntryInput(entry({ protein: Number.NaN }))).toBe(false)
    expect(isFoodEntryInput(entry({ date: '2026-02-30' }))).toBe(false)
    expect(isFoodEntryInput(entry({ barcode: 'abc123' }))).toBe(false)
    expect(isFoodEntryInput({ ...entry(), source: 'fax' })).toBe(false)
    expect(isFoodEntryInput(entry({ photo: { mediaId: 'bad id', previewId: null, width: null, height: null } }))).toBe(false)
  })

  it('checks fridge items and targets', () => {
    const item = { name: 'Whole milk', icon: '🥛', brand: null, barcode: '041415012345', source: 'barcode', purchaseId: null, addedAt: '2026-10-02T12:00:00.000Z' }
    expect(isFridgeItemInput(item)).toBe(true)
    expect(isFridgeItemInput({ ...item, icon: '🥛🥛🥛🥛🥛🥛🥛🥛🥛' })).toBe(false)
    expect(isFridgeItemInput({ ...item, source: 'fridge' })).toBe(false)
    expect(isFoodGoalInput({ calories: 2200, protein: 150, carbs: null, fat: null })).toBe(true)
    expect(isFoodGoalInput({ calories: 0, protein: null, carbs: null, fat: null })).toBe(false)
  })

  it('names every file an entry needs uploaded', () => {
    expect(foodMediaIds(entry())).toEqual([])
    expect(foodMediaIds(entry({ photo: { mediaId: 'big', previewId: 'small', width: null, height: null } }))).toEqual(['big', 'small'])
  })

  it('groups entries by day, newest first, with totals', () => {
    const days = foodDays([
      entry({ name: 'Breakfast', date: '2026-10-01', eatenAt: '2026-10-01T12:00:00.000Z', calories: 400.04 }),
      entry({ name: 'Lunch', date: '2026-10-02', eatenAt: '2026-10-02T16:00:00.000Z', calories: 650 }),
      entry({ name: 'Snack', date: '2026-10-02', eatenAt: '2026-10-02T20:00:00.000Z', calories: 150, protein: 2.25 })
    ])
    expect(days.map((day) => day.date)).toEqual(['2026-10-02', '2026-10-01'])
    expect(days[0].entries.map((item) => item.name)).toEqual(['Snack', 'Lunch'])
    expect(days[0].totals).toEqual({ calories: 800, protein: 12.3, carbs: 108, fat: 12 })
    expect(days[1].totals.calories).toBe(400)
    expect(sumMacros([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('works out calories from macros and tidies names in capitals', () => {
    expect(caloriesFromMacros(10, 20, 5)).toBe(165)
    expect(readableName('CHOBANI GREEK YOGURT')).toBe('Chobani Greek Yogurt')
    expect(readableName('Diet Coke')).toBe('Diet Coke')
    expect(barcodeKey('0049000028911')).toBe('49000028911')
  })
})

describe('barcode products', () => {
  it('reads Open Food Facts per serving, then per 100 g scaled to the serving', () => {
    const perServing = parseOpenFoodFacts({
      status: 1,
      product: {
        product_name: 'Peanut Butter', brands: 'Jif, Smucker', serving_size: '2 tbsp (32 g)',
        nutriments: { 'energy-kcal_serving': 190, proteins_serving: 7, carbohydrates_serving: 8, fat_serving: 16 }
      }
    }, '051500255162')
    expect(perServing).toEqual({
      barcode: '051500255162', name: 'Peanut Butter', brand: 'Jif', serving: '2 tbsp (32 g)',
      macros: { calories: 190, protein: 7, carbs: 8, fat: 16 }, source: 'openfoodfacts'
    })
    const scaled = parseOpenFoodFacts({
      status: 1,
      product: { product_name: 'Oats', serving_quantity: 40, nutriments: { 'energy-kj_100g': 1556, proteins_100g: 13, carbohydrates_100g: 60, fat_100g: 7 } }
    }, '12345678')
    expect(scaled?.serving).toBe('40 g')
    expect(scaled?.macros).toEqual({ calories: 148.8, protein: 5.2, carbs: 24, fat: 2.8 })
    expect(parseOpenFoodFacts({ status: 0 }, '12345678')).toBeNull()
    expect(parseOpenFoodFacts({ status: 1, product: { product_name: '' } }, '12345678')).toBeNull()
  })

  it('reads only the USDA food whose UPC matches, and fills missing energy from macros', () => {
    const found = parseUsdaSearch({
      foods: [
        { gtinUpc: '00011111111111', description: 'OTHER', foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 1 }] },
        {
          gtinUpc: '00894700010199', description: 'PLAIN GREEK YOGURT', brandOwner: 'Chobani', servingSize: 180, servingSizeUnit: 'g',
          foodNutrients: [
            { nutrientNumber: '203', unitName: 'G', value: 9.44 },
            { nutrientNumber: '204', unitName: 'G', value: 1.94 },
            { nutrientNumber: '205', unitName: 'G', value: 3.89 }
          ]
        }
      ]
    }, '894700010199')
    expect(found).toEqual({
      barcode: '894700010199', name: 'Plain Greek Yogurt', brand: 'Chobani', serving: '180 g',
      macros: { calories: 127.4, protein: 17, carbs: 7, fat: 3.5 }, source: 'usda'
    })
    expect(parseUsdaSearch({ foods: [] }, '894700010199')).toBeNull()
  })

  it('keeps USDA numbers and the plainer Open Food Facts name', () => {
    const usda = parseUsdaSearch({ foods: [{ gtinUpc: '012', description: 'COLA, DIET', foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 0 }] }] }, '12')
    const off = parseOpenFoodFacts({ status: 1, product: { product_name: 'Diet Coke', brands: 'Coca-Cola', nutriments: {} } }, '12')
    expect(mergeProducts(usda, off)).toMatchObject({ name: 'Diet Coke', brand: 'Coca-Cola', source: 'usda', serving: '100 g' })
    expect(mergeProducts(null, off)?.source).toBe('openfoodfacts')
    expect(mergeProducts(null, null)).toBeNull()
  })
})

describe('reading the model', () => {
  it('adds the parts up itself and rounds them', () => {
    expect(mealDraftFrom({
      isFood: true, name: '', serving: ' 1 plate ', note: '',
      parts: [{ name: 'Rice', calories: 205.6, protein: 4.26, carbs: 44.5, fat: 0.44 }, { name: 'Beans', calories: 110, protein: 7, carbs: 20, fat: 0.5 }]
    })).toEqual({
      name: 'Rice, Beans', serving: '1 plate', note: '',
      parts: [{ name: 'Rice', calories: 206, protein: 4.3, carbs: 44.5, fat: 0.4 }, { name: 'Beans', calories: 110, protein: 7, carbs: 20, fat: 0.5 }],
      calories: 316, protein: 11.3, carbs: 64.5, fat: 0.9
    })
    expect(mealDraftFrom({ isFood: false, name: '', serving: '', note: '', parts: [] })).toBe('not_food')
    expect(mealDraftFrom({ isFood: true, name: 'x', serving: '', note: '', parts: [{ name: 'x', calories: -5, protein: 0, carbs: 0, fat: 0 }] })).toBeNull()
  })

  it('cleans the fridge list', () => {
    expect(fridgeDraftFrom({ items: [{ name: 'EGGS', icon: '🥚', brand: '' }, { name: '', icon: '', brand: null }] }))
      .toEqual([{ name: 'Eggs', icon: '🥚', brand: null }])
    expect(fridgeDraftFrom({ list: [] })).toBeNull()
  })

  it('asks OpenRouter with a strict schema and the photo', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ items: [{ name: 'Milk', icon: '🥛', brand: null }] }) } }]
    }), { status: 200 }))
    const result = await analyzeFood({
      apiKey: ' key ', model: 'vision/model', mode: 'fridge', image: { base64: 'aGVsbG8=', mimeType: 'image/jpeg' }, text: ''
    }, fetcher)
    expect(result).toEqual({ ok: true, data: { mode: 'fridge', items: [{ name: 'Milk', icon: '🥛', brand: null }] } })
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key')
    const body = JSON.parse(String(init.body)) as { response_format: { json_schema: { strict: boolean } } }
    expect(body.response_format.json_schema.strict).toBe(true)
  })

  it('names the failure', async () => {
    const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }))
    const input = { apiKey: 'k', model: 'm', mode: 'meal' as const, image: null, text: 'toast' }
    expect(await analyzeFood({ ...input, text: ' ' }, answer(200, {}))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await analyzeFood(input, answer(401, {}))).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect(await analyzeFood(input, answer(429, {}))).toMatchObject({ ok: false, reason: 'rate_limited' })
    expect(await analyzeFood(input, answer(500, { error: { message: 'boom' } }))).toEqual({ ok: false, reason: 'upstream', message: 'boom' })
    expect(await analyzeFood(input, answer(200, { choices: [{ message: { content: '{"isFood":false,"parts":[]}' } }] })))
      .toMatchObject({ ok: false, reason: 'not_food' })
  })
})

describe('food tools for the assistant', () => {
  it('validates a meal and a grocery receipt', () => {
    const meal = { name: 'Toast', date: '2026-10-02', time: '08:15', serving: null, calories: 180, protein: 6, carbs: 30, fat: 3, usePhoto: false }
    expect(validateAssistantArguments('log_food', { entries: [meal] }).ok).toBe(true)
    expect(validateAssistantArguments('log_food', { entries: [{ ...meal, time: '8:15' }] }).ok).toBe(false)
    expect(validateAssistantArguments('log_food', { entries: [{ ...meal, photo: { mediaId: 'x' } }] }).ok).toBe(false)
    expect(validateAssistantArguments('add_fridge_items', { items: [{ name: 'Milk', icon: '🥛', brand: null }] }).ok).toBe(true)
    expect(validateAssistantArguments('set_food_targets', { calories: 2200, protein: null, carbs: null, fat: 0 }).ok).toBe(true)
  })
})
