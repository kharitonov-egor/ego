import { MAX_TRELLO_ATTACHMENT_BYTES, type TrelloCardResponse } from '@ego/api-contracts'
import {
  MAX_TRANSACTION_IMAGE_BYTES, analyzeTransactionImage, createTrelloClient,
  type ImageAnalysisCategory, type TrelloClient
} from '@ego/core'
import type { Env } from './auth'

const TRELLO_ID = /^[A-Za-z0-9]{1,64}$/
const MAX_TRELLO_TEXT_LENGTH = 16384

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(status: number, code: string, message: string): Response {
  return json({ ok: false, error: { code, message } }, status)
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trelloClient(env: Env): TrelloClient | null {
  const apiKey = env.TRELLO_API_KEY
  const token = env.TRELLO_TOKEN
  if (!apiKey || !token) return null
  return createTrelloClient({
    getCredentials: () => ({ apiKey, token }),
    fetch: (url, init) => fetch(url, init),
    onError: () => undefined
  })
}

const trelloMissing = (): Response => failure(503, 'NOT_CONFIGURED', 'Trello is not set up on the server')

function trelloFailed(detail: string | undefined): Response {
  return failure(502, 'UPSTREAM_ERROR', detail ? `Trello refused the request. ${detail}` : 'Trello refused the request')
}

export async function trelloBoards(env: Env): Promise<Response> {
  const client = trelloClient(env)
  if (!client) return trelloMissing()
  const result = await client.listBoards()
  return result.ok && result.data ? ok(result.data) : trelloFailed(result.detail)
}

export async function trelloLists(env: Env, boardId: string): Promise<Response> {
  const client = trelloClient(env)
  if (!client) return trelloMissing()
  if (!TRELLO_ID.test(boardId)) return failure(400, 'INVALID_REQUEST', 'That board ID is not valid')
  const result = await client.listLists(boardId)
  return result.ok && result.data ? ok(result.data) : trelloFailed(result.detail)
}

export async function trelloCreateCard(request: Request, env: Env): Promise<Response> {
  const client = trelloClient(env)
  if (!client) return trelloMissing()
  let body: unknown
  try { body = await request.json() } catch { return failure(400, 'INVALID_REQUEST', 'The request body is not valid JSON') }
  if (!isRecord(body) || typeof body.title !== 'string' || typeof body.description !== 'string' ||
      typeof body.listId !== 'string' || !TRELLO_ID.test(body.listId) ||
      body.title.length > MAX_TRELLO_TEXT_LENGTH || body.description.length > MAX_TRELLO_TEXT_LENGTH) {
    return failure(400, 'INVALID_REQUEST', 'Check the card title, description, and list')
  }
  const result = await client.createCard({
    name: body.title.trim() || '(empty)',
    desc: body.description.trim(),
    idList: body.listId
  })
  if (!result.ok || !result.data) return trelloFailed(result.detail)
  const data: TrelloCardResponse = { id: result.data.id, shortUrl: result.data.shortUrl }
  return ok(data)
}

/** The default workers-types declare `FormData.get` as string-only, though the runtime returns files. */
function formFile(form: FormData, field: string): File | null {
  for (const [name, value] of form.entries()) {
    if (name === field && typeof value !== 'string') return value
  }
  return null
}

export async function trelloAddAttachment(request: Request, env: Env, cardId: string): Promise<Response> {
  const client = trelloClient(env)
  if (!client) return trelloMissing()
  if (!TRELLO_ID.test(cardId)) return failure(400, 'INVALID_REQUEST', 'That card ID is not valid')
  let form: FormData
  try { form = await request.formData() } catch { return failure(400, 'INVALID_REQUEST', 'Attach one file') }
  const file = formFile(form, 'file')
  if (!file) return failure(400, 'INVALID_REQUEST', 'Attach one file')
  if (file.size === 0 || file.size > MAX_TRELLO_ATTACHMENT_BYTES) {
    return failure(400, 'INVALID_REQUEST', 'Attachments must be smaller than 10 MB')
  }
  const result = await client.addAttachment(cardId, {
    kind: 'bytes',
    data: await file.arrayBuffer(),
    name: file.name.slice(0, 200) || 'attachment',
    mimeType: file.type || 'application/octet-stream'
  })
  return result.ok ? ok({ attached: true }) : trelloFailed(result.detail)
}

/** The desktop's default for its own key, so a receipt reads the same from either. */
const DEFAULT_RECEIPT_MODEL = 'openai/gpt-5.6-terra'
const MAX_RECEIPT_REQUEST_CHARS = Math.ceil(MAX_TRANSACTION_IMAGE_BYTES / 3) * 4 + 256 * 1024

function receiptCategories(value: unknown): ImageAnalysisCategory[] | null {
  if (!Array.isArray(value) || value.length > 500) return null
  const categories: ImageAnalysisCategory[] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') return null
    if (item.kind !== 'income' && item.kind !== 'expense') return null
    categories.push({ id: item.id.slice(0, 100), name: item.name.slice(0, 100), kind: item.kind })
  }
  return categories
}

/** Reads a receipt photo with the Worker's OpenRouter key, for the web app, which holds no keys. */
export async function analyzeReceiptImage(request: Request, env: Env): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return failure(503, 'NOT_CONFIGURED', 'Add OPENROUTER_API_KEY to the Worker to read receipts')
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_RECEIPT_REQUEST_CHARS) {
    return failure(400, 'INVALID_REQUEST', 'This image is larger than 10 MB. Choose a smaller image.')
  }
  let body: unknown
  try { body = await request.json() } catch { return failure(400, 'INVALID_REQUEST', 'Send the image as JSON') }
  const categories = isRecord(body) ? receiptCategories(body.categories) : null
  if (!isRecord(body) || typeof body.base64 !== 'string' || typeof body.mimeType !== 'string' || !categories) {
    return failure(400, 'INVALID_REQUEST', 'Send the image, its type, and the categories')
  }
  const result = await analyzeTransactionImage({
    base64: body.base64,
    mimeType: body.mimeType,
    categories,
    apiKey: env.OPENROUTER_API_KEY,
    model: env.RECEIPT_MODEL?.trim() || DEFAULT_RECEIPT_MODEL
  }, (url, init) => fetch(url, init))
  return result.ok ? ok(result.data) : failure(502, 'UPSTREAM_ERROR', result.message)
}
