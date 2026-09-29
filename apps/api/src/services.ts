import { MAX_TRELLO_ATTACHMENT_BYTES, type TrelloCardResponse } from '@ego/api-contracts'
import { createTrelloClient, type TrelloClient } from '@ego/core'
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
