import { HTTP_STATUS, type ApiErrorCode } from '@ego/api-contracts'
import { isContentItemInput, cleanContentItem } from '@ego/core'
import { authorize, bearer, currentDataset, hashToken, touchDevice, type Env } from './auth'
import { applyOperation } from './commands'
import { readContent } from './content-records'
import { previewBase, renderContentPreviews } from './content-previews'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
function fail(code: ApiErrorCode, message: string): Response { return json({ ok: false, error: { code, message } }, HTTP_STATUS[code]) }
const ok = (data: unknown) => json({ ok: true, data })
interface KeyRow { id: string; name: string; created_at: string; dataset_id: string }
export async function contentRoute(request: Request, env: Env, path: string, work?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  const token = bearer(request)
  const now = new Date().toISOString()
  const isKey = token?.startsWith('egoct_') ?? false
  let datasetId: string
  if (isKey) {
    const key = await env.DB.prepare('SELECT * FROM content_keys WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(await hashToken(token!)).first<KeyRow>()
    if (!key || key.dataset_id !== currentDataset(env)) return fail('AUTH_REQUIRED', 'Reconnect the extension from Content settings')
    datasetId = key.dataset_id
  } else {
    const auth = await authorize(request, env.DB)
    if (!auth.ok) return json(auth, HTTP_STATUS[auth.error.code])
    datasetId = auth.data.datasetId
    await touchDevice(env.DB, auth.data.deviceId, now)
  }
  if (path === '/v1/content/library' && request.method === 'GET') return ok(await readContent(env.DB))
  if (path === '/v1/content/capture' && request.method === 'POST') {
    const raw = await request.text()
    if (raw.length > 40000) return fail('INVALID_REQUEST', 'This bookmark is too large')
    let body: unknown
    try { body = JSON.parse(raw) } catch { return fail('INVALID_REQUEST', 'Invalid bookmark') }
    if (typeof body !== 'object' || body === null || !('item' in body) || !isContentItemInput(body.item) ||
      !('id' in body) || typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(body.id)) return fail('INVALID_REQUEST', 'Invalid bookmark')
    const item = cleanContentItem(body.item)
    const result = await applyOperation(env.DB, {
      operationId: `capture-${body.id}`, entityId: body.id, expectedRevision: null, createdAt: now,
      command: { entity: 'contentItem', type: 'create', payload: item }
    }, now)
    if (result.ok && !item.coverUrl) work?.waitUntil(renderContentPreviews(env, previewBase(env, request), 1).catch(() => undefined))
    return result.ok ? ok({ id: body.id }) : json(result, HTTP_STATUS[result.error.code])
  }
  if (isKey) return fail('AUTH_REQUIRED', 'This key only reads Content and saves bookmarks')
  if (path === '/v1/content/keys' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id, name, created_at FROM content_keys WHERE dataset_id = ? AND revoked_at IS NULL ORDER BY created_at DESC').bind(datasetId).all<KeyRow>()
    return ok({ keys: rows.results.map(row => ({ id: row.id, name: row.name, createdAt: row.created_at })) })
  }
  if (path === '/v1/content/keys' && request.method === 'POST') {
    const id = crypto.randomUUID()
    const token = 'egoct_' + [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    await env.DB.prepare('INSERT INTO content_keys (id, token_hash, name, dataset_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, await hashToken(token), 'Chrome extension', datasetId, now).run()
    return ok({ key: { id, name: 'Chrome extension', createdAt: now }, token })
  }
  if (path === '/v1/content/previews' && request.method === 'POST') return ok(await renderContentPreviews(env, previewBase(env, request), 4))
  const match = /^\/v1\/content\/keys\/([a-zA-Z0-9-]+)$/.exec(path)
  if (match && request.method === 'DELETE') {
    await env.DB.prepare('UPDATE content_keys SET revoked_at = ? WHERE id = ? AND dataset_id = ?').bind(now, match[1], datasetId).run()
    return ok({ revoked: true })
  }
  return fail('NOT_FOUND', 'Content endpoint not found')
}
