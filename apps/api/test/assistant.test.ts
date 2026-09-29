import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantChatList, AssistantHistory, AssistantStreamEvent, AssistantUndoResponse } from '@ego/api-contracts'
import type { ModelMessage } from '@ego/core'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-assist'
const TODAY = '2026-09-12'
let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

interface Envelope<T> {
  ok: boolean
  data: T
  error?: { code: string; message: string }
}

async function payload<T>(response: Response): Promise<Envelope<T>> {
  return await response.json() as Envelope<T>
}

async function environment(overrides: Partial<Env> = {}): Promise<Env> {
  ledger = await seedLedger()
  const db = ledger.db
  await exec(db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-a', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  await exec(db, `INSERT INTO mood_entries (id, date, mood, note, created_at, updated_at, revision)
    VALUES ('mood-2026-09-11', '2026-09-11', 4, 'Long walk', ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO habits (id, name, icon, kind, start_date, position, target, period, created_at, updated_at, revision)
    VALUES ('habit-read', 'Reading', '📚', 'build', '2026-09-01', 0, 1, 'day', ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO gym_categories (id, name, color, created_at, updated_at, revision)
    VALUES ('cat-chest', 'Chest', '#3987e5', ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO gym_exercises (id, name, category_id, type, weight_unit, notes, created_at, updated_at, revision)
    VALUES ('ex-bench', 'Bench Press', 'cat-chest', 'weight_reps', 'default', '', ?, ?, 1)`, [NOW, NOW])
  return { DB: db, OPENROUTER_API_KEY: 'server-key', ...overrides }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ego.example${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...init.headers }
  })
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function text(reply: string): Response {
  return sse([
    { choices: [{ delta: { content: reply } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } }
  ])
}

function toolCall(id: string, name: string, args: unknown, content = ''): Response {
  return sse([
    ...(content ? [{ choices: [{ delta: { content } }] }] : []),
    { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 40, completion_tokens: 10 } }
  ])
}

async function events(response: Response): Promise<AssistantStreamEvent[]> {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('ndjson')
  const body = await response.text()
  return body.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AssistantStreamEvent)
}

interface Calls {
  mock: { calls: unknown[][] }
}

function sentBody(fetchMock: Calls, call: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[call][1] as RequestInit
  return JSON.parse(String(init.body)) as Record<string, unknown>
}

function sentMessages(fetchMock: Calls, call: number): ModelMessage[] {
  return sentBody(fetchMock, call).messages as ModelMessage[]
}

function systemText(fetchMock: Calls, call: number): string {
  const content = sentMessages(fetchMock, call)[0].content
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.map((part) => part.type === 'text' ? part.text : '').join('') : ''
}

function turnBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ chatId: null, text: 'Hello', today: TODAY, timeZone: 'America/New_York', units: 'imperial', ...overrides })
}

function find<T extends AssistantStreamEvent['type']>(list: AssistantStreamEvent[], type: T): Extract<AssistantStreamEvent, { type: T }>[] {
  return list.filter((event): event is Extract<AssistantStreamEvent, { type: T }> => event.type === type)
}

describe('POST /v1/assistant/turns', () => {
  it('needs the server key and a well-formed body', async () => {
    const env = await environment({ OPENROUTER_API_KEY: undefined })
    expect((await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody() }), env)).status).toBe(503)
    const configured = await environment()
    expect((await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: '' }) }), configured)).status).toBe(400)
    expect((await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ today: 'today' }) }), configured)).status).toBe(400)
    expect((await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ chatId: 'missing' }) }), configured)).status).toBe(404)
  })

  it('reads mood through a tool, streams the answer, and stores the turn', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_1', 'read_mood', { from: '2026-09-11', to: '2026-09-11' }))
      .mockResolvedValueOnce(text('You felt Good.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'How was my mood yesterday?' }) }), env))
    const chat = find(list, 'chat')[0]?.chat
    expect(chat?.title).toBe('How was my mood yesterday?')
    const messages = find(list, 'message').map((event) => event.message)
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1]).toMatchObject({ text: 'You felt Good.', trail: ['Read mood for yesterday'], undo: [] })
    expect(find(list, 'delta').map((event) => event.text).join('')).toBe('You felt Good.')
    expect(list[list.length - 1]).toEqual({ type: 'done' })

    const system = systemText(fetchMock, 0)
    expect(system).toContain('Saturday, 2026-09-12 in the America/New_York time zone')
    expect(system).toContain('"id":"habit-read","name":"Reading"')
    expect(system).toContain('"id":"ex-bench","name":"Bench Press"')
    expect(JSON.stringify(sentMessages(fetchMock, 0)[0])).toContain('ephemeral')
    const second = sentMessages(fetchMock, 1)
    const toolResult = second[second.length - 1]
    expect(toolResult.role).toBe('tool')
    expect(String((toolResult as { content: string }).content)).toContain('"mood":4')
    expect(String((toolResult as { content: string }).content)).toContain('Long walk')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer server-key')
    expect(sentBody(fetchMock, 0).model).toBe('openai/gpt-6-sol')

    const rows = await env.DB.prepare('SELECT role, shown, text FROM assistant_messages ORDER BY seq').all<{ role: string; shown: number; text: string }>()
    expect(rows.results).toEqual([
      { role: 'user', shown: 1, text: 'How was my mood yesterday?' },
      { role: 'assistant', shown: 0, text: '' },
      { role: 'tool', shown: 0, text: '' },
      { role: 'assistant', shown: 1, text: 'You felt Good.' }
    ])
    const history = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chat?.id}`), env))
    expect(history.data.messages.map((message) => message.text)).toEqual(['How was my mood yesterday?', 'You felt Good.'])
    expect(history.data.pending).toBeNull()
  })

  it('uses the model from ASSISTANT_MODEL and reports an upstream failure in the stream', async () => {
    const env = await environment({ ASSISTANT_MODEL: 'test/model' })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody() }), env))
    expect(sentBody(fetchMock, 0).model).toBe('test/model')
    expect(find(list, 'error')[0]?.error.message).toContain('OPENROUTER_API_KEY')
    expect(list[list.length - 1]).toEqual({ type: 'done' })
  })

  it('checks off a habit at once and offers to undo it', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_h', 'log_habit', { habitId: 'habit-read', date: TODAY }))
      .mockResolvedValueOnce(text('Checked off Reading.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'I read today' }) }), env))
    const chat = find(list, 'chat')[0].chat
    expect(find(list, 'trail').map((event) => event.line)).toEqual(['Checked off Reading for today'])
    const reply = find(list, 'message').map((event) => event.message)[1]
    expect(reply.undo).toEqual([{ callId: expect.any(String), label: 'check-off of Reading for today' }])
    const entries = await env.DB.prepare(`SELECT date, kind FROM habit_entries WHERE deleted_at IS NULL`).all<{ date: string; kind: string }>()
    expect(entries.results).toEqual([{ date: TODAY, kind: 'done' }])

    const undone = await payload<AssistantUndoResponse>(await handle(request('/v1/assistant/undo', {
      method: 'POST', body: JSON.stringify({ chatId: chat.id, callId: reply.undo[0].callId })
    }), env))
    expect(undone.data.message).toMatchObject({ role: 'assistant', text: 'Undid the check-off of Reading for today.' })
    const left = await env.DB.prepare(`SELECT COUNT(*) AS count FROM habit_entries WHERE deleted_at IS NULL`).first<{ count: number }>()
    expect(left?.count).toBe(0)
    expect((await handle(request('/v1/assistant/undo', {
      method: 'POST', body: JSON.stringify({ chatId: chat.id, callId: reply.undo[0].callId })
    }), env)).status).toBe(409)
    const history = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chat.id}`), env))
    expect(history.data.messages.map((message) => message.text)).toEqual(['I read today', 'Checked off Reading.', 'Undid the check-off of Reading for today.'])
    expect(history.data.messages[1].undo).toEqual([])
  })

  it('logs gym sets in order and arranges the day', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_g', 'log_gym_sets', {
        date: TODAY, sets: [{ exerciseId: 'ex-bench', weight: 185, reps: 8 }, { exerciseId: 'ex-bench', weight: 185, reps: 6 }]
      }))
      .mockResolvedValueOnce(text('Logged.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'bench 185 x8, x6' }) }), env))
    expect(find(list, 'trail').map((event) => event.line)).toEqual(['Logged Bench Press 185 lbs × 8 reps, 185 lbs × 6 reps'])
    const sets = await env.DB.prepare('SELECT position, weight, weight_unit, reps FROM gym_sets ORDER BY position').all<Record<string, unknown>>()
    expect(sets.results).toEqual([
      { position: 0, weight: 185, weight_unit: 'lbs', reps: 8 },
      { position: 1, weight: 185, weight_unit: 'lbs', reps: 6 }
    ])
    const workout = await env.DB.prepare('SELECT exercise_order FROM gym_workouts WHERE id = ?').bind(TODAY).first<{ exercise_order: string }>()
    expect(workout?.exercise_order).toBe('["ex-bench"]')
  })

  it('answers records from the logged sets', async () => {
    const env = await environment()
    await exec(env.DB, `INSERT INTO gym_sets (id, exercise_id, date, position, weight, weight_unit, reps, comment, created_at, updated_at, revision)
      VALUES ('set-1', 'ex-bench', '2026-08-20', 0, 185, 'lbs', 5, '', ?, ?, 1), ('set-2', 'ex-bench', '2026-09-01', 0, 195, 'lbs', 3, '', ?, ?, 1)`, [NOW, NOW, NOW, NOW])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_r', 'gym_records', { exerciseId: 'ex-bench', from: '2026-08-13', to: TODAY }))
      .mockResolvedValueOnce(text('195 lbs for 3 on Sep 1.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'max bench last month?' }) }), env))
    expect(find(list, 'trail')[0].line).toBe('Read Bench Press records for 2026-08-13 to 2026-09-12')
    const result = JSON.parse(String((sentMessages(fetchMock, 1).at(-1) as { content: string }).content)) as Record<string, unknown>
    expect(result.heaviestWeight).toEqual({ value: 195, date: '2026-09-01' })
    expect(result.bestWeightByReps).toEqual([{ reps: 3, weight: 195, date: '2026-09-01' }, { reps: 5, weight: 185, date: '2026-08-20' }])
    expect(result.estimatedOneRepMax).toEqual({ value: 215.8, date: '2026-08-20' })
  })
})

describe('money writes and the Confirm card', () => {
  const transaction = {
    kind: 'expense', accountId: 'acc-check', categoryId: 'cat-food', amountCents: 4200, date: TODAY, merchant: 'Publix', notes: null, receipt: null
  }

  async function pendingTurn(env: Env): Promise<{ chatId: string; callId: string; fetchMock: ReturnType<typeof vi.fn> }> {
    const fetchMock = vi.fn().mockResolvedValueOnce(toolCall('call_m', 'record_transactions', { transactions: [transaction] }, 'Recording that.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: '$42 at Publix' }) }), env))
    const pending = find(list, 'pending')[0]?.pending
    expect(pending).toMatchObject({ toolName: 'record_transactions', title: 'Record this transaction?', lines: ['−$42.00 Publix · Food · Checking · today'] })
    expect(find(list, 'message').map((event) => event.message.text)).toEqual(['$42 at Publix', 'Recording that.'])
    return { chatId: find(list, 'chat')[0].chat.id, callId: pending.callId, fetchMock }
  }

  it('waits for Confirm, then records and continues the reply', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)
    const before = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chatId}`), env))
    expect(before.data.pending?.callId).toBe(callId)

    fetchMock.mockResolvedValueOnce(text('Recorded $42.00 at Publix.'))
    const list = await events(await handle(request('/v1/assistant/confirm', {
      method: 'POST', body: JSON.stringify({ chatId, callId, approved: true, today: TODAY, timeZone: null, units: 'imperial' })
    }), env))
    expect(find(list, 'trail').map((event) => event.line)).toEqual(['Recorded $42.00 Publix'])
    const reply = find(list, 'message')[0].message
    expect(reply).toMatchObject({ text: 'Recorded $42.00 at Publix.', trail: ['Recorded $42.00 Publix'], undo: [{ label: '$42.00 Publix' }] })
    const saved = await env.DB.prepare('SELECT amount_cents, notes, category_id FROM transactions WHERE deleted_at IS NULL').all<Record<string, unknown>>()
    expect(saved.results).toEqual([{ amount_cents: 4200, notes: 'Publix', category_id: 'cat-food' }])
    const resumed = sentMessages(fetchMock, 1)
    expect(resumed.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_m' })
    expect(String((resumed.at(-1) as { content: string }).content)).toContain('"recorded":1')
    expect((await handle(request('/v1/assistant/confirm', {
      method: 'POST', body: JSON.stringify({ chatId, callId, approved: true, today: TODAY, timeZone: null, units: 'imperial' })
    }), env)).status).toBe(409)

    const undone = await payload<AssistantUndoResponse>(await handle(request('/v1/assistant/undo', {
      method: 'POST', body: JSON.stringify({ chatId, callId: reply.undo[0].callId })
    }), env))
    expect(undone.data.message.text).toBe('Undid the $42.00 Publix.')
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted_at IS NULL').first<{ count: number }>())?.count).toBe(0)
  })

  it('tells the model when the card is rejected', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    fetchMock.mockResolvedValueOnce(text('What should change?'))
    const list = await events(await handle(request('/v1/assistant/confirm', {
      method: 'POST', body: JSON.stringify({ chatId, callId, approved: false, today: TODAY, timeZone: null, units: 'imperial' })
    }), env))
    expect(find(list, 'message')[0].message.text).toBe('What should change?')
    expect(String((sentMessages(fetchMock, 1).at(-1) as { content: string }).content)).toContain('rejected')
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)
    const status = await env.DB.prepare('SELECT status FROM assistant_tool_calls WHERE call_id = ?').bind(callId).first<{ status: string }>()
    expect(status?.status).toBe('rejected')
  })

  it('closes a card the user walked away from when the next message arrives', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    fetchMock.mockResolvedValueOnce(text('Sure.'))
    await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ chatId, text: 'Never mind' }) }), env))
    const status = await env.DB.prepare('SELECT status FROM assistant_tool_calls WHERE call_id = ?').bind(callId).first<{ status: string }>()
    expect(status?.status).toBe('rejected')
    const sent = sentMessages(fetchMock, 1)
    const tool = sent.find((message) => message.role === 'tool')
    expect(String((tool as { content: string }).content)).toContain('did not confirm')
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'Never mind' })
    const history = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chatId}`), env))
    expect(history.data.pending).toBeNull()
  })

  it('sends a receipt image to the model once and keeps only a note', async () => {
    const env = await environment()
    const fetchMock = vi.fn().mockResolvedValueOnce(text('I see a Publix receipt for $42.00.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', {
      method: 'POST', body: turnBody({ text: '', image: { base64: 'aGVsbG8=', mimeType: 'image/jpeg' } })
    }), env))
    expect(find(list, 'chat')[0].chat.title).toBe('Receipt')
    expect(find(list, 'message')[0].message).toMatchObject({ role: 'user', text: '', hasImage: true })
    const sent = sentMessages(fetchMock, 0)
    expect(JSON.stringify(sent.at(-1))).toContain('data:image/jpeg;base64,aGVsbG8=')
    const stored = await env.DB.prepare(`SELECT payload FROM assistant_messages WHERE role = 'user'`).first<{ payload: string }>()
    expect(stored?.payload).not.toContain('base64,aGVsbG8=')
    expect(stored?.payload).toContain('receipt image')
  })
})

describe('chats', () => {
  it('lists, reads, and deletes chats for the device dataset', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn(async () => text('Hi.')))
    const first = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'First chat' }) }), env))
    await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'Second chat' }) }), env))
    const chats = await payload<AssistantChatList>(await handle(request('/v1/assistant/chats'), env))
    expect(chats.data.chats.map((chat) => chat.title)).toEqual(['Second chat', 'First chat'])
    const id = find(first, 'chat')[0].chat.id
    expect((await handle(request(`/v1/assistant/chats/${id}`, { method: 'DELETE' }), env)).status).toBe(200)
    expect((await handle(request(`/v1/assistant/messages?chat=${id}`), env)).status).toBe(404)
    const left = await payload<AssistantChatList>(await handle(request('/v1/assistant/chats'), env))
    expect(left.data.chats.map((chat) => chat.title)).toEqual(['Second chat'])
    const empty = await payload<AssistantHistory>(await handle(request('/v1/assistant/messages'), env))
    expect(empty.data).toEqual({ chat: null, messages: [], pending: null })
  })
})
