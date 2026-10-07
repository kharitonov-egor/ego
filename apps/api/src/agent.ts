import {
  AGENT_KEY_NAME_MAX, AGENT_KEY_PREFIX, HTTP_STATUS, MCP_PATH, isAgentMemoryInput,
  type AgentKeyCreated, type AgentKeyList, type AgentKeySummary, type AgentMemoryList, type ApiError, type DeviceIdentity
} from '@ego/api-contracts'
import { hashToken, type Env } from './auth'
import { MemoryError, addMemory, forgetMemory, listMemories, updateMemory } from './memory'
import { query } from './reads'

interface KeyRow {
  id: string
  name: string
  created_at: string
  last_used_at: string | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

function failure(code: ApiError['code'], message: string): Response {
  return json({ ok: false, error: { code, message } }, HTTP_STATUS[code])
}

async function readJson(request: Request): Promise<unknown> {
  try { return await request.json() } catch { return null }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function mcpUrl(request: Request, env: Env): string {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? new URL(request.url).origin
  return `${base}${MCP_PATH}`
}

function keyOf(row: KeyRow): AgentKeySummary {
  return { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at }
}

async function listKeys(request: Request, env: Env, datasetId: string): Promise<Response> {
  const rows = await query<KeyRow>(env.DB, `SELECT id, name, created_at, last_used_at FROM agent_keys
    WHERE dataset_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id`, [datasetId])
  const data: AgentKeyList = { keys: rows.map(keyOf), mcpUrl: mcpUrl(request, env) }
  return ok(data)
}

async function createKey(request: Request, env: Env, datasetId: string, now: string): Promise<Response> {
  const body = await readJson(request)
  const asked = typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string' ? body.name.trim() : ''
  if (asked.length > AGENT_KEY_NAME_MAX) return failure('INVALID_REQUEST', `A key name can be up to ${AGENT_KEY_NAME_MAX} characters`)
  const token = `${AGENT_KEY_PREFIX}${randomToken()}`
  const key: AgentKeySummary = { id: crypto.randomUUID(), name: asked || `Claude · ${now.slice(0, 10)}`, createdAt: now, lastUsedAt: null }
  await env.DB.prepare('INSERT INTO agent_keys (id, dataset_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(key.id, datasetId, key.name, await hashToken(token), now).run()
  const created: AgentKeyCreated = { key, token, mcpUrl: mcpUrl(request, env) }
  return ok(created)
}

async function revokeKey(env: Env, datasetId: string, keyId: string, now: string): Promise<Response> {
  const result = await env.DB.prepare('UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND dataset_id = ? AND revoked_at IS NULL')
    .bind(now, keyId, datasetId).run()
  return (result.meta.changes ?? 0) === 1 ? ok({ revoked: true }) : failure('NOT_FOUND', 'That key is already revoked')
}

async function memories(env: Env, datasetId: string): Promise<Response> {
  const data: AgentMemoryList = { memories: await listMemories(env.DB, datasetId) }
  return ok(data)
}

async function writeMemory(request: Request, env: Env, datasetId: string, id: string | null, now: string): Promise<Response> {
  const body = await readJson(request)
  if (!isAgentMemoryInput(body)) return failure('INVALID_REQUEST', 'A note needs text')
  try {
    if (id === null) return ok(await addMemory(env.DB, datasetId, body.text, 'user', now))
    const updated = await updateMemory(env.DB, datasetId, id, body.text, now)
    return updated ? ok(updated) : failure('NOT_FOUND', 'That note was deleted')
  } catch (error: unknown) {
    if (error instanceof MemoryError) return failure('INVALID_REQUEST', error.message)
    throw error
  }
}

async function deleteMemory(env: Env, datasetId: string, id: string, now: string): Promise<Response> {
  return await forgetMemory(env.DB, datasetId, id, now) ? ok({ deleted: true }) : failure('NOT_FOUND', 'That note was already deleted')
}

/** Settings > Agent and the Memory screen, for a signed-in device. Claude itself comes in through /mcp. */
export function agentRoute(request: Request, env: Env, device: DeviceIdentity, path: string, now: string): Promise<Response> | null {
  if (!path.startsWith('/v1/agent/')) return null
  const { method } = request
  const datasetId = device.datasetId
  if (path === '/v1/agent/keys') {
    if (method === 'GET') return listKeys(request, env, datasetId)
    if (method === 'POST') return createKey(request, env, datasetId, now)
  }
  if (method === 'DELETE' && path.startsWith('/v1/agent/keys/')) {
    return revokeKey(env, datasetId, decodeURIComponent(path.slice('/v1/agent/keys/'.length)), now)
  }
  if (path === '/v1/agent/memories') {
    if (method === 'GET') return memories(env, datasetId)
    if (method === 'POST') return writeMemory(request, env, datasetId, null, now)
  }
  if (path.startsWith('/v1/agent/memories/')) {
    const id = decodeURIComponent(path.slice('/v1/agent/memories/'.length))
    if (method === 'PUT') return writeMemory(request, env, datasetId, id, now)
    if (method === 'DELETE') return deleteMemory(env, datasetId, id, now)
  }
  return Promise.resolve(failure('NOT_FOUND', 'That endpoint does not exist'))
}
