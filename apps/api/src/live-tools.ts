import {
  LIVE_TOOL_REGISTRY,
  isLiveToolName,
  validateLiveToolArguments,
  type LiveToolName
} from '@ego/core'
import type {
  DeviceIdentity,
  LiveToolExecuteRequest,
  LiveToolExecuteResult,
  LiveLocalToolAuditRequest
} from '@ego/api-contracts'
import type { TransactionInput } from '@ego/core'
import type { Env } from './auth'
import { googleAccessToken } from './connectors'
import { applyOperation } from './commands'
import {
  query,
  readBalances,
  readReference,
  readSummary,
  readTransactionDetail,
  readTransactionPage
} from './reads'

interface SessionRow {
  openai_session_id: string
  device_id: string
  dataset_id: string
  enabled_tools: string
  expires_at: string
}

interface CallRow {
  tool_name: string
  approval_result: 'not_required' | 'approved' | 'rejected'
  outcome: 'succeeded' | 'rejected' | 'failed'
}

const MAX_TOOL_CALLS_PER_MINUTE = 60

async function toolRateLimited(env: Env, sessionId: string, now: string): Promise<boolean> {
  const minuteAgo = new Date(new Date(now).getTime() - 60_000).toISOString()
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM live_tool_calls
    WHERE openai_session_id = ? AND created_at >= ?`).bind(sessionId, minuteAgo).first<{ count: number }>()
  return (row?.count ?? 0) >= MAX_TOOL_CALLS_PER_MINUTE
}

function response(result: LiveToolExecuteResult, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data: result }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseExecuteRequest(value: unknown): LiveToolExecuteRequest | null {
  if (!isRecord(value)) return null
  const allowed = new Set(['sessionId', 'callId', 'toolName', 'arguments', 'approved'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (typeof value.sessionId !== 'string' || value.sessionId.length < 1 || value.sessionId.length > 200) return null
  if (typeof value.callId !== 'string' || value.callId.length < 1 || value.callId.length > 200) return null
  if (!isLiveToolName(value.toolName)) return null
  if (value.approved !== undefined && typeof value.approved !== 'boolean') return null
  return value as unknown as LiveToolExecuteRequest
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

function trimResult(name: LiveToolName, data: unknown): unknown {
  const maximum = LIVE_TOOL_REGISTRY[name].maxResultBytes
  const encoded = JSON.stringify(data)
  if (new TextEncoder().encode(encoded).byteLength <= maximum) return data
  return { truncated: true, message: 'The result was too large. Ask a narrower question.' }
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function decodeBase64Url(value: string): string {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

function messageBody(part: GmailPart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) {
    const text = messageBody(child)
    if (text) return text
  }
  if (part.body?.data) {
    return decodeBase64Url(part.body.data).replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
  }
  return ''
}

async function gmailJson(accessToken: string, path: string): Promise<unknown> {
  const result = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  })
  if (!result.ok) throw new Error('Gmail request failed')
  return result.json()
}

async function executeGmail(
  env: Env,
  datasetId: string,
  name: 'gmail_search' | 'gmail_read',
  args: Record<string, unknown>
): Promise<unknown> {
  const accessToken = await googleAccessToken(env, datasetId)
  if (!accessToken) throw new Error('Google is not connected')
  if (name === 'gmail_search') {
    const maximum = Number(args.maxResults ?? 5)
    const listing = await gmailJson(accessToken,
      `messages?q=${encodeURIComponent(String(args.query))}&maxResults=${maximum}`) as { messages?: Array<{ id?: string }> }
    const messages = await Promise.all((listing.messages ?? []).slice(0, maximum).map(async ({ id }) => {
      if (!id) return null
      const item = await gmailJson(accessToken,
        `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`) as {
        id?: string
        snippet?: string
        payload?: { headers?: Array<{ name?: string; value?: string }> }
      }
      const headers = item.payload?.headers
      return {
        id: item.id,
        from: header(headers, 'From'),
        to: header(headers, 'To'),
        subject: header(headers, 'Subject'),
        date: header(headers, 'Date'),
        snippet: (item.snippet ?? '').slice(0, 500)
      }
    }))
    return { messages: messages.filter(Boolean) }
  }
  const item = await gmailJson(accessToken, `messages/${encodeURIComponent(String(args.messageId))}?format=full`) as {
    id?: string
    snippet?: string
    payload?: GmailPart & { headers?: Array<{ name?: string; value?: string }> }
  }
  const headers = item.payload?.headers
  return {
    id: item.id,
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    subject: header(headers, 'Subject'),
    date: header(headers, 'Date'),
    body: messageBody(item.payload).replace(/\s+/g, ' ').trim().slice(0, 24_000),
    truncated: messageBody(item.payload).length > 24_000
  }
}

async function executeEgo(
  env: Env,
  name: Exclude<LiveToolName, 'gmail_search' | 'gmail_read' | 'trello_create_card'>,
  args: Record<string, unknown>,
  callId: string,
  now: string
): Promise<unknown> {
  if (name === 'ego_get_summary') {
    return readSummary(env.DB, args.from as string | undefined ?? null, args.to as string | undefined ?? null)
  }
  if (name === 'ego_list_accounts') {
    const [reference, balances] = await Promise.all([readReference(env.DB), readBalances(env.DB)])
    return {
      accounts: reference.accounts.map((account) => ({
        ...account,
        balanceCents: balances.balances.find((balance) => balance.accountId === account.id)?.balanceCents ?? account.openingBalanceCents
      }))
    }
  }
  if (name === 'ego_get_budget') {
    const budgets = await query<Record<string, unknown>>(env.DB,
      `SELECT b.id, b.month, b.planned_income_cents, b.created_at, b.updated_at, b.revision
       FROM budgets b WHERE b.month = ? AND b.deleted_at IS NULL`, [args.month])
    const budget = budgets[0]
    if (!budget) return { budget: null }
    const allocations = await query<Record<string, unknown>>(env.DB,
      `SELECT ba.category_id, c.name AS category_name, ba.amount_cents
       FROM budget_allocations ba JOIN categories c ON c.id = ba.category_id
       WHERE ba.budget_id = ? ORDER BY c.name COLLATE NOCASE`, [budget.id])
    return { budget, allocations }
  }
  if (name === 'ego_search_transactions') {
    return readTransactionPage(env.DB, {
      from: args.from as string | undefined ?? null,
      to: args.to as string | undefined ?? null,
      kinds: args.kind ? [args.kind as 'income' | 'expense' | 'transfer'] : [],
      accountIds: args.accountId ? [String(args.accountId)] : [],
      categoryIds: args.categoryId ? [String(args.categoryId)] : [],
      search: typeof args.query === 'string' ? args.query : ''
    }, null, Number(args.limit ?? 10))
  }
  if (name === 'ego_get_transaction') return readTransactionDetail(env.DB, String(args.transactionId))
  const notes = [args.merchant, args.notes].filter((item) => typeof item === 'string' && item.trim()).join(' | ')
  const input: TransactionInput = {
    kind: args.kind as TransactionInput['kind'],
    accountId: String(args.accountId),
    destinationAccountId: typeof args.destinationAccountId === 'string' ? args.destinationAccountId : null,
    categoryId: typeof args.categoryId === 'string' ? args.categoryId : null,
    amountCents: Number(args.amountCents),
    date: String(args.date),
    notes
  }
  const result = await applyOperation(env.DB, {
    operationId: callId,
    entityId: `live-${callId}`,
    expectedRevision: null,
    createdAt: now,
    command: { entity: 'transaction', type: 'create', payload: input }
  }, now)
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

async function runTool(
  env: Env,
  datasetId: string,
  name: LiveToolName,
  args: Record<string, unknown>,
  callId: string,
  now: string
): Promise<unknown> {
  if (name === 'gmail_search' || name === 'gmail_read') return executeGmail(env, datasetId, name, args)
  if (name === 'trello_create_card') throw new Error('Trello cards run on the connected desktop')
  return executeEgo(env, name, args, callId, now)
}

export async function executeLiveTool(
  request: Request,
  env: Env,
  device: DeviceIdentity,
  now = new Date().toISOString()
): Promise<Response> {
  let body: unknown
  try { body = await request.json() } catch { return failure(400, 'INVALID_REQUEST', 'The request body is not valid JSON') }
  const input = parseExecuteRequest(body)
  if (!input) return failure(400, 'INVALID_REQUEST', 'Check the tool request')
  const session = await env.DB.prepare(`SELECT openai_session_id, device_id, dataset_id, enabled_tools, expires_at
    FROM live_tool_sessions WHERE openai_session_id = ?`)
    .bind(input.sessionId).first<SessionRow>()
  if (!session || session.device_id !== device.deviceId || session.dataset_id !== device.datasetId || session.expires_at <= now) {
    return failure(403, 'TOOL_SESSION_DENIED', 'That tool session is unavailable')
  }
  const enabledTools = safeJsonArray(session.enabled_tools)
  if (!enabledTools.includes(input.toolName)) return failure(403, 'TOOL_DISABLED', 'That tool is not enabled')
  const validated = validateLiveToolArguments(input.toolName, input.arguments)
  if (!validated.ok) return failure(400, 'INVALID_TOOL_ARGUMENTS', validated.error)
  const definition = LIVE_TOOL_REGISTRY[input.toolName]
  const existing = await env.DB.prepare(`SELECT tool_name, approval_result, outcome
    FROM live_tool_calls WHERE call_id = ?`).bind(input.callId).first<CallRow>()
  if (existing) {
    if (existing.tool_name !== input.toolName) return failure(409, 'CALL_ID_REUSED', 'That call ID belongs to another tool')
    return response({
      callId: input.callId,
      toolName: input.toolName,
      outcome: existing.outcome,
      duplicate: true,
      data: { message: 'This call was already handled.' }
    })
  }
  if (await toolRateLimited(env, input.sessionId, now)) {
    return failure(429, 'RATE_LIMITED', 'Too many tool calls. Try again shortly.')
  }
  if (definition.confirmationRequired && input.approved === undefined) {
    return failure(409, 'CONFIRMATION_REQUIRED', 'Confirm or reject this action on screen')
  }
  const approval = definition.confirmationRequired
    ? input.approved ? 'approved' : 'rejected'
    : 'not_required'
  const initialOutcome = approval === 'rejected' ? 'rejected' : 'failed'
  try {
    await env.DB.prepare(`INSERT INTO live_tool_calls
      (call_id, openai_session_id, tool_name, approval_result, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(input.callId, input.sessionId, input.toolName, approval, initialOutcome, now).run()
  } catch {
    const duplicate = await env.DB.prepare('SELECT tool_name, approval_result, outcome FROM live_tool_calls WHERE call_id = ?')
      .bind(input.callId).first<CallRow>()
    if (duplicate?.tool_name === input.toolName) {
      return response({ callId: input.callId, toolName: input.toolName, outcome: duplicate.outcome, duplicate: true })
    }
    return failure(409, 'CALL_ID_REUSED', 'That call ID cannot be used')
  }
  if (approval === 'rejected') {
    return response({
      callId: input.callId,
      toolName: input.toolName,
      outcome: 'rejected',
      duplicate: false,
      data: { rejected: true }
    })
  }
  try {
    const data = trimResult(input.toolName,
      await runTool(env, device.datasetId, input.toolName, validated.value, input.callId, now))
    await env.DB.prepare(`UPDATE live_tool_calls SET outcome = 'succeeded' WHERE call_id = ?`).bind(input.callId).run()
    return response({
      callId: input.callId,
      toolName: input.toolName,
      outcome: 'succeeded',
      duplicate: false,
      data
    })
  } catch {
    return response({
      callId: input.callId,
      toolName: input.toolName,
      outcome: 'failed',
      duplicate: false,
      error: { code: 'TOOL_FAILED', message: 'The tool could not complete that request' }
    })
  }
}

export async function auditLocalLiveTool(
  request: Request,
  env: Env,
  device: DeviceIdentity,
  now = new Date().toISOString()
): Promise<Response> {
  let value: unknown
  try { value = await request.json() } catch { return failure(400, 'INVALID_REQUEST', 'The request body is not valid JSON') }
  if (!isRecord(value) || Object.keys(value).some((key) => !['sessionId', 'callId', 'toolName', 'phase', 'approved', 'outcome'].includes(key))) {
    return failure(400, 'INVALID_REQUEST', 'Check the local tool audit request')
  }
  const input = value as unknown as LiveLocalToolAuditRequest
  if (typeof input.sessionId !== 'string' || typeof input.callId !== 'string' ||
      input.toolName !== 'trello_create_card' || !['start', 'complete'].includes(input.phase) ||
      typeof input.approved !== 'boolean' ||
      (input.outcome !== undefined && !['succeeded', 'rejected', 'failed'].includes(input.outcome))) {
    return failure(400, 'INVALID_REQUEST', 'Check the local tool audit request')
  }
  const session = await env.DB.prepare(`SELECT openai_session_id, device_id, dataset_id, enabled_tools, expires_at
    FROM live_tool_sessions WHERE openai_session_id = ?`).bind(input.sessionId).first<SessionRow>()
  if (!session || session.device_id !== device.deviceId || session.dataset_id !== device.datasetId ||
      session.expires_at <= now || !safeJsonArray(session.enabled_tools).includes(input.toolName)) {
    return failure(403, 'TOOL_SESSION_DENIED', 'That tool session is unavailable')
  }
  const existing = await env.DB.prepare(`SELECT tool_name, approval_result, outcome
    FROM live_tool_calls WHERE call_id = ?`).bind(input.callId).first<CallRow>()
  if (input.phase === 'start') {
    if (existing) {
      if (existing.tool_name !== input.toolName) return failure(409, 'CALL_ID_REUSED', 'That call ID belongs to another tool')
      return response({
        callId: input.callId, toolName: input.toolName, outcome: existing.outcome,
        duplicate: true, data: { authorized: false }
      })
    }
    if (await toolRateLimited(env, input.sessionId, now)) {
      return failure(429, 'RATE_LIMITED', 'Too many tool calls. Try again shortly.')
    }
    const outcome = input.approved ? 'failed' : 'rejected'
    await env.DB.prepare(`INSERT INTO live_tool_calls
      (call_id, openai_session_id, tool_name, approval_result, outcome, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(input.callId, input.sessionId, input.toolName, input.approved ? 'approved' : 'rejected', outcome, now).run()
    return response({
      callId: input.callId, toolName: input.toolName, outcome, duplicate: false,
      data: { authorized: input.approved }
    })
  }
  if (!existing || existing.tool_name !== input.toolName || existing.approval_result !== 'approved' || !input.outcome) {
    return failure(409, 'LOCAL_TOOL_NOT_STARTED', 'That local tool call was not authorized')
  }
  await env.DB.prepare('UPDATE live_tool_calls SET outcome = ? WHERE call_id = ?')
    .bind(input.outcome, input.callId).run()
  return response({
    callId: input.callId, toolName: input.toolName, outcome: input.outcome,
    duplicate: false, data: { recorded: true }
  })
}
