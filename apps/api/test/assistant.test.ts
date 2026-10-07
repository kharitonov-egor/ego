import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantChatList, AssistantHistory, AssistantStreamEvent } from '@ego/api-contracts'
import type { ModelMessage } from '@ego/core'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'
import { createTestBucket } from './r2'

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

  it('puts a habit check-off on a card and saves it when the card is confirmed', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_h', 'log_habit', { habitId: 'habit-read', date: TODAY }))
      .mockResolvedValueOnce(text('Checked off Reading.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'I read today' }) }), env))
    const chat = find(list, 'chat')[0].chat
    const pending = find(list, 'pending')[0].pending
    expect(pending.changes).toEqual([{ toolName: 'log_habit', title: 'Check off a habit', lines: ['Reading for today'] }])
    expect(pending).toMatchObject({ title: 'Check off a habit', lines: ['Reading for today'] })
    const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM habit_entries').first<{ count: number }>()
    expect(before?.count).toBe(0)

    const saved = await events(await handle(request('/v1/assistant/confirm', {
      method: 'POST', body: JSON.stringify({ chatId: chat.id, callId: pending.callId, approved: true, today: TODAY, timeZone: null, units: 'imperial' })
    }), env))
    expect(find(saved, 'trail').map((event) => event.line)).toEqual(['Checked off Reading for today'])
    expect(find(saved, 'message')[0].message).toMatchObject({ text: 'Checked off Reading.', trail: ['Checked off Reading for today'], undo: [] })
    const entries = await env.DB.prepare(`SELECT date, kind FROM habit_entries WHERE deleted_at IS NULL`).all<{ date: string; kind: string }>()
    expect(entries.results).toEqual([{ date: TODAY, kind: 'done' }])
    expect((await handle(request('/v1/assistant/undo', { method: 'POST', body: '{}' }), env)).status).toBe(404)
  })

  it('logs gym sets in order and arranges the day once the card saves', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_g', 'log_gym_sets', {
        date: TODAY, sets: [{ exerciseId: 'ex-bench', weight: 185, reps: 8 }, { exerciseId: 'ex-bench', weight: 185, reps: 6 }]
      }))
      .mockResolvedValueOnce(text('Logged.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'bench 185 x8, x6' }) }), env))
    const pending = find(list, 'pending')[0].pending
    expect(pending.changes?.[0]).toEqual({
      toolName: 'log_gym_sets', title: 'Log 2 sets for today', lines: ['Bench Press: 185 lbs × 8 reps, 185 lbs × 6 reps']
    })
    const saved = await events(await handle(request('/v1/assistant/confirm', {
      method: 'POST', body: JSON.stringify({ chatId: pending.chatId, callId: pending.callId, approved: true, today: TODAY, timeZone: null, units: 'imperial' })
    }), env))
    expect(find(saved, 'trail').map((event) => event.line)).toEqual(['Logged Bench Press 185 lbs × 8 reps, 185 lbs × 6 reps'])
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

describe('writes wait on a card that saves itself', () => {
  const transaction = {
    kind: 'expense', accountId: 'acc-check', categoryId: 'cat-food', amountCents: 4200, date: TODAY, merchant: 'Publix', notes: null,
    receipt: null, fridgeItems: null
  }

  async function pendingTurn(env: Env): Promise<{ chatId: string; callId: string; fetchMock: ReturnType<typeof vi.fn> }> {
    const fetchMock = vi.fn().mockResolvedValueOnce(toolCall('call_m', 'record_transactions', { transactions: [transaction] }, 'Recording that.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: '$42 at Publix' }) }), env))
    const pending = find(list, 'pending')[0]?.pending
    expect(pending).toMatchObject({ toolName: 'record_transactions', title: 'Record a transaction', lines: ['−$42.00 Publix · Food · Checking · today'] })
    expect(find(list, 'message').map((event) => event.message.text)).toEqual(['$42 at Publix', 'Recording that.'])
    return { chatId: find(list, 'chat')[0].chat.id, callId: pending.callId, fetchMock }
  }

  function confirmBody(chatId: string, callId: string, approved: boolean): string {
    return JSON.stringify({ chatId, callId, approved, today: TODAY, timeZone: 'America/New_York', units: 'imperial' })
  }

  it('saves on confirm, then continues the reply', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)
    const before = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chatId}`), env))
    expect(before.data.pending?.callId).toBe(callId)

    fetchMock.mockResolvedValueOnce(text('Recorded $42.00 at Publix.'))
    const list = await events(await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(chatId, callId, true) }), env))
    expect(find(list, 'trail').map((event) => event.line)).toEqual(['Recorded $42.00 Publix'])
    expect(find(list, 'message')[0].message).toMatchObject({ text: 'Recorded $42.00 at Publix.', trail: ['Recorded $42.00 Publix'], undo: [] })
    const saved = await env.DB.prepare('SELECT amount_cents, notes, category_id FROM transactions WHERE deleted_at IS NULL').all<Record<string, unknown>>()
    expect(saved.results).toEqual([{ amount_cents: 4200, notes: 'Publix', category_id: 'cat-food' }])
    const resumed = sentMessages(fetchMock, 1)
    expect(resumed.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_m' })
    expect(String((resumed.at(-1) as { content: string }).content)).toContain('"recorded":1')
    expect((await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(chatId, callId, true) }), env)).status).toBe(409)
    const after = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chatId}`), env))
    expect(after.data.pending).toBeNull()
  })

  it('drops the whole card on Undo without asking the model again', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    const list = await events(await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(chatId, callId, false) }), env))
    expect(find(list, 'message')[0].message).toMatchObject({ role: 'assistant', text: 'Undone. Nothing was saved.' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)
    const status = await env.DB.prepare('SELECT status FROM assistant_tool_calls WHERE call_id = ?').bind(callId).first<{ status: string }>()
    expect(status?.status).toBe('rejected')

    fetchMock.mockResolvedValueOnce(text('Okay.'))
    await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ chatId, text: 'Thanks' }) }), env))
    const tool = sentMessages(fetchMock, 1).find((message) => message.role === 'tool')
    expect(String((tool as { content: string }).content)).toContain('tapped Undo')
  })

  it('saves a card the user wrote past before reading the next message', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    fetchMock.mockResolvedValueOnce(text('Sure.'))
    const list = await events(await handle(request('/v1/assistant/turns', {
      method: 'POST', body: turnBody({ chatId, text: 'And how much this month?', autoSave: true })
    }), env))
    const status = await env.DB.prepare('SELECT status FROM assistant_tool_calls WHERE call_id = ?').bind(callId).first<{ status: string }>()
    expect(status?.status).toBe('succeeded')
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(1)
    const sent = sentMessages(fetchMock, 1)
    expect(String((sent.find((message) => message.role === 'tool') as { content: string }).content)).toContain('"recorded":1')
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'And how much this month?' })
    expect(find(list, 'message').at(-1)?.message.trail).toEqual(['Recorded $42.00 Publix'])
    expect((await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(chatId, callId, true) }), env)).status).toBe(409)
  })

  it('drops the card instead for a build that still says typing drops it', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    fetchMock.mockResolvedValueOnce(text('Sure.'))
    await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ chatId, text: 'Never mind' }) }), env))
    const status = await env.DB.prepare('SELECT status FROM assistant_tool_calls WHERE call_id = ?').bind(callId).first<{ status: string }>()
    expect(status?.status).toBe('rejected')
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)
    const tool = sentMessages(fetchMock, 1).find((message) => message.role === 'tool')
    expect(String((tool as { content: string }).content)).toContain('did not confirm')
  })

  it('never saves a card the Worker before this one left waiting', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    await env.DB.prepare('UPDATE assistant_tool_calls SET card = ? WHERE call_id = ?')
      .bind(JSON.stringify({ title: 'Record this transaction?', lines: [] }), callId).run()
    const history = await payload<AssistantHistory>(await handle(request(`/v1/assistant/messages?chat=${chatId}`), env))
    expect(history.data.pending).toBeNull()
    fetchMock.mockResolvedValueOnce(text('Sure.'))
    await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ chatId, text: 'Hi', autoSave: true }) }), env))
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)
  })

  it('keeps the save running after the phone hangs up', async () => {
    const env = await environment()
    const { chatId, callId, fetchMock } = await pendingTurn(env)
    fetchMock.mockResolvedValueOnce(text('Saved.'))
    const kept: Promise<unknown>[] = []
    const response = await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(chatId, callId, true) }), env, {
      waitUntil: (promise) => { kept.push(promise) }
    })
    expect(kept).toHaveLength(1)
    await response.body?.cancel()
    await Promise.all(kept)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(1)
  })

  it('collects every write in a reply on one card and saves them in order', async () => {
    const env = await environment()
    const fetchMock = vi.fn().mockResolvedValueOnce(sse([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_a', type: 'function', function: { name: 'save_mood', arguments: JSON.stringify({ date: TODAY, mood: 4, note: null }) } },
        { index: 1, id: 'call_b', type: 'function', function: { name: 'log_habit', arguments: JSON.stringify({ habitId: 'habit-read', date: TODAY, times: null }) } }
      ] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
    ])).mockResolvedValueOnce(text('Saved both.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'Mood 4 and I read' }) }), env))
    const pending = find(list, 'pending')[0].pending
    expect(pending.title).toBe('Save 2 changes')
    expect(pending.changes?.map((change) => change.title)).toEqual(['Save mood', 'Check off a habit'])
    expect(pending.lines).toEqual(['Save mood', 'Good for today', 'Check off a habit', 'Reading for today'])
    const saved = await events(await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(pending.chatId, pending.callId, true) }), env))
    expect(find(saved, 'trail').map((event) => event.line)).toEqual(['Saved Good mood for today', 'Checked off Reading for today'])
    const resumed = sentMessages(fetchMock, 1).filter((message) => message.role === 'tool').map((message) => (message as { tool_call_id: string }).tool_call_id)
    expect(resumed).toEqual(['call_a', 'call_b'])
  })

  it('sends an image to the model once and keeps only a note when nothing logs it', async () => {
    const env = await environment()
    const fetchMock = vi.fn().mockResolvedValueOnce(text('I see a Publix receipt for $42.00.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', {
      method: 'POST', body: turnBody({ text: '', image: { base64: 'aGVsbG8=', mimeType: 'image/jpeg' } })
    }), env))
    expect(find(list, 'chat')[0].chat.title).toBe('Photo')
    expect(find(list, 'message')[0].message).toMatchObject({ role: 'user', text: '', hasImage: true })
    const sent = sentMessages(fetchMock, 0)
    expect(JSON.stringify(sent.at(-1))).toContain('data:image/jpeg;base64,aGVsbG8=')
    const stored = await env.DB.prepare(`SELECT payload FROM assistant_messages WHERE role = 'user'`).first<{ payload: string }>()
    expect(stored?.payload).not.toContain('base64,aGVsbG8=')
    expect(stored?.payload).toContain('attached an image')
  })

  it('keeps a meal photo for the entry that asks for it, and deletes it on Undo', async () => {
    const { bucket, objects } = createTestBucket()
    const env = await environment({ DIARY_MEDIA: bucket })
    const meal = {
      name: 'Chicken bowl', date: TODAY, time: '12:30', serving: '1 bowl', calories: 640, protein: 45, carbs: 60, fat: 22, usePhoto: true
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_f', 'log_food', { entries: [meal] }))
      .mockResolvedValueOnce(text('Logged your lunch.'))
      .mockResolvedValueOnce(toolCall('call_f2', 'log_food', { entries: [meal] }))
    vi.stubGlobal('fetch', fetchMock)
    const image = { base64: 'aGVsbG8=', mimeType: 'image/jpeg' }
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'lunch', image }) }), env))
    const pending = find(list, 'pending')[0].pending
    expect(pending.changes?.[0]).toEqual({
      toolName: 'log_food', title: 'Log food', lines: ['Chicken bowl: 640 kcal · P 45 · C 60 · F 22 · 12:30 PM']
    })
    expect([...objects.keys()]).toHaveLength(1)
    await events(await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(pending.chatId, pending.callId, true) }), env))
    const entry = await env.DB.prepare('SELECT name, date, eaten_at, calories, source, photo FROM food_entries').first<Record<string, unknown>>()
    const mediaId = [...objects.keys()][0].replace('food/', '')
    expect(entry).toMatchObject({ name: 'Chicken bowl', date: TODAY, eaten_at: '2026-09-12T16:30:00.000Z', calories: 640, source: 'assistant' })
    expect(JSON.parse(String(entry?.photo))).toEqual({ mediaId, previewId: null, width: null, height: null })

    const second = await events(await handle(request('/v1/assistant/turns', {
      method: 'POST', body: turnBody({ chatId: pending.chatId, text: 'again', image })
    }), env))
    const next = find(second, 'pending')[0].pending
    expect(objects.size).toBe(2)
    await events(await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(next.chatId, next.callId, false) }), env))
    expect(objects.size).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM food_entries').first<{ count: number }>())?.count).toBe(1)
  })

  it('puts the groceries on a receipt in the fridge, linked to the purchase', async () => {
    const env = await environment()
    const receipt = {
      ...transaction,
      receipt: {
        merchant: 'Publix', purchaseDate: TODAY, subtotalCents: 4200, discountCents: 0, taxCents: 0, feesCents: 0, totalCents: 4200,
        items: [
          { name: 'PUB WHL MLK GAL', quantity: 1, unitPriceCents: 450, grossPriceCents: 450, discountCents: 0, lineTotalCents: 450 },
          { name: 'PAPER TOWEL 6PK', quantity: 1, unitPriceCents: 3750, grossPriceCents: 3750, discountCents: 0, lineTotalCents: 3750 }
        ]
      },
      fridgeItems: [{ name: 'Whole milk', icon: '🥛', brand: 'Publix' }]
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(toolCall('call_p', 'record_transactions', { transactions: [receipt] }))
      .mockResolvedValueOnce(text('Recorded.'))
    vi.stubGlobal('fetch', fetchMock)
    const list = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'receipt' }) }), env))
    const pending = find(list, 'pending')[0].pending
    expect(pending.lines).toEqual(['−$42.00 Publix · Food · Checking · today · 2 items', 'Fridge: Whole milk'])
    const saved = await events(await handle(request('/v1/assistant/confirm', { method: 'POST', body: confirmBody(pending.chatId, pending.callId, true) }), env))
    expect(find(saved, 'trail').map((event) => event.line)).toEqual(['Recorded $42.00 Publix and put 1 item in the fridge'])
    const purchase = await env.DB.prepare('SELECT id FROM purchases').first<{ id: string }>()
    const fridge = await env.DB.prepare('SELECT name, icon, brand, source, purchase_id FROM fridge_items').all<Record<string, unknown>>()
    expect(fridge.results).toEqual([{ name: 'Whole milk', icon: '🥛', brand: 'Publix', source: 'receipt', purchase_id: purchase?.id }])
  })
})

describe('chats', () => {
  it('lists, reads, and deletes chats for the device dataset', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn(async () => text('Hi.')))
    const first = await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'First chat' }) }), env))
    await events(await handle(request('/v1/assistant/turns', { method: 'POST', body: turnBody({ text: 'Second chat' }) }), env))
    const chats = await payload<AssistantChatList>(await handle(request('/v1/assistant/chats'), env))
    expect(chats.data.chats.map((chat) => chat.title)).toEqual(['Agent', 'Second chat', 'First chat'])
    expect(chats.data.chats[0].kind).toBe('agent')
    const id = find(first, 'chat')[0].chat.id
    expect((await handle(request(`/v1/assistant/chats/${id}`, { method: 'DELETE' }), env)).status).toBe(200)
    expect((await handle(request(`/v1/assistant/messages?chat=${id}`), env)).status).toBe(404)
    const left = await payload<AssistantChatList>(await handle(request('/v1/assistant/chats'), env))
    expect(left.data.chats.map((chat) => chat.title)).toEqual(['Agent', 'Second chat'])
    const empty = await payload<AssistantHistory>(await handle(request('/v1/assistant/messages'), env))
    expect(empty.data).toEqual({ chat: null, messages: [], pending: null })
  })
})
