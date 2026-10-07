import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_KEY_PREFIX, AGENT_MEMORY_MAX_NOTES,
  type AgentKeyCreated, type AgentKeyList, type AgentMemory, type AgentMemoryList, type AssistantStreamEvent
} from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-agent1'
const OTHER = 'other-dataset-token-that-is-long-enough-agnt2'
const API = 'https://ego.example'
let ledger: Ledger | null = null

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

interface RpcReply {
  jsonrpc: string
  id: string | number | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

async function environment(): Promise<Env> {
  ledger = await seedLedger()
  const db = ledger.db
  await exec(db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('device-a', 'Phone', ?, 'ego', ?)`,
    [await hashToken(TOKEN), NOW])
  await exec(db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('device-b', 'Elsewhere', ?, 'other', ?)`,
    [await hashToken(OTHER), NOW])
  await exec(db, `INSERT INTO mood_entries (id, date, mood, note, created_at, updated_at, revision)
    VALUES ('mood-2026-09-11', '2026-09-11', 4, 'Long walk', ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO habits (id, name, icon, kind, start_date, position, target, period, created_at, updated_at, revision)
    VALUES ('habit-read', 'Reading', '📚', 'build', '2026-09-01', 0, 1, 'day', ?, ?, 1)`, [NOW, NOW])
  return { DB: db, OPENROUTER_API_KEY: 'server-key', PUBLIC_BASE_URL: 'https://worker.example/' }
}

async function call<T>(env: Env, path: string, token: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  headers.set('content-type', 'application/json')
  const response = await handle(new Request(`${API}${path}`, { ...init, headers }), env)
  return { status: response.status, body: await response.json() as Envelope<T> }
}

async function newKey(env: Env): Promise<AgentKeyCreated> {
  const created = await call<AgentKeyCreated>(env, '/v1/agent/keys', TOKEN, { method: 'POST', body: JSON.stringify({ name: 'claude.ai' }) })
  expect(created.status).toBe(200)
  return created.body.data
}

async function rpc(env: Env, key: string | null, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const sent = new Headers({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers })
  if (key) sent.set('authorization', `Bearer ${key}`)
  return handle(new Request(`${API}/mcp`, { method: 'POST', headers: sent, body: JSON.stringify(body) }), env)
}

async function rpcCall(env: Env, key: string, method: string, params: unknown = {}, id: number = 1): Promise<RpcReply> {
  const response = await rpc(env, key, { jsonrpc: '2.0', id, method, params })
  expect(response.status).toBe(200)
  return await response.json() as RpcReply
}

async function toolCall(env: Env, key: string, name: string, args: unknown): Promise<{ text: string; isError: boolean }> {
  const reply = await rpcCall(env, key, 'tools/call', { name, arguments: args })
  const result = reply.result as { content: Array<{ type: string; text: string }>; isError: boolean }
  return { text: result.content[0].text, isError: result.isError }
}

describe('MCP keys', () => {
  it('makes, lists, and revokes keys for the signed-in dataset only', async () => {
    const env = await environment()
    const created = await newKey(env)
    expect(created.token.startsWith(AGENT_KEY_PREFIX)).toBe(true)
    expect(created.mcpUrl).toBe('https://worker.example/mcp')
    expect(created.key.name).toBe('claude.ai')

    const list = await call<AgentKeyList>(env, '/v1/agent/keys', TOKEN)
    expect(list.body.data.keys.map((key) => key.id)).toEqual([created.key.id])
    const elsewhere = await call<AgentKeyList>(env, '/v1/agent/keys', OTHER)
    expect(elsewhere.body.data.keys).toEqual([])
    expect((await call(env, `/v1/agent/keys/${created.key.id}`, OTHER, { method: 'DELETE' })).status).toBe(404)

    expect((await call(env, `/v1/agent/keys/${created.key.id}`, TOKEN, { method: 'DELETE' })).status).toBe(200)
    expect((await call<AgentKeyList>(env, '/v1/agent/keys', TOKEN)).body.data.keys).toEqual([])
    expect((await rpc(env, created.token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
  })

  it('does not accept an MCP key anywhere but /mcp', async () => {
    const env = await environment()
    const { token } = await newKey(env)
    expect((await call(env, '/v1/agent/memories', token)).status).toBe(401)
    expect((await call(env, '/v1/reference', token)).status).toBe(401)
  })
})

describe('memory routes', () => {
  it('adds, edits, lists newest first, and deletes notes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    const env = await environment()
    const first = await call<AgentMemory>(env, '/v1/agent/memories', TOKEN, { method: 'POST', body: JSON.stringify({ text: '  Prefers   metric for body weight ' }) })
    expect(first.body.data).toMatchObject({ text: 'Prefers metric for body weight', source: 'user' })
    vi.setSystemTime(new Date('2026-10-07T12:01:00Z'))
    const second = await call<AgentMemory>(env, '/v1/agent/memories', TOKEN, { method: 'POST', body: JSON.stringify({ text: 'Lives in Tampa' }) })
    vi.setSystemTime(new Date('2026-10-07T12:02:00Z'))
    const again = await call<AgentMemory>(env, '/v1/agent/memories', TOKEN, { method: 'POST', body: JSON.stringify({ text: 'lives in tampa' }) })
    expect(again.body.data.id).toBe(second.body.data.id)

    vi.setSystemTime(new Date('2026-10-07T12:03:00Z'))
    const edited = await call<AgentMemory>(env, `/v1/agent/memories/${first.body.data.id}`, TOKEN, {
      method: 'PUT', body: JSON.stringify({ text: 'Prefers kilograms' })
    })
    expect(edited.body.data.text).toBe('Prefers kilograms')
    expect((await call(env, '/v1/agent/memories', TOKEN, { method: 'POST', body: JSON.stringify({ text: 'a' }) })).status).toBe(400)

    const list = await call<AgentMemoryList>(env, '/v1/agent/memories', TOKEN)
    expect(list.body.data.memories.map((memory) => memory.text)).toEqual(['Prefers kilograms', 'Lives in Tampa'])
    expect((await call<AgentMemoryList>(env, '/v1/agent/memories', OTHER)).body.data.memories).toEqual([])

    expect((await call(env, `/v1/agent/memories/${second.body.data.id}`, TOKEN, { method: 'DELETE' })).status).toBe(200)
    expect((await call(env, `/v1/agent/memories/${second.body.data.id}`, TOKEN, { method: 'DELETE' })).status).toBe(404)
  })

  it('stops at the note limit', async () => {
    const env = await environment()
    for (let index = 0; index < AGENT_MEMORY_MAX_NOTES; index += 1) {
      await exec(env.DB, `INSERT INTO agent_memories (id, dataset_id, text, source, created_at, updated_at) VALUES (?, 'ego', ?, 'user', ?, ?)`,
        [`note-${index}`, `Fact number ${index}`, NOW, NOW])
    }
    const full = await call(env, '/v1/agent/memories', TOKEN, { method: 'POST', body: JSON.stringify({ text: 'One more fact' }) })
    expect(full.status).toBe(400)
    expect(full.body.error?.message).toContain('up to 200 notes')
  })
})

describe('POST /mcp', () => {
  it('needs a live MCP key and answers only POST', async () => {
    const env = await environment()
    expect((await rpc(env, null, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await rpc(env, TOKEN, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    const { token } = await newKey(env)
    const get = await handle(new Request(`${API}/mcp`, { headers: { authorization: `Bearer ${token}` } }), env)
    expect(get.status).toBe(405)
    const viaHeader = await rpc(env, null, { jsonrpc: '2.0', id: 7, method: 'ping' }, { 'x-api-key': token })
    expect(await viaHeader.json()).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
  })

  it('initializes, accepts the initialized notification, and lists tools with writes as proposals', async () => {
    const env = await environment()
    const { token } = await newKey(env)
    const init = await rpcCall(env, token, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' }
    })
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'ego' }, capabilities: { tools: {} } })
    expect(String(init.result?.instructions)).toContain('ego_context')
    const newer = await rpcCall(env, token, 'initialize', { protocolVersion: '2099-01-01' })
    expect(newer.result?.protocolVersion).toBe('2025-11-25')

    const notified = await rpc(env, token, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notified.status).toBe(202)

    const listed = await rpcCall(env, token, 'tools/list')
    const tools = (listed.result?.tools ?? []) as Array<{ name: string; annotations: { readOnlyHint: boolean } }>
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('ego_context')
    expect(names).toContain('read_mood')
    expect(names).toContain('remember')
    expect(names).toContain('recall')
    expect(names).toContain('record_transactions')
    expect(names).toContain('start_runs')
    expect(names).not.toContain('delegate_task')
    expect(tools.find((tool) => tool.name === 'record_transactions')?.annotations.readOnlyHint).toBe(false)
    expect(tools.find((tool) => tool.name === 'read_mood')?.annotations.readOnlyHint).toBe(true)
    expect(tools.find((tool) => tool.name === 'remember')?.annotations.readOnlyHint).toBe(false)

    const unknown = await rpcCall(env, token, 'sampling/createMessage')
    expect(unknown.error?.code).toBe(-32601)
  })

  it('reads data on the clock the apps last sent', async () => {
    const env = await environment()
    const { token } = await newKey(env)
    await exec(env.DB, `INSERT INTO agent_settings (dataset_id, settings, updated_at) VALUES ('ego', ?, ?)`,
      [JSON.stringify({ timeZone: 'Pacific/Kiritimati', units: 'metric' }), NOW])
    const context = await toolCall(env, token, 'ego_context', {})
    const parsed = JSON.parse(context.text) as { timeZone: string; units: string; habits: Array<{ id: string }>; today: string }
    expect(parsed.timeZone).toBe('Pacific/Kiritimati')
    expect(parsed.units).toBe('metric')
    expect(parsed.habits.map((habit) => habit.id)).toEqual(['habit-read'])
    expect(parsed.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const mood = await toolCall(env, token, 'read_mood', { from: '2026-09-11', to: '2026-09-11' })
    expect(mood.isError).toBe(false)
    expect(mood.text).toContain('Long walk')

    const bad = await toolCall(env, token, 'read_mood', { from: 'yesterday', to: '2026-09-11' })
    expect(bad.isError).toBe(true)
    const missing = await rpcCall(env, token, 'tools/call', { name: 'delegate_task', arguments: {} })
    expect(missing.error?.code).toBe(-32602)
  })

  it('remembers, recalls, and forgets notes as the agent', async () => {
    const env = await environment()
    const { token } = await newKey(env)
    const saved = await toolCall(env, token, 'remember', { text: 'Has a dog named Luna', replaces: null })
    const id = (JSON.parse(saved.text) as { id: string }).id
    const recalled = await toolCall(env, token, 'recall', { query: 'luna' })
    expect(JSON.parse(recalled.text)).toMatchObject({ notes: [{ id, text: 'Has a dog named Luna', source: 'agent' }] })
    const replaced = await toolCall(env, token, 'remember', { text: 'Has a dog named Luna, a husky', replaces: id })
    expect((JSON.parse(replaced.text) as { id: string }).id).toBe(id)
    expect((await toolCall(env, token, 'forget', { id })).isError).toBe(false)
    expect((await toolCall(env, token, 'forget', { id })).isError).toBe(true)
  })

  it('answers a batch and skips notifications inside it', async () => {
    const env = await environment()
    const { token } = await newKey(env)
    const response = await rpc(env, token, [
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'two', method: 'ping' }
    ])
    expect(await response.json()).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }, { jsonrpc: '2.0', id: 'two', result: {} }])
    const parse = await handle(new Request(`${API}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{' }), env)
    expect(parse.status).toBe(400)
  })
})

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('memory in the AI chat', () => {
  it('saves a note inside the turn, shows it in the trail, and reads notes into the prompt', async () => {
    const env = await environment()
    await exec(env.DB, `INSERT INTO agent_memories (id, dataset_id, text, source, created_at, updated_at)
      VALUES ('note-old', 'ego', 'Trains at 6am', 'user', ?, ?)`, [NOW, NOW])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'remember', arguments: JSON.stringify({ text: 'Is vegetarian', replaces: null }) } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
      ]))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Got it.' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]))
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(new Request(`${API}/v1/assistant/turns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: null, text: 'I am vegetarian now', today: '2026-09-12', timeZone: 'Europe/Berlin', units: 'metric' })
    }), env)
    const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as AssistantStreamEvent)
    const reply = lines.filter((event): event is Extract<AssistantStreamEvent, { type: 'message' }> => event.type === 'message').pop()
    expect(reply?.message.trail).toEqual(['Remembered: Is vegetarian'])
    expect(lines.some((event) => event.type === 'pending')).toBe(false)

    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as { messages: Array<{ content: unknown }> }
    expect(JSON.stringify(firstBody.messages[0].content)).toContain('[note-old] Trains at 6am')
    const notes = await call<AgentMemoryList>(env, '/v1/agent/memories', TOKEN)
    expect(notes.body.data.memories.find((memory) => memory.text === 'Is vegetarian')?.source).toBe('chat')

    const settings = await env.DB.prepare(`SELECT settings FROM agent_settings WHERE dataset_id = 'ego'`).first<{ settings: string }>()
    expect(JSON.parse(settings?.settings ?? '{}')).toMatchObject({ timeZone: 'Europe/Berlin', units: 'metric' })
  })
})
