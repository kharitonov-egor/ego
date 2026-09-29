import {
  ASSISTANT_TOOLS, DEFAULT_ASSISTANT_MODEL, MAX_TRANSACTION_IMAGE_BYTES, TRANSACTION_IMAGE_MIME_TYPES, isDateString, runAssistant,
  type AssistantCall, type AssistantToolName, type ModelMessage, type ModelToolCall, type PendingWrite, type ToolOutcome
} from '@ego/core'
import {
  ASSISTANT_HISTORY_LIMIT, ASSISTANT_TEXT_LIMIT,
  type ApiError, type AssistantChat, type AssistantChatList, type AssistantHistory, type AssistantImage, type AssistantMessage,
  type AssistantPendingWrite, type AssistantStreamEvent, type AssistantUndoResponse, type AssistantUnits, type DeviceIdentity
} from '@ego/api-contracts'
import type { Env } from './auth'
import { query } from './reads'
import {
  assistantSystemPrompt, describeWrite, executeAssistantRead, executeAssistantWrite, undoAssistantWrite,
  type ToolContext, type UndoPlan, type WriteOutcome
} from './assistant-tools'

const MAX_TURNS_PER_MINUTE = 30
/** Under the phone's streaming timeout, with room for the last tool call to finish. */
const TURN_BUDGET_MS = 110_000
const MAX_CHATS = 50
const WINDOW_ROWS = 60
const WINDOW_CHARS = 80_000
const TITLE_LENGTH = 60
const MAX_TIME_ZONE_LENGTH = 64
const IMAGE_NOTE = '(The user attached a receipt image. Ego read it once and did not keep it.)'

interface ChatRow {
  id: string
  dataset_id: string
  title: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface MessageRow {
  id: string
  chat_id: string
  seq: number
  role: 'user' | 'assistant' | 'tool'
  shown: number
  text: string
  payload: string
  trail: string
  has_image: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

interface CallRow {
  call_id: string
  chat_id: string
  message_id: string | null
  tool_call_id: string
  tool_name: string
  arguments: string
  status: 'pending' | 'succeeded' | 'failed' | 'rejected' | 'undone'
  label: string | null
  undo: string | null
  card: string | null
  created_at: string
  resolved_at: string | null
}

interface TurnInput {
  chatId: string | null
  text: string
  image: AssistantImage | null
  today: string
  timeZone: string | null
  units: AssistantUnits
}

interface ConfirmInput {
  chatId: string
  callId: string
  approved: boolean
  today: string
  timeZone: string | null
  units: AssistantUnits
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  })
}

function failure(status: number, error: ApiError): Response {
  return json({ ok: false, error }, status)
}

function ok<T>(data: T): Response {
  return json({ ok: true, data })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function stringList(raw: string): string[] {
  const value = parseJson<unknown>(raw, [])
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isUnits(value: unknown): value is AssistantUnits {
  return value === 'imperial' || value === 'metric'
}

function isImage(value: unknown): value is AssistantImage {
  if (!isRecord(value) || typeof value.base64 !== 'string' || typeof value.mimeType !== 'string') return false
  if (!(TRANSACTION_IMAGE_MIME_TYPES as readonly string[]).includes(value.mimeType)) return false
  const encoded = value.base64.replace(/[\r\n]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false
  return encoded.length * 0.75 <= MAX_TRANSACTION_IMAGE_BYTES
}

function timeZoneFrom(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TIME_ZONE_LENGTH ? value : null
}

function parseTurn(value: unknown): TurnInput | null {
  if (!isRecord(value)) return null
  if (value.chatId !== null && (typeof value.chatId !== 'string' || value.chatId.length > 64)) return null
  if (typeof value.text !== 'string' || value.text.length > ASSISTANT_TEXT_LIMIT) return null
  if (value.image !== undefined && !isImage(value.image)) return null
  if (!value.text.trim() && value.image === undefined) return null
  if (typeof value.today !== 'string' || !isDateString(value.today)) return null
  return {
    chatId: value.chatId,
    text: value.text,
    image: value.image === undefined ? null : value.image,
    today: value.today,
    timeZone: timeZoneFrom(value.timeZone),
    units: isUnits(value.units) ? value.units : 'imperial'
  }
}

function parseConfirm(value: unknown): ConfirmInput | null {
  if (!isRecord(value)) return null
  if (typeof value.chatId !== 'string' || typeof value.callId !== 'string' || typeof value.approved !== 'boolean') return null
  if (typeof value.today !== 'string' || !isDateString(value.today)) return null
  return {
    chatId: value.chatId, callId: value.callId, approved: value.approved, today: value.today,
    timeZone: timeZoneFrom(value.timeZone), units: isUnits(value.units) ? value.units : 'imperial'
  }
}

function toChat(row: ChatRow): AssistantChat {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at }
}

function toMessage(row: MessageRow, calls: readonly CallRow[]): AssistantMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    seq: row.seq,
    role: row.role === 'user' ? 'user' : 'assistant',
    text: row.text,
    createdAt: row.created_at,
    trail: stringList(row.trail),
    hasImage: row.has_image === 1,
    undo: calls
      .filter((call) => call.message_id === row.id && call.status === 'succeeded' && call.undo !== null && call.label !== null)
      .map((call) => ({ callId: call.call_id, label: call.label ?? '' }))
  }
}

function toPending(row: CallRow): AssistantPendingWrite {
  const card = parseJson<{ title?: string; lines?: string[] }>(row.card, {})
  return {
    callId: row.call_id,
    chatId: row.chat_id,
    toolName: row.tool_name as AssistantToolName,
    title: card.title ?? 'Confirm this change?',
    lines: Array.isArray(card.lines) ? card.lines.filter((line): line is string => typeof line === 'string') : []
  }
}

async function chatFor(env: Env, datasetId: string, id: string): Promise<ChatRow | null> {
  const rows = await query<ChatRow>(env.DB, 'SELECT * FROM assistant_chats WHERE id = ? AND dataset_id = ? AND deleted_at IS NULL', [id, datasetId])
  return rows[0] ?? null
}

async function undoableCalls(env: Env, chatId: string): Promise<CallRow[]> {
  return query<CallRow>(env.DB, `SELECT * FROM assistant_tool_calls WHERE chat_id = ? AND status = 'succeeded' AND undo IS NOT NULL`, [chatId])
}

async function pendingFor(env: Env, chatId: string): Promise<CallRow | null> {
  const rows = await query<CallRow>(env.DB, `SELECT * FROM assistant_tool_calls WHERE chat_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`, [chatId])
  return rows[0] ?? null
}

async function insertMessage(env: Env, chatId: string, role: MessageRow['role'], payload: ModelMessage, now: string, options: {
  shown?: boolean
  text?: string
  trail?: string[]
  hasImage?: boolean
} = {}): Promise<MessageRow> {
  const id = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO assistant_messages (id, chat_id, seq, role, shown, text, payload, trail, has_image, created_at)
    SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ? FROM assistant_messages WHERE chat_id = ?`)
    .bind(id, chatId, role, options.shown ? 1 : 0, options.text ?? '', JSON.stringify(payload), JSON.stringify(options.trail ?? []),
      options.hasImage ? 1 : 0, now, chatId)
    .run()
  const rows = await query<MessageRow>(env.DB, 'SELECT * FROM assistant_messages WHERE id = ?', [id])
  const row = rows[0]
  if (!row) throw new Error('The message was not stored')
  return row
}

function parseMessage(row: MessageRow): ModelMessage | null {
  const value = parseJson<unknown>(row.payload, null)
  return isRecord(value) && typeof value.role === 'string' ? value as ModelMessage : null
}

/**
 * The recent part of the chat in the shape the model reads: starts at a user message, stays under
 * a size budget, and closes any tool call that never got its result, so a turn cut short by a
 * dropped connection cannot break the next one.
 */
async function contextFor(env: Env, chatId: string): Promise<ModelMessage[]> {
  const rows = await query<MessageRow>(env.DB, 'SELECT * FROM assistant_messages WHERE chat_id = ? ORDER BY seq DESC LIMIT ?', [chatId, WINDOW_ROWS])
  let messages = rows.reverse().map(parseMessage).filter((message): message is ModelMessage => message !== null)
  let size = messages.reduce((total, message) => total + JSON.stringify(message).length, 0)
  while (messages.length > 1 && size > WINDOW_CHARS) {
    size -= JSON.stringify(messages[0]).length
    messages = messages.slice(1)
  }
  const start = messages.findIndex((message) => message.role === 'user')
  messages = start > 0 ? messages.slice(start) : start < 0 ? [] : messages
  const closed: ModelMessage[] = []
  let open: string[] = []
  const flush = (): void => {
    for (const id of open) closed.push({ role: 'tool', tool_call_id: id, content: JSON.stringify({ error: 'This step was interrupted' }) })
    open = []
  }
  for (const message of messages) {
    if (message.role === 'tool') {
      open = open.filter((id) => id !== message.tool_call_id)
      closed.push(message)
      continue
    }
    flush()
    closed.push(message)
    if (message.role === 'assistant') open = (message.tool_calls ?? []).map((call: ModelToolCall) => call.id)
  }
  flush()
  return closed
}

function ndjson(): { response: Response; emit: (event: AssistantStreamEvent) => Promise<void>; close: () => Promise<void> } {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  return {
    response: new Response(readable, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
    }),
    emit: (event) => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => undefined),
    close: () => writer.close().catch(() => undefined)
  }
}

interface RunInput {
  env: Env
  device: DeviceIdentity
  chat: ChatRow
  ctx: ToolContext
  timeZone: string | null
  history: ModelMessage[]
  /** Tool calls from before this run that belong under its reply, like a confirmed write. */
  earlierCallIds: string[]
  earlierTrail: string[]
  emit: (event: AssistantStreamEvent) => Promise<void>
}

async function recordCall(env: Env, chat: ChatRow, call: AssistantCall, outcome: WriteOutcome | null, status: CallRow['status'], now: string): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO assistant_tool_calls
    (call_id, chat_id, message_id, tool_call_id, tool_name, arguments, status, label, undo, card, created_at, resolved_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
    .bind(id, chat.id, call.callId, call.name, JSON.stringify(call.args), status,
      outcome?.label ?? null, outcome?.undo ? JSON.stringify(outcome.undo) : null, now, status === 'pending' ? null : now)
    .run()
  return id
}

/** Runs the model over the chat and streams what happens. Every stored message lands as it is made. */
async function runTurn(input: RunInput): Promise<void> {
  const { env, chat, ctx, emit } = input
  const callIds = [...input.earlierCallIds]
  const trail = [...input.earlierTrail]
  const last: { assistant: MessageRow | null } = { assistant: null }
  const result = await runAssistant({
    fetcher: (url, init) => fetch(url, init),
    apiKey: env.OPENROUTER_API_KEY ?? '',
    model: env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL,
    system: await assistantSystemPrompt(ctx, input.timeZone),
    history: input.history,
    deadline: Date.now() + TURN_BUDGET_MS,
    run: async (call): Promise<ToolOutcome> => {
      if (ASSISTANT_TOOLS[call.name].access === 'read') {
        try {
          const outcome = await executeAssistantRead(ctx, call)
          callIds.push(await recordCall(env, chat, call, null, 'succeeded', ctx.now))
          return outcome
        } catch (error: unknown) {
          callIds.push(await recordCall(env, chat, call, null, 'failed', ctx.now))
          throw error
        }
      }
      let outcome: WriteOutcome
      try {
        outcome = await executeAssistantWrite(ctx, call)
      } catch (error: unknown) {
        callIds.push(await recordCall(env, chat, call, null, 'failed', ctx.now))
        throw error
      }
      callIds.push(await recordCall(env, chat, call, outcome, outcome.failed ? 'failed' : 'succeeded', ctx.now))
      return outcome
    },
    onEvent: async (event) => {
      if (event.type === 'delta') {
        await emit({ type: 'delta', text: event.text })
      } else if (event.type === 'trail') {
        trail.push(event.line)
        await emit({ type: 'trail', line: event.line })
      } else {
        const row = await insertMessage(env, chat.id, event.message.role === 'tool' ? 'tool' : 'assistant', event.message, ctx.now)
        if (event.message.role === 'assistant') last.assistant = row
      }
    }
  })
  const shown = last.assistant
  if (!result.ok) {
    await emit({ type: 'error', error: { code: result.reason === 'rate_limited' ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', message: result.message } })
    return
  }
  if (shown) {
    await env.DB.prepare('UPDATE assistant_messages SET shown = 1, text = ?, trail = ?, input_tokens = ?, output_tokens = ? WHERE id = ?')
      .bind(result.reply, JSON.stringify(trail), result.usage.inputTokens, result.usage.outputTokens, shown.id).run()
    if (callIds.length > 0) {
      await env.DB.prepare(`UPDATE assistant_tool_calls SET message_id = ? WHERE call_id IN (${callIds.map(() => '?').join(', ')})`)
        .bind(shown.id, ...callIds).run()
    }
    await env.DB.prepare('UPDATE assistant_chats SET updated_at = ? WHERE id = ?').bind(ctx.now, chat.id).run()
    const rows = await query<MessageRow>(env.DB, 'SELECT * FROM assistant_messages WHERE id = ?', [shown.id])
    if (rows[0]) await emit({ type: 'message', message: toMessage(rows[0], await undoableCalls(env, chat.id)) })
  }
  if (result.pending) {
    const pending = await storePending(env, chat, ctx, result.pending)
    await emit({ type: 'pending', pending })
  }
}

async function storePending(env: Env, chat: ChatRow, ctx: ToolContext, pending: PendingWrite): Promise<AssistantPendingWrite> {
  const card = await describeWrite(ctx, pending.name, pending.args)
  const id = crypto.randomUUID()
  await env.DB.prepare(`INSERT INTO assistant_tool_calls
    (call_id, chat_id, message_id, tool_call_id, tool_name, arguments, status, label, undo, card, created_at, resolved_at)
    VALUES (?, ?, NULL, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)`)
    .bind(id, chat.id, pending.callId, pending.name, JSON.stringify(pending.args), JSON.stringify(card), ctx.now)
    .run()
  return { callId: id, chatId: chat.id, toolName: pending.name, title: card.title, lines: card.lines }
}

/** A pending write the user walked away from gets closed, so the transcript stays well formed. */
async function supersedePending(env: Env, chat: ChatRow, now: string): Promise<void> {
  const pending = await pendingFor(env, chat.id)
  if (!pending) return
  await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'rejected', resolved_at = ? WHERE call_id = ?`).bind(now, pending.call_id).run()
  await insertMessage(env, chat.id, 'tool', {
    role: 'tool', tool_call_id: pending.tool_call_id,
    content: JSON.stringify({ rejected: true, message: 'The user did not confirm this change and wrote a new message instead.' })
  }, now)
}

async function rateLimited(env: Env, datasetId: string, now: string): Promise<boolean> {
  const minuteAgo = new Date(new Date(now).getTime() - 60_000).toISOString()
  const rows = await query<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM assistant_messages m
    JOIN assistant_chats c ON c.id = m.chat_id WHERE c.dataset_id = ? AND m.role = 'user' AND m.created_at >= ?`, [datasetId, minuteAgo])
  return (rows[0]?.count ?? 0) >= MAX_TURNS_PER_MINUTE
}

function titleFrom(input: TurnInput): string {
  const line = input.text.trim().split('\n')[0]?.trim() ?? ''
  if (!line) return 'Receipt'
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line
}

function context(env: Env, device: DeviceIdentity, now: string, today: string, units: AssistantUnits): ToolContext {
  return { env, device, now, today, units }
}

async function turn(request: Request, env: Env, device: DeviceIdentity, now: string): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return failure(503, { code: 'NOT_CONFIGURED', message: 'Add OPENROUTER_API_KEY on the Worker to use the assistant' })
  let body: unknown
  try { body = await request.json() } catch { return failure(400, { code: 'INVALID_REQUEST', message: 'The request body is not valid JSON' }) }
  const input = parseTurn(body)
  if (!input) return failure(400, { code: 'INVALID_REQUEST', message: 'Check the message, image, and date' })
  if (await rateLimited(env, device.datasetId, now)) {
    return failure(429, { code: 'RATE_LIMITED', message: 'Too many messages. Wait a moment and try again.' })
  }
  let chat: ChatRow | null = null
  let created = false
  if (input.chatId) {
    chat = await chatFor(env, device.datasetId, input.chatId)
    if (!chat) return failure(404, { code: 'NOT_FOUND', message: 'That chat does not exist' })
  } else {
    const id = crypto.randomUUID()
    await env.DB.prepare('INSERT INTO assistant_chats (id, dataset_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, device.datasetId, titleFrom(input), now, now).run()
    chat = { id, dataset_id: device.datasetId, title: titleFrom(input), created_at: now, updated_at: now, deleted_at: null }
    created = true
  }
  const stream = ndjson()
  const current = chat
  void (async () => {
    try {
      if (created) await stream.emit({ type: 'chat', chat: toChat(current) })
      await supersedePending(env, current, now)
      const text = input.text.trim()
      const stored: ModelMessage = { role: 'user', content: input.image ? [text, IMAGE_NOTE].filter(Boolean).join('\n\n') : text }
      const live: ModelMessage = input.image
        ? {
          role: 'user',
          content: [
            { type: 'text', text: text || 'Read this receipt and record the purchase.' },
            { type: 'image_url', image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}` } }
          ]
        }
        : stored
      const row = await insertMessage(env, current.id, 'user', stored, now, { shown: true, text, hasImage: input.image !== null })
      await stream.emit({ type: 'message', message: toMessage(row, []) })
      const history = await contextFor(env, current.id)
      if (input.image && history.length > 0) history[history.length - 1] = live
      await runTurn({
        env, device, chat: current, ctx: context(env, device, now, input.today, input.units), timeZone: input.timeZone,
        history, earlierCallIds: [], earlierTrail: [], emit: stream.emit
      })
    } catch (error: unknown) {
      await stream.emit({ type: 'error', error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'The turn could not be completed' } })
    } finally {
      await stream.emit({ type: 'done' })
      await stream.close()
    }
  })()
  return stream.response
}

async function confirm(request: Request, env: Env, device: DeviceIdentity, now: string): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) return failure(503, { code: 'NOT_CONFIGURED', message: 'Add OPENROUTER_API_KEY on the Worker to use the assistant' })
  let body: unknown
  try { body = await request.json() } catch { return failure(400, { code: 'INVALID_REQUEST', message: 'The request body is not valid JSON' }) }
  const input = parseConfirm(body)
  if (!input) return failure(400, { code: 'INVALID_REQUEST', message: 'Check the chat, call, and answer' })
  const chat = await chatFor(env, device.datasetId, input.chatId)
  if (!chat) return failure(404, { code: 'NOT_FOUND', message: 'That chat does not exist' })
  const rows = await query<CallRow>(env.DB, 'SELECT * FROM assistant_tool_calls WHERE call_id = ? AND chat_id = ?', [input.callId, chat.id])
  const call = rows[0]
  if (!call) return failure(404, { code: 'NOT_FOUND', message: 'That change was not found' })
  if (call.status !== 'pending') return failure(409, { code: 'CONFLICT', message: 'That change was already answered' })
  const ctx = context(env, device, now, input.today, input.units)
  const stream = ndjson()
  void (async () => {
    try {
      const args = parseJson<Record<string, unknown>>(call.arguments, {})
      let content: string
      let earlier: string[] = []
      const earlierTrail: string[] = []
      if (!input.approved) {
        await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'rejected', resolved_at = ? WHERE call_id = ?`).bind(now, call.call_id).run()
        content = JSON.stringify({ rejected: true, message: 'The user rejected this change. Ask what to change if it is not clear.' })
      } else {
        const request: AssistantCall = { name: call.tool_name as AssistantToolName, args, callId: call.tool_call_id }
        try {
          const outcome = await executeAssistantWrite(ctx, request)
          await env.DB.prepare(`UPDATE assistant_tool_calls SET status = ?, label = ?, undo = ?, resolved_at = ? WHERE call_id = ?`)
            .bind(outcome.failed ? 'failed' : 'succeeded', outcome.label, outcome.undo ? JSON.stringify(outcome.undo) : null, now, call.call_id).run()
          content = JSON.stringify(outcome.data)
          await stream.emit({ type: 'trail', line: outcome.trail })
          earlierTrail.push(outcome.trail)
          earlier = [call.call_id]
        } catch (error: unknown) {
          await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'failed', resolved_at = ? WHERE call_id = ?`).bind(now, call.call_id).run()
          content = JSON.stringify({ error: error instanceof Error ? error.message : 'The change could not be saved' })
        }
      }
      await insertMessage(env, chat.id, 'tool', { role: 'tool', tool_call_id: call.tool_call_id, content }, now)
      await runTurn({
        env, device, chat, ctx, timeZone: input.timeZone,
        history: await contextFor(env, chat.id), earlierCallIds: earlier, earlierTrail, emit: stream.emit
      })
    } catch (error: unknown) {
      await stream.emit({ type: 'error', error: { code: 'SERVER_ERROR', message: error instanceof Error ? error.message : 'The change could not be completed' } })
    } finally {
      await stream.emit({ type: 'done' })
      await stream.close()
    }
  })()
  return stream.response
}

async function undo(request: Request, env: Env, device: DeviceIdentity, now: string): Promise<Response> {
  let body: unknown
  try { body = await request.json() } catch { return failure(400, { code: 'INVALID_REQUEST', message: 'The request body is not valid JSON' }) }
  if (!isRecord(body) || typeof body.chatId !== 'string' || typeof body.callId !== 'string') {
    return failure(400, { code: 'INVALID_REQUEST', message: 'Check the chat and call' })
  }
  const chat = await chatFor(env, device.datasetId, body.chatId)
  if (!chat) return failure(404, { code: 'NOT_FOUND', message: 'That chat does not exist' })
  const rows = await query<CallRow>(env.DB, 'SELECT * FROM assistant_tool_calls WHERE call_id = ? AND chat_id = ?', [body.callId, chat.id])
  const call = rows[0]
  if (!call) return failure(404, { code: 'NOT_FOUND', message: 'That change was not found' })
  const plan = parseJson<UndoPlan | null>(call.undo, null)
  if (call.status !== 'succeeded' || !plan) return failure(409, { code: 'CONFLICT', message: 'That change cannot be undone' })
  const ctx = context(env, device, now, now.slice(0, 10), 'imperial')
  try {
    await undoAssistantWrite(ctx, plan, call.call_id)
  } catch (error: unknown) {
    return failure(409, { code: 'CONFLICT', message: error instanceof Error ? error.message : 'That change could not be undone' })
  }
  await env.DB.prepare(`UPDATE assistant_tool_calls SET status = 'undone', resolved_at = ? WHERE call_id = ?`).bind(now, call.call_id).run()
  const text = `Undid the ${call.label ?? 'change'}.`
  const row = await insertMessage(env, chat.id, 'assistant', { role: 'assistant', content: text }, now, { shown: true, text })
  await env.DB.prepare('UPDATE assistant_chats SET updated_at = ? WHERE id = ?').bind(now, chat.id).run()
  const data: AssistantUndoResponse = { message: toMessage(row, []) }
  return ok(data)
}

async function listChats(env: Env, device: DeviceIdentity): Promise<Response> {
  const rows = await query<ChatRow>(env.DB,
    'SELECT * FROM assistant_chats WHERE dataset_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?', [device.datasetId, MAX_CHATS])
  const data: AssistantChatList = { chats: rows.map(toChat) }
  return ok(data)
}

async function deleteChat(env: Env, device: DeviceIdentity, id: string, now: string): Promise<Response> {
  const chat = await chatFor(env, device.datasetId, id)
  if (!chat) return failure(404, { code: 'NOT_FOUND', message: 'That chat does not exist' })
  await env.DB.prepare('UPDATE assistant_chats SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run()
  return ok({ deleted: true })
}

async function history(env: Env, device: DeviceIdentity, id: string | null): Promise<Response> {
  if (!id) {
    const empty: AssistantHistory = { chat: null, messages: [], pending: null }
    return ok(empty)
  }
  const chat = await chatFor(env, device.datasetId, id)
  if (!chat) return failure(404, { code: 'NOT_FOUND', message: 'That chat does not exist' })
  const [rows, calls, pending] = await Promise.all([
    query<MessageRow>(env.DB, 'SELECT * FROM assistant_messages WHERE chat_id = ? AND shown = 1 ORDER BY seq DESC LIMIT ?', [chat.id, ASSISTANT_HISTORY_LIMIT]),
    undoableCalls(env, chat.id),
    pendingFor(env, chat.id)
  ])
  const data: AssistantHistory = {
    chat: toChat(chat),
    messages: rows.reverse().map((row) => toMessage(row, calls)),
    pending: pending ? toPending(pending) : null
  }
  return ok(data)
}

export function assistantRoute(request: Request, env: Env, device: DeviceIdentity, path: string, now: string): Promise<Response> | null {
  const url = new URL(request.url)
  if (request.method === 'GET' && path === '/v1/assistant/chats') return listChats(env, device)
  if (request.method === 'DELETE' && path.startsWith('/v1/assistant/chats/')) {
    return deleteChat(env, device, decodeURIComponent(path.slice('/v1/assistant/chats/'.length)), now)
  }
  if (request.method === 'GET' && path === '/v1/assistant/messages') return history(env, device, url.searchParams.get('chat'))
  if (request.method === 'POST' && path === '/v1/assistant/turns') return turn(request, env, device, now)
  if (request.method === 'POST' && path === '/v1/assistant/confirm') return confirm(request, env, device, now)
  if (request.method === 'POST' && path === '/v1/assistant/undo') return undo(request, env, device, now)
  return null
}
