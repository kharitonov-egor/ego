import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FoodAnalyzeResponse, FoodProductResponse } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-food'
let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

async function environment(overrides: Partial<Env> = {}): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-a', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: ledger.db, OPENROUTER_API_KEY: 'server-key', ...overrides }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ego.example${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers }
  })
}

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

async function payload<T>(response: Response): Promise<Envelope<T>> {
  return await response.json() as Envelope<T>
}

function completion(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200, headers: { 'content-type': 'application/json' }
  })
}

const image = { base64: 'aGVsbG8=', mimeType: 'image/jpeg' }

describe('POST /v1/food/analyze', () => {
  it('reads a meal photo and adds up the parts itself', async () => {
    const env = await environment({ FOOD_MODEL: 'vision/model' })
    const fetchMock = vi.fn().mockResolvedValueOnce(completion({
      isFood: true, name: 'Burrito bowl', serving: '1 bowl', note: 'About 1 tbsp of oil',
      parts: [
        { name: 'Chicken', calories: 280.4, protein: 40.04, carbs: 0, fat: 12 },
        { name: 'Rice', calories: 360, protein: 5, carbs: 60.26, fat: 10 }
      ]
    }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(request('/v1/food/analyze', { method: 'POST', body: JSON.stringify({ mode: 'meal', image, text: 'half the rice' }) }), env)
    const body = await payload<FoodAnalyzeResponse>(response)
    expect(body.data).toEqual({
      mode: 'meal',
      meal: {
        name: 'Burrito bowl', serving: '1 bowl', note: 'About 1 tbsp of oil',
        parts: [
          { name: 'Chicken', calories: 280, protein: 40, carbs: 0, fat: 12 },
          { name: 'Rice', calories: 360, protein: 5, carbs: 60.3, fat: 10 }
        ],
        calories: 640, protein: 45, carbs: 60.3, fat: 22
      }
    })
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
    expect(sent.model).toBe('vision/model')
    expect(JSON.stringify(sent.messages)).toContain('The person wrote: half the rice')
    expect(JSON.stringify(sent.messages)).toContain('data:image/jpeg;base64,aGVsbG8=')
    expect(sent.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'food_meal', strict: true } })
  })

  it('lists the groceries in a fridge photo', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(completion({
      items: [{ name: 'GREEK YOGURT', icon: '🥣', brand: 'chobani' }, { name: '  ', icon: '', brand: null }]
    })))
    const body = await payload<FoodAnalyzeResponse>(await handle(request('/v1/food/analyze', {
      method: 'POST', body: JSON.stringify({ mode: 'fridge', image, text: '' })
    }), env))
    expect(body.data).toEqual({ mode: 'fridge', items: [{ name: 'Greek Yogurt', icon: '🥣', brand: 'chobani' }] })
  })

  it('says so when there is no food, and checks the request first', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(completion({ isFood: false, name: '', serving: '', note: '', parts: [] })))
    const notFood = await handle(request('/v1/food/analyze', { method: 'POST', body: JSON.stringify({ mode: 'meal', image, text: '' }) }), env)
    expect(notFood.status).toBe(400)
    expect((await payload<null>(notFood)).error?.message).toBe('No food showed up in that. Try another photo.')
    const empty = await handle(request('/v1/food/analyze', { method: 'POST', body: JSON.stringify({ mode: 'meal', image: null, text: ' ' }) }), env)
    expect(empty.status).toBe(400)
    const gif = await handle(request('/v1/food/analyze', {
      method: 'POST', body: JSON.stringify({ mode: 'meal', image: { ...image, mimeType: 'image/gif' }, text: '' })
    }), env)
    expect(gif.status).toBe(400)
    const missingKey = await environment({ OPENROUTER_API_KEY: undefined })
    expect((await handle(request('/v1/food/analyze', { method: 'POST', body: JSON.stringify({ mode: 'meal', image, text: '' }) }), missingKey)).status).toBe(503)
  })
})

describe('GET /v1/food/products/:barcode', () => {
  const openFoodFacts = {
    status: 1,
    product: {
      product_name: 'Diet Coke Soft Drink', brands: 'Coke', serving_size: '1 can (354.9 mL)', serving_quantity: 354.9,
      nutrition_data_per: '100ml',
      nutriments: { 'energy-kcal_serving': 0, proteins_serving: 0, carbohydrates_serving: 0, fat_serving: 0 }
    }
  }
  const usda = {
    foods: [{
      fdcId: 1, description: 'GREEK YOGURT, PLAIN', brandName: 'CHOBANI', gtinUpc: '00894700010199', servingSize: 170,
      servingSizeUnit: 'g', householdServingFullText: '1 container',
      foodNutrients: [
        { nutrientNumber: '208', unitName: 'KCAL', value: 59 },
        { nutrientNumber: '203', unitName: 'G', value: 10 },
        { nutrientNumber: '205', unitName: 'G', value: 3.6 },
        { nutrientNumber: '204', unitName: 'G', value: 0.4 }
      ]
    }]
  }

  it('reads Open Food Facts when there is no USDA key', async () => {
    const env = await environment()
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(openFoodFacts), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = await payload<FoodProductResponse>(await handle(request('/v1/food/products/049000028911'), env))
    expect(body.data.product).toEqual({
      barcode: '049000028911', name: 'Diet Coke Soft Drink', brand: 'Coke', serving: '1 can (354.9 mL)',
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0 }, source: 'openfoodfacts'
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('world.openfoodfacts.org/api/v2/product/049000028911.json')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'user-agent': expect.stringContaining('Ego') })
  })

  it('prefers USDA label numbers and keeps the plainer Open Food Facts name', async () => {
    const env = await environment({ USDA_API_KEY: 'usda-key' })
    const fetchMock = vi.fn(async (url: string) => url.includes('api.nal.usda.gov')
      ? new Response(JSON.stringify(usda), { status: 200 })
      : new Response(JSON.stringify({ status: 1, product: { product_name: 'Plain Greek Yogurt', brands: 'Chobani', nutriments: {} } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = await payload<FoodProductResponse>(await handle(request('/v1/food/products/894700010199'), env))
    expect(body.data.product).toEqual({
      barcode: '894700010199', name: 'Plain Greek Yogurt', brand: 'Chobani', serving: '1 container (170 g)',
      macros: { calories: 100.3, protein: 17, carbs: 6.1, fat: 0.7 }, source: 'usda'
    })
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('query=00894700010199'))).toBe(true)
  })

  it('answers null for an unknown code and refuses a malformed one', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 0 }), { status: 200 })))
    expect((await payload<FoodProductResponse>(await handle(request('/v1/food/products/12345678'), env))).data).toEqual({ product: null })
    expect((await handle(request('/v1/food/products/abc'), env)).status).toBe(400)
  })
})
