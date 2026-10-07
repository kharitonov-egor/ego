import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentGoal, AgentRunList, AssistantStreamEvent, ComposioStatus } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { readsOnly, verifyWebhook } from '../src/composio'
import { callMcpTool } from '../src/mcp-client'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-cmpsio'
const API = 'https://ego.example'
const SECRET = 'whsec_test_secret'
const ROUTINE = 'https://api.anthropic.com/v1/claude_code/routines/trig_test/fire'
let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

async function environment(): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('device-a', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  return {
    DB: ledger.db, OPENROUTER_API_KEY: 'server-key', COMPOSIO_API_KEY: 'cmp-key', COMPOSIO_WEBHOOK_SECRET: SECRET,
    AGENT_ROUTINE_URL: ROUTINE, AGENT_ROUTINE_TOKEN: 'sk-ant-oat01-test', PUBLIC_BASE_URL: 'https://worker.example'
  }
}

async function call<T>(env: Env, path: string, init: RequestInit = {}): Promise<{ status: number; body: { data: T; error?: { message: string } } }> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  headers.set('content-type', 'application/json')
  const response = await handle(new Request(`${API}${path}`, { ...init, headers }), env)
  return { status: response.status, body: await response.json() as { data: T; error?: { message: string } } }
}

async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)))
  let binary = ''
  for (const byte of mac) binary += String.fromCharCode(byte)
  return `v1,${btoa(binary)}`
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function toolCall(id: string, name: string, args: unknown): Response {
  return sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }])
}

function reply(text: string): Response {
  return sse([{ choices: [{ delta: { content: text } }] }])
}

interface Routes {
  model: Response[]
  composio: Array<{ path: string; body: Record<string, unknown> }>
}

function services(model: Response[]): { fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>; seen: Routes } {
  const seen: Routes = { model, composio: [] }
  const fetchMock = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.startsWith('https://backend.composio.dev/api')) {
      const path = url.slice('https://backend.composio.dev/api'.length)
      seen.composio.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      if (path === '/v3.1/tool_router/session') return Response.json({ session_id: 'trs_1', mcp: { type: 'http', url: 'https://x' } }, { status: 201 })
      if (path.includes('/upsert')) return Response.json({ trigger_id: 'ti_1' })
      return Response.json({ data: { results: [{ tool_slug: 'GMAIL_FETCH_EMAILS' }] }, error: null, log_id: 'log_1' })
    }
    if (url === ROUTINE) return Response.json({ claude_code_session_url: 'https://claude.ai/code/session_9' })
    const next = seen.model.shift()
    if (!next) throw new Error(`Unexpected fetch ${url}`)
    return next
  })
  return { fetchMock, seen }
}

async function turn(env: Env, text: string): Promise<AssistantStreamEvent[]> {
  const response = await handle(new Request(`${API}/v1/assistant/turns`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: null, text, today: '2026-10-07', timeZone: 'America/New_York', units: 'imperial', autoSave: true })
  }), env)
  return (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as AssistantStreamEvent)
}

describe('Composio basics', () => {
  it('tells actions that only read from ones that change something', () => {
    expect(readsOnly('GMAIL_FETCH_EMAILS')).toBe(true)
    expect(readsOnly('GOOGLEDRIVE_LIST_FILES')).toBe(true)
    expect(readsOnly('GMAIL_SEND_EMAIL')).toBe(false)
    expect(readsOnly('GMAIL_CREATE_EMAIL_DRAFT')).toBe(false)
    expect(readsOnly('SLACK_FETCH_AND_DELETE_MESSAGE')).toBe(false)
    expect(readsOnly('NOTION_PAGE')).toBe(false)
  })

  it('verifies the webhook signature and refuses stale or forged ones', async () => {
    const body = '{"type":"composio.trigger.message"}'
    const signature = await sign('msg_1', '1800000000', body)
    expect(await verifyWebhook(SECRET, 'msg_1', '1800000000', signature, body, 1_800_000_100)).toBe(true)
    expect(await verifyWebhook(SECRET, 'msg_1', '1800000000', signature, body, 1_800_000_400)).toBe(false)
    expect(await verifyWebhook(SECRET, 'msg_1', '1800000000', signature, `${body} `, 1_800_000_100)).toBe(false)
    expect(await verifyWebhook('other', 'msg_1', '1800000000', signature, body, 1_800_000_100)).toBe(false)
  })

  it('reports what is set up', async () => {
    const env = await environment()
    const status = await call<ComposioStatus>(env, '/v1/agent/composio')
    expect(status.body.data).toEqual({ configured: true, webhookReady: true, webhookUrl: 'https://worker.example/v1/composio/webhook' })
  })
})

describe('apps in the AI chat', () => {
  it('searches and reads through one Composio session, and keeps changes off app_run', async () => {
    const env = await environment()
    const { fetchMock, seen } = services([
      toolCall('call_1', 'app_search', { task: 'fetch unread Gmail emails', knownFields: null }),
      toolCall('call_2', 'app_run', { tool: 'GMAIL_SEND_EMAIL', arguments: { to: 'a@b.c' } }),
      toolCall('call_3', 'app_run', { tool: 'GMAIL_FETCH_EMAILS', arguments: { query: 'is:unread' } }),
      reply('You have one unread email.')
    ])
    vi.stubGlobal('fetch', fetchMock)
    const events = await turn(env, 'Any unread email?')
    const trail = events.filter((event): event is Extract<AssistantStreamEvent, { type: 'trail' }> => event.type === 'trail').map((event) => event.line)
    expect(trail).toEqual(['Looked for app actions: fetch unread Gmail emails', 'Read Gmail: fetch emails'])
    expect(seen.composio.map((entry) => entry.path)).toEqual([
      '/v3.1/tool_router/session', '/v3.1/tool_router/session/trs_1/execute_meta', '/v3.1/tool_router/session/trs_1/execute_meta'
    ])
    expect(seen.composio[0].body).toMatchObject({ user_id: 'ego-ego', workbench: { enable: false } })
    expect(seen.composio[1].body).toMatchObject({ slug: 'COMPOSIO_SEARCH_TOOLS', arguments: { queries: [{ use_case: 'fetch unread Gmail emails' }] } })
    expect(seen.composio[2].body).toEqual({ slug: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { tools: [{ tool_slug: 'GMAIL_FETCH_EMAILS', arguments: { query: 'is:unread' } }], sync_response_to_workbench: false } })
    const third = JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body)) as { messages: Array<{ role: string; content: string }> }
    const toolResults = third.messages.filter((message) => message.role === 'tool').map((message) => message.content)
    expect(toolResults[1]).toContain('Use app_change')
  })

  it('puts app_change on a card and runs it only when it saves', async () => {
    const env = await environment()
    const { fetchMock, seen } = services([
      toolCall('call_1', 'app_change', { tool: 'GMAIL_SEND_EMAIL', arguments: { recipient_email: 'mom@example.com', subject: 'Sunday' }, summary: 'Email Mom about Sunday dinner' })
    ])
    vi.stubGlobal('fetch', fetchMock)
    const events = await turn(env, 'Email mom about Sunday')
    const pending = events.find((event): event is Extract<AssistantStreamEvent, { type: 'pending' }> => event.type === 'pending')?.pending
    expect(pending?.changes).toEqual([{ toolName: 'app_change', title: 'Gmail: send email', lines: ['Email Mom about Sunday dinner', 'recipient_email: mom@example.com', 'subject: Sunday'] }])
    expect(seen.composio).toEqual([])
    seen.model.push(reply('Sent.'))
    const confirm = await handle(new Request(`${API}/v1/assistant/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: pending?.chatId, callId: pending?.callId, approved: true, today: '2026-10-07', timeZone: 'America/New_York', units: 'imperial' })
    }), env)
    await confirm.text()
    expect(seen.composio.at(-1)?.body).toMatchObject({ slug: 'COMPOSIO_MULTI_EXECUTE_TOOL', arguments: { tools: [{ tool_slug: 'GMAIL_SEND_EMAIL' }] } })
  })
})

describe('event goals', () => {
  it('turns the trigger on, starts a run for a matching signed event once, and ignores the rest', async () => {
    const env = await environment()
    const { fetchMock, seen } = services([])
    vi.stubGlobal('fetch', fetchMock)
    const created = await call<AgentGoal>(env, '/v1/agent/goals', {
      method: 'POST',
      body: JSON.stringify({ title: 'Bills', instructions: 'Propose a transaction for each bill.', trigger: { type: 'event', trigger: 'GMAIL_NEW_GMAIL_MESSAGE', filter: 'invoice' } })
    })
    expect(created.body.data).toMatchObject({ nextRunAt: null, trigger: { type: 'event', trigger: 'GMAIL_NEW_GMAIL_MESSAGE', filter: 'invoice' } })
    expect(created.body.data.notice).toBeUndefined()
    expect(seen.composio[0]).toEqual({ path: '/v3/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert', body: { user_id: 'ego-ego', trigger_config: {} } })

    const deliver = async (id: string, subject: string, slug = 'GMAIL_NEW_GMAIL_MESSAGE'): Promise<number> => {
      const body = JSON.stringify({ type: 'composio.trigger.message', metadata: { trigger_slug: slug, user_id: 'ego-ego', trigger_id: 'ti_1' }, data: { subject } })
      const timestamp = String(Math.floor(Date.now() / 1000))
      const response = await handle(new Request(`${API}/v1/composio/webhook`, {
        method: 'POST',
        headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': await sign(id, timestamp, body) },
        body
      }), env)
      return response.status
    }
    expect(await deliver('msg_1', 'Your Invoice from Duke Energy')).toBe(204)
    expect(await deliver('msg_1', 'Your Invoice from Duke Energy')).toBe(204)
    expect(await deliver('msg_2', 'Lunch on Friday?')).toBe(204)
    expect(await deliver('msg_3', 'Invoice', 'SLACK_RECEIVE_MESSAGE')).toBe(204)
    const runs = (await call<AgentRunList>(env, '/v1/agent/runs')).body.data.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ reason: 'event', status: 'queued', sessionUrl: 'https://claude.ai/code/session_9' })
    const event = await env.DB.prepare('SELECT event FROM agent_runs').first<{ event: string }>()
    expect(JSON.parse(event?.event ?? '{}')).toEqual({ trigger: 'GMAIL_NEW_GMAIL_MESSAGE', data: { subject: 'Your Invoice from Duke Energy' } })

    const forged = await handle(new Request(`${API}/v1/composio/webhook`, {
      method: 'POST', headers: { 'webhook-id': 'msg_4', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' }, body: '{}'
    }), env)
    expect(forged.status).toBe(401)
  })
})

describe('MCP client', () => {
  it('opens a session, keeps its id, and reads a tool result sent as an event stream', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as { method: string; id?: number }
      if (body.method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18' } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess_1' } })
      }
      if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
      expect((init?.headers as Record<string, string>)['mcp-session-id']).toBe('sess_1')
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Standup notes' }] } })}\n\n`, {
        headers: { 'content-type': 'text/event-stream' }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const text = await callMcpTool({ url: 'https://mcp.wispr.ai/mcp', headers: { authorization: 'Bearer t' } }, 'search_meetings', { query: 'standup' })
    expect(text).toBe('Standup notes')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
