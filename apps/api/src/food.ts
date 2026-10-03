import {
  DEFAULT_ASSISTANT_MODEL, FOOD_IMAGE_MIME_TYPES, FOOD_TEXT_LIMIT, MAX_FOOD_IMAGE_BYTES, analyzeFood, barcodeKey,
  isFoodBarcode, mergeProducts, parseOpenFoodFacts, parseUsdaSearch,
  type FoodAnalysisFailure, type FoodProduct
} from '@ego/core'
import {
  HTTP_STATUS,
  type ApiErrorCode, type FoodAnalyzeRequest, type FoodAnalyzeResponse, type FoodImage, type FoodProductResponse
} from '@ego/api-contracts'
import type { Env } from './auth'

const LOOKUP_TIMEOUT_MS = 8000
/** Open Food Facts asks every client to name itself. */
const USER_AGENT = 'Ego/0.6 (personal food log; https://github.com/kharitonov-egor/ego)'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

function failure(code: ApiErrorCode, message: string): Response {
  return json({ ok: false, error: { code, message } }, HTTP_STATUS[code])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFoodImage(value: unknown): value is FoodImage {
  if (!isRecord(value) || typeof value.base64 !== 'string' || typeof value.mimeType !== 'string') return false
  if (!(FOOD_IMAGE_MIME_TYPES as readonly string[]).includes(value.mimeType)) return false
  const encoded = value.base64.replace(/[\r\n]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false
  return encoded.length * 0.75 <= MAX_FOOD_IMAGE_BYTES
}

function parseAnalyze(value: unknown): FoodAnalyzeRequest | null {
  if (!isRecord(value) || (value.mode !== 'meal' && value.mode !== 'fridge')) return null
  if (value.image !== null && !isFoodImage(value.image)) return null
  if (typeof value.text !== 'string' || value.text.length > FOOD_TEXT_LIMIT) return null
  if (value.image === null && !value.text.trim()) return null
  return { mode: value.mode, image: value.image, text: value.text }
}

const FAILURE_CODES: Record<FoodAnalysisFailure, ApiErrorCode> = {
  not_food: 'INVALID_REQUEST',
  invalid: 'UPSTREAM_ERROR',
  unauthorized: 'UPSTREAM_ERROR',
  rate_limited: 'RATE_LIMITED',
  timeout: 'UPSTREAM_ERROR',
  upstream: 'UPSTREAM_ERROR'
}

function foodModel(env: Env): string {
  return env.FOOD_MODEL?.trim() || env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL
}

async function analyze(request: Request, env: Env): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return failure('NOT_CONFIGURED', 'Add OPENROUTER_API_KEY on the Worker to read food photos')
  let body: unknown
  try { body = await request.json() } catch { return failure('INVALID_REQUEST', 'The request body is not valid JSON') }
  const input = parseAnalyze(body)
  if (!input) return failure('INVALID_REQUEST', 'Send a JPEG, PNG, or WebP photo under 10 MB, or a description')
  const result = await analyzeFood({
    apiKey: env.OPENROUTER_API_KEY, model: foodModel(env), mode: input.mode, image: input.image, text: input.text
  }, (url, init) => fetch(url, init))
  if (!result.ok) return failure(FAILURE_CODES[result.reason], result.message)
  const data: FoodAnalyzeResponse = result.data
  return ok(data)
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function openFoodFacts(barcode: string): Promise<FoodProduct | null> {
  const fields = 'code,product_name,product_name_en,brands,serving_size,serving_quantity,nutriments,nutrition_data_per'
  const body = await fetchJson(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
    { 'user-agent': USER_AGENT })
  return parseOpenFoodFacts(body, barcode)
}

/** FoodData Central stores UPCs as 14-digit GTINs and only finds them through its text search. */
async function usda(barcode: string, apiKey: string): Promise<FoodProduct | null> {
  const gtin = barcodeKey(barcode).padStart(14, '0')
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${gtin}&dataType=Branded&pageSize=5`
  return parseUsdaSearch(await fetchJson(url), barcode)
}

async function lookUpProduct(env: Env, barcode: string): Promise<FoodProduct | null> {
  const [fromUsda, fromOpenFoodFacts] = await Promise.all([
    env.USDA_API_KEY ? usda(barcode, env.USDA_API_KEY) : Promise.resolve(null),
    openFoodFacts(barcode)
  ])
  return mergeProducts(fromUsda, fromOpenFoodFacts)
}

async function product(env: Env, barcode: string): Promise<Response> {
  if (!isFoodBarcode(barcode)) return failure('INVALID_REQUEST', 'A barcode is 6 to 14 digits')
  const data: FoodProductResponse = { product: await lookUpProduct(env, barcode) }
  return ok(data)
}

/** Routes under `/v1/food/`, apart from media. Null means the path is not one of them. */
export function foodRoute(request: Request, env: Env, path: string): Promise<Response> | null {
  if (request.method === 'POST' && path === '/v1/food/analyze') return analyze(request, env)
  if (request.method === 'GET' && path.startsWith('/v1/food/products/')) {
    return product(env, decodeURIComponent(path.slice('/v1/food/products/'.length)))
  }
  return null
}
