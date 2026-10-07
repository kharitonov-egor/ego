import { eventMatches, isAgentTrigger, type AgentTrigger } from '@ego/core'
import type { ComposioStatus } from '@ego/api-contracts'
import { readAgentSettings, updateAgentSettings } from './agent-settings'
import type { Env } from './auth'
import { fireRoutine, queueRun } from './goals'
import { query } from './reads'

const BACKEND = 'https://backend.composio.dev/api'
const TIMEOUT_MS = 45_000
/** A tool result longer than this is cut, keeping the start, so the chat still sees most of it. */
const RESULT_CHARS = 24_000
/** Webhooks older than this are refused, so a captured one cannot be replayed later. */
const WEBHOOK_TOLERANCE_SECONDS = 300
const EVENT_CHARS = 4000
export const COMPOSIO_WEBHOOK_PATH = '/v1/composio/webhook'

/** Verbs in a Composio tool slug that only read. Anything else counts as a change and needs a card. */
const READ_VERBS = new Set([
  'GET', 'LIST', 'FETCH', 'SEARCH', 'FIND', 'READ', 'RETRIEVE', 'QUERY', 'DESCRIBE', 'LOOKUP', 'VIEW', 'DOWNLOAD', 'EXPORT', 'CHECK', 'COUNT'
])
const WRITE_VERBS = new Set([
  'SEND', 'CREATE', 'ADD', 'POST', 'UPDATE', 'EDIT', 'MODIFY', 'DELETE', 'REMOVE', 'TRASH', 'ARCHIVE', 'REPLY', 'FORWARD', 'MOVE', 'INSERT',
  'UPLOAD', 'SHARE', 'INVITE', 'PATCH', 'PUT', 'SET', 'RENAME', 'CANCEL', 'APPROVE', 'MERGE', 'CLOSE', 'PUBLISH', 'SCHEDULE', 'PAY', 'BUY', 'TRANSFER'
])

export class ComposioError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function composioConfigured(env: Env): boolean {
  return Boolean(env.COMPOSIO_API_KEY?.trim())
}

/** One Composio user per dataset, so the apps the user connects stay with their data. */
export function composioUserId(datasetId: string): string {
  return `ego-${datasetId}`
}

/** Whether an action only reads: a read verb, and no verb that changes something. */
export function readsOnly(slug: string): boolean {
  const words = slug.toUpperCase().split('_')
  if (words.some((word) => WRITE_VERBS.has(word))) return false
  return words.some((word) => READ_VERBS.has(word))
}

async function composio(env: Env, path: string, body: unknown): Promise<unknown> {
  const key = env.COMPOSIO_API_KEY?.trim()
  if (!key) throw new ComposioError('Add COMPOSIO_API_KEY on the Worker to reach your other apps')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${BACKEND}${path}`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch {
    throw new ComposioError('Composio could not be reached')
  } finally {
    clearTimeout(timer)
  }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = isRecord(data) && typeof data.message === 'string' ? data.message : `Composio answered HTTP ${response.status}`
    throw new ComposioError(message)
  }
  return data
}

/** The dataset's Tool Router session, made once and kept in the agent settings. */
async function sessionId(env: Env, datasetId: string, now: string, fresh = false): Promise<string> {
  const settings = await readAgentSettings(env.DB, datasetId)
  if (settings.composioSessionId && !fresh) return settings.composioSessionId
  const created = await composio(env, '/v3.1/tool_router/session', {
    user_id: composioUserId(datasetId),
    manage_connections: { enable: true },
    workbench: { enable: false }
  })
  const id = isRecord(created) && typeof created.session_id === 'string' ? created.session_id : null
  if (!id) throw new ComposioError('Composio did not start a session')
  await updateAgentSettings(env.DB, datasetId, now, (current) => ({ ...current, composioSessionId: id }))
  return id
}

function clip(data: unknown): unknown {
  const text = JSON.stringify(data ?? null)
  return text.length <= RESULT_CHARS ? data : { truncated: true, preview: text.slice(0, RESULT_CHARS) }
}

/** Runs one Composio meta tool in the dataset's session, starting a new session once if the old one is gone. */
export async function executeMeta(env: Env, datasetId: string, now: string, slug: string, args: Record<string, unknown>): Promise<unknown> {
  const run = async (id: string): Promise<unknown> => composio(env, `/v3.1/tool_router/session/${encodeURIComponent(id)}/execute_meta`, { slug, arguments: args })
  let result: unknown
  try {
    result = await run(await sessionId(env, datasetId, now))
  } catch (error: unknown) {
    if (!(error instanceof ComposioError) || !/session/i.test(error.message)) throw error
    result = await run(await sessionId(env, datasetId, now, true))
  }
  if (isRecord(result) && typeof result.error === 'string' && result.error) throw new ComposioError(result.error)
  return clip(isRecord(result) && 'data' in result ? result.data : result)
}

export function searchApps(env: Env, datasetId: string, now: string, task: string, knownFields: string | null): Promise<unknown> {
  return executeMeta(env, datasetId, now, 'COMPOSIO_SEARCH_TOOLS', {
    queries: [{ use_case: task, ...(knownFields ? { known_fields: knownFields } : {}) }],
    session: { generate_id: true }
  })
}

export function appSchemas(env: Env, datasetId: string, now: string, slugs: string[]): Promise<unknown> {
  return executeMeta(env, datasetId, now, 'COMPOSIO_GET_TOOL_SCHEMAS', { tool_slugs: slugs })
}

export function connectApp(env: Env, datasetId: string, now: string, app: string): Promise<unknown> {
  return executeMeta(env, datasetId, now, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: [{ name: app, action: 'add' }] })
}

export function runApp(env: Env, datasetId: string, now: string, slug: string, args: Record<string, unknown>): Promise<unknown> {
  return executeMeta(env, datasetId, now, 'COMPOSIO_MULTI_EXECUTE_TOOL', {
    tools: [{ tool_slug: slug, arguments: args }], sync_response_to_workbench: false
  })
}

/**
 * Turns on a Composio trigger for an event goal. Composio then posts each event to the webhook
 * subscription set up in its dashboard. A null result means it worked.
 */
export async function enableTrigger(env: Env, datasetId: string, trigger: AgentTrigger): Promise<string | null> {
  if (trigger.type !== 'event') return null
  if (!composioConfigured(env)) return 'Add COMPOSIO_API_KEY on the Worker so this goal can hear events'
  try {
    await composio(env, `/v3/trigger_instances/${encodeURIComponent(trigger.trigger)}/upsert`, {
      user_id: composioUserId(datasetId), trigger_config: {}
    })
    return null
  } catch (error: unknown) {
    return error instanceof Error ? `Composio did not turn the trigger on: ${error.message}` : 'Composio did not turn the trigger on'
  }
}

function base64(bytes: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

/** Checks Composio's HMAC-SHA256 over `id.timestamp.body` with the subscription secret, and the time. */
export async function verifyWebhook(secret: string, id: string, timestamp: string, signature: string, body: string, nowSeconds: number): Promise<boolean> {
  const sent = Number(timestamp)
  if (!id || !Number.isFinite(sent) || Math.abs(nowSeconds - sent) > WEBHOOK_TOLERANCE_SECONDS) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = base64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))
  return signature.split(' ').some((part) => sameText(part.includes(',') ? part.slice(part.indexOf(',') + 1) : part, expected))
}

interface GoalRow {
  id: string
  dataset_id: string
  trigger: string
}

export async function composioStatus(env: Env, request: Request): Promise<ComposioStatus> {
  const base = env.PUBLIC_BASE_URL?.replace(/\/+$/, '') ?? new URL(request.url).origin
  return {
    configured: composioConfigured(env),
    webhookReady: Boolean(env.COMPOSIO_WEBHOOK_SECRET?.trim()),
    webhookUrl: `${base}${COMPOSIO_WEBHOOK_PATH}`
  }
}

/**
 * A Composio trigger event: verified, seen once, then each matching event goal gets a run and
 * the routine wakes. The event's data rides on the run as untrusted text.
 */
export async function receiveComposioWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.COMPOSIO_WEBHOOK_SECRET?.trim()
  if (!secret) return new Response(null, { status: 503 })
  const body = await request.text()
  const id = request.headers.get('webhook-id') ?? ''
  const valid = await verifyWebhook(secret, id, request.headers.get('webhook-timestamp') ?? '', request.headers.get('webhook-signature') ?? '', body, Math.floor(Date.now() / 1000))
  if (!valid) return new Response(null, { status: 401 })
  let payload: unknown
  try { payload = JSON.parse(body) } catch { return new Response(null, { status: 400 }) }
  if (!isRecord(payload) || payload.type !== 'composio.trigger.message' || !isRecord(payload.metadata)) return new Response(null, { status: 204 })
  const slug = typeof payload.metadata.trigger_slug === 'string' ? payload.metadata.trigger_slug.toUpperCase() : ''
  const user = typeof payload.metadata.user_id === 'string' ? payload.metadata.user_id : ''
  if (!slug || !user.startsWith('ego-')) return new Response(null, { status: 204 })
  const datasetId = user.slice('ego-'.length)
  const now = new Date().toISOString()
  const seen = await env.DB.prepare('INSERT OR IGNORE INTO agent_events (id, dataset_id, trigger_slug, received_at) VALUES (?, ?, ?, ?)')
    .bind(id, datasetId, slug, now).run()
  if ((seen.meta.changes ?? 0) === 0) return new Response(null, { status: 204 })
  const event = JSON.stringify({ trigger: slug, data: payload.data ?? null }).slice(0, EVENT_CHARS)
  const goals = await query<GoalRow>(env.DB, `SELECT id, dataset_id, trigger FROM agent_goals
    WHERE dataset_id = ? AND status = 'active' AND deleted_at IS NULL`, [datasetId])
  let queued = 0
  for (const goal of goals) {
    let trigger: unknown
    try { trigger = JSON.parse(goal.trigger) } catch { continue }
    if (!isAgentTrigger(trigger) || !eventMatches(trigger, slug, event)) continue
    await queueRun(env.DB, goal, 'event', now, { event })
    queued += 1
  }
  if (queued > 0) await fireRoutine(env, datasetId, now)
  return new Response(null, { status: 204 })
}
