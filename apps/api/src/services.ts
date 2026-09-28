import {
  MAX_TRELLO_ATTACHMENT_BYTES,
  type MoneyAgentRequest,
  type MoneyAgentResponse,
  type TrelloCardResponse
} from '@ego/api-contracts'
import {
  createTrelloClient,
  isDateString,
  runMoneyAgent,
  type ImageAnalysisCategory,
  type MoneyAgentAccount,
  type TrelloClient
} from '@ego/core'
import type { Env } from './auth'

const DEFAULT_AGENT_MODEL = 'openai/gpt-5.6-terra'
const MAX_AGENT_MESSAGE_LENGTH = 2000
const MAX_REFERENCE_ITEMS = 200
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

function isShortString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isAgentAccount(value: unknown): value is MoneyAgentAccount {
  return isRecord(value) && isShortString(value.id, 64) && isShortString(value.name, 80)
}

function isAgentCategory(value: unknown): value is ImageAnalysisCategory {
  return isRecord(value) && isShortString(value.id, 64) && isShortString(value.name, 80) &&
    (value.kind === 'income' || value.kind === 'expense')
}

function parseAgentRequest(value: unknown): MoneyAgentRequest | null {
  if (!isRecord(value)) return null
  if (typeof value.message !== 'string' || value.message.length > MAX_AGENT_MESSAGE_LENGTH) return null
  if (typeof value.today !== 'string' || !isDateString(value.today)) return null
  if (!Array.isArray(value.accounts) || value.accounts.length > MAX_REFERENCE_ITEMS || !value.accounts.every(isAgentAccount)) return null
  if (!Array.isArray(value.categories) || value.categories.length > MAX_REFERENCE_ITEMS || !value.categories.every(isAgentCategory)) return null
  let image: MoneyAgentRequest['image']
  if (value.image !== undefined) {
    if (!isRecord(value.image) || typeof value.image.base64 !== 'string' || typeof value.image.mimeType !== 'string') return null
    image = { base64: value.image.base64, mimeType: value.image.mimeType }
  }
  return { message: value.message, image, today: value.today, accounts: value.accounts, categories: value.categories }
}

/** The phone sends its own accounts and categories, so a category it created offline is still a valid choice. */
export async function runMoneyAgentRequest(request: Request, env: Env): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return failure(503, 'NOT_CONFIGURED', 'The money agent is not set up on the server')
  let body: unknown
  try { body = await request.json() } catch { return failure(400, 'INVALID_REQUEST', 'The request body is not valid JSON') }
  const input = parseAgentRequest(body)
  if (!input) return failure(400, 'INVALID_REQUEST', 'Check the message, accounts, and categories')
  const result = await runMoneyAgent({
    ...input,
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL?.trim() || DEFAULT_AGENT_MODEL
  }, fetch)
  if (!result.ok) {
    return result.reason === 'unauthorized'
      ? failure(502, 'UPSTREAM_ERROR', 'OpenRouter rejected the server key. Replace OPENROUTER_API_KEY on the Worker.')
      : failure(502, 'UPSTREAM_ERROR', result.message)
  }
  const data: MoneyAgentResponse = { drafts: result.data }
  return ok(data)
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
