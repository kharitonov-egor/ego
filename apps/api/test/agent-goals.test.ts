import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentFireResult, AgentGoal, AgentGoalList, AgentInbox, AgentKeyCreated, AgentNotificationPage, AgentRunList, AgentSettingsView,
  AssistantChatList, AssistantHistory, AssistantMessage, AssistantStreamEvent
} from '@ego/api-contracts'
import { runScheduledAgent } from '../src/agent-cron'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-goals1'
const API = 'https://ego.example'
const ROUTINE = 'https://api.anthropic.com/v1/claude_code/routines/trig_test/fire'
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

async function environment(overrides: Partial<Env> = {}): Promise<Env> {
  ledger = await seedLedger()
  const db = ledger.db
  await exec(db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at) VALUES ('device-a', 'Phone', ?, 'ego', ?)`,
    [await hashToken(TOKEN), NOW])
  await exec(db, `INSERT INTO habits (id, name, icon, kind, start_date, position, target, period, created_at, updated_at, revision)
    VALUES ('habit-read', 'Reading', '📚', 'build', '2026-09-01', 0, 1, 'day', ?, ?, 1)`, [NOW, NOW])
  await exec(db, `INSERT INTO agent_settings (dataset_id, settings, updated_at) VALUES ('ego', ?, ?)`,
    [JSON.stringify({ timeZone: 'America/New_York', units: 'imperial' }), NOW])
  return { DB: db, OPENROUTER_API_KEY: 'server-key', AGENT_ROUTINE_URL: ROUTINE, AGENT_ROUTINE_TOKEN: 'sk-ant-oat01-test', ...overrides }
}

async function call<T>(env: Env, path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope<T> }> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  headers.set('content-type', 'application/json')
  const response = await handle(new Request(`${API}${path}`, { ...init, headers }), env)
  return { status: response.status, body: await response.json() as Envelope<T> }
}

async function mcpKey(env: Env): Promise<string> {
  return (await call<AgentKeyCreated>(env, '/v1/agent/keys', { method: 'POST', body: '{}' })).body.data.token
}

async function tool<T>(env: Env, key: string, name: string, args: unknown): Promise<{ data: T; isError: boolean; text: string }> {
  const response = await handle(new Request(`${API}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  }), env)
  const reply = await response.json() as { result: { content: Array<{ text: string }>; isError: boolean } }
  const text = reply.result.content[0].text
  let data: unknown = null
  try { data = JSON.parse(text) } catch { data = null }
  return { data: data as T, isError: reply.result.isError, text }
}

function routineFetch() {
  return vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url === ROUTINE) {
      return new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_id: 'session_1', claude_code_session_url: 'https://claude.ai/code/session_1' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  })
}

const daily = { title: 'Morning brief', instructions: 'Tell me what my day looks like.', trigger: { type: 'daily', time: '07:00' } }

describe('standing goals', () => {
  it('adds, pauses, resumes, edits, and deletes goals with the next run on the user clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    const env = await environment()
    const created = await call<AgentGoal>(env, '/v1/agent/goals', { method: 'POST', body: JSON.stringify(daily) })
    expect(created.status).toBe(200)
    expect(created.body.data).toMatchObject({ title: 'Morning brief', status: 'active', timeZone: 'America/New_York', nextRunAt: '2026-10-08T11:00:00.000Z' })
    const id = created.body.data.id

    const paused = await call<AgentGoal>(env, `/v1/agent/goals/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) })
    expect(paused.body.data.status).toBe('paused')
    const moved = await call<AgentGoal>(env, `/v1/agent/goals/${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'active', trigger: { type: 'weekly', weekday: 7, time: '18:00' } })
    })
    expect(moved.body.data).toMatchObject({ status: 'active', nextRunAt: '2026-10-11T22:00:00.000Z' })

    const bad = await call(env, '/v1/agent/goals', { method: 'POST', body: JSON.stringify({ ...daily, trigger: { type: 'daily', time: '7am' } }) })
    expect(bad.status).toBe(400)
    const past = await call(env, '/v1/agent/goals', { method: 'POST', body: JSON.stringify({ ...daily, trigger: { type: 'once', date: '2026-10-01', time: '09:00' } }) })
    expect(past.body.error?.message).toContain('already passed')

    expect((await call<AgentGoalList>(env, '/v1/agent/goals')).body.data.goals).toHaveLength(1)
    expect((await call(env, `/v1/agent/goals/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await call<AgentGoalList>(env, '/v1/agent/goals')).body.data.goals).toEqual([])
  })

  it('queues a timed goal half an hour early, fires the routine once, and moves to the next day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
    const env = await environment()
    const goal = (await call<AgentGoal>(env, '/v1/agent/goals', { method: 'POST', body: JSON.stringify(daily) })).body.data
    const fetchMock = routineFetch()
    vi.stubGlobal('fetch', fetchMock)

    await runScheduledAgent(env, new Date('2026-10-08T10:15:00Z'))
    expect(fetchMock).not.toHaveBeenCalled()
    await runScheduledAgent(env, new Date('2026-10-08T10:30:00Z'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ROUTINE)
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-ant-oat01-test')
    expect(headers['anthropic-beta']).toBe('experimental-cc-routine-2026-04-01')

    const runs = (await call<AgentRunList>(env, `/v1/agent/runs?goal=${goal.id}`)).body.data.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ reason: 'schedule', status: 'queued', deliverAt: '2026-10-08T11:00:00.000Z', sessionUrl: 'https://claude.ai/code/session_1' })
    expect(String(JSON.parse(String(init.body)).text)).toContain(runs[0].id)

    await runScheduledAgent(env, new Date('2026-10-08T10:45:00Z'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const goals = (await call<AgentGoalList>(env, '/v1/agent/goals')).body.data.goals
    expect(goals[0].nextRunAt).toBe('2026-10-09T11:00:00.000Z')
  })

  it('reports a missing routine and a rejected token in settings', async () => {
    const env = await environment({ AGENT_ROUTINE_URL: undefined })
    const goal = (await call<AgentGoal>(env, '/v1/agent/goals', { method: 'POST', body: JSON.stringify(daily) })).body.data
    const fired = await call<AgentFireResult>(env, `/v1/agent/goals/${goal.id}/run`, { method: 'POST', body: '{}' })
    expect(fired.body.data).toMatchObject({ fired: false, runs: 1 })
    expect(fired.body.data.error).toContain('AGENT_ROUTINE_URL')

    const configured = await environment()
    const again = (await call<AgentGoal>(configured, '/v1/agent/goals', { method: 'POST', body: JSON.stringify(daily) })).body.data
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const rejected = await call<AgentFireResult>(configured, `/v1/agent/goals/${again.id}/run`, { method: 'POST', body: '{}' })
    expect(rejected.body.data.error).toContain('rejected its token')
    const view = await call<AgentSettingsView>(configured, '/v1/agent/settings')
    expect(view.body.data.routine).toMatchObject({ configured: true, lastError: expect.stringContaining('rejected') })
  })
})

describe('the routine over MCP', () => {
  async function startedRun(env: Env): Promise<{ key: string; runId: string; goalId: string }> {
    vi.stubGlobal('fetch', routineFetch())
    const goal = (await call<AgentGoal>(env, '/v1/agent/goals', { method: 'POST', body: JSON.stringify({ ...daily, trigger: { type: 'manual' } }) })).body.data
    await call(env, `/v1/agent/goals/${goal.id}/run`, { method: 'POST', body: '{}' })
    const key = await mcpKey(env)
    const runs = (await call<AgentRunList>(env, '/v1/agent/runs')).body.data.runs
    return { key, runId: runs[0].id, goalId: goal.id }
  }

  it('starts runs with the playbook, posts a message, and finishes the run', async () => {
    const env = await environment()
    const { key, runId, goalId } = await startedRun(env)
    const other = await tool<{ runs: unknown[] }>(env, key, 'start_runs', { runIds: ['not-a-run'] })
    expect(other.data.runs).toEqual([])
    const started = await tool<{ playbook: string; runs: Array<{ runId: string; title: string; instructions: string }>; today: string }>(env, key, 'start_runs', { runIds: [runId] })
    expect(started.data.playbook).toContain('finish_run')
    expect(started.data.runs).toEqual([expect.objectContaining({ runId, title: 'Morning brief', instructions: 'Tell me what my day looks like.' })])
    expect((await tool<{ runs: unknown[] }>(env, key, 'start_runs', { runIds: null })).data.runs).toEqual([])

    const sent = await tool<{ sent: boolean }>(env, key, 'send_message', { runId, text: 'Two meetings today, the first at 10.', urgent: false })
    expect(sent.data.sent).toBe(true)
    const finished = await tool<{ status: string }>(env, key, 'finish_run', { runId, outcome: 'succeeded', summary: 'Sent the day plan' })
    expect(finished.data.status).toBe('succeeded')

    const chats = (await call<AssistantChatList>(env, '/v1/assistant/chats')).body.data.chats
    expect(chats[0]).toMatchObject({ kind: 'agent', title: 'Agent' })
    const history = (await call<AssistantHistory>(env, `/v1/assistant/messages?chat=${chats[0].id}`)).body.data
    expect(history.messages.map((message) => message.text)).toEqual(['Two meetings today, the first at 10.'])
    expect(history.messages[0].agent).toEqual({ goalId, goalTitle: 'Morning brief' })
    const goal = (await call<AgentGoalList>(env, '/v1/agent/goals')).body.data.goals[0]
    expect(goal).toMatchObject({ lastSummary: 'Sent the day plan', status: 'active' })
    expect((await call(env, `/v1/assistant/chats/${chats[0].id}`, { method: 'DELETE' })).status).toBe(400)
  })

  it('applies trusted changes at once and holds the rest for Confirm', async () => {
    const env = await environment()
    const { key, runId } = await startedRun(env)
    await tool(env, key, 'start_runs', { runIds: [runId] })
    const habit = await tool<{ applied: Array<{ tool: string; failed: boolean }>; proposalId: string | null }>(env, key, 'log_habit', { habitId: 'habit-read', date: '2026-10-07', times: null })
    expect(habit.data.applied).toEqual([expect.objectContaining({ tool: 'log_habit', failed: false })])
    expect(habit.data.proposalId).toBeNull()
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM habit_entries').first<{ count: number }>())?.count).toBe(1)

    const transaction = { kind: 'expense', accountId: 'acc-check', categoryId: 'cat-food', amountCents: 1599, date: '2026-10-07', merchant: 'Netflix', notes: null, receipt: null, fridgeItems: null }
    const money = await tool<{ proposalId: string; waiting: number }>(env, key, 'record_transactions', { transactions: [transaction] })
    expect(money.data.waiting).toBe(1)
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(0)

    const inbox = (await call<AgentInbox>(env, '/v1/agent/inbox')).body.data
    expect(inbox.proposals).toBe(1)
    const history = (await call<AssistantHistory>(env, `/v1/assistant/messages?chat=${inbox.chatId}`)).body.data
    expect(history.proposals).toEqual([expect.objectContaining({
      id: money.data.proposalId, goalTitle: 'Morning brief', title: 'Record a transaction',
      changes: [{ toolName: 'record_transactions', title: 'Record a transaction', lines: ['−$15.99 Netflix · Food · Checking · today'] }]
    })])

    const saved = await call<{ message: AssistantMessage }>(env, `/v1/agent/proposals/${money.data.proposalId}`, { method: 'POST', body: JSON.stringify({ approved: true }) })
    expect(saved.body.data.message.text).toBe('Saved: Record a transaction')
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(1)
    const twice = await call(env, `/v1/agent/proposals/${money.data.proposalId}`, { method: 'POST', body: JSON.stringify({ approved: true }) })
    expect(twice.status).toBe(409)

    const second = await tool<{ proposalId: string }>(env, key, 'record_transactions', { transactions: [{ ...transaction, amountCents: 999 }] })
    const rejected = await call<{ message: AssistantMessage }>(env, `/v1/agent/proposals/${second.data.proposalId}`, { method: 'POST', body: JSON.stringify({ approved: false }) })
    expect(rejected.body.data.message.text).toBe('Rejected: Record a transaction')
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM transactions').first<{ count: number }>())?.count).toBe(1)
  })

  it('expires proposals nobody answered and keeps them out of the chat card flow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T16:00:00Z'))
    const env = await environment()
    const key = await mcpKey(env)
    const transaction = { kind: 'expense', accountId: 'acc-check', categoryId: 'cat-food', amountCents: 500, date: '2026-10-07', merchant: 'Cafe', notes: null, receipt: null, fridgeItems: null }
    await tool(env, key, 'record_transactions', { transactions: [transaction] })
    await runScheduledAgent(env, new Date('2026-10-13T16:00:00Z'))
    expect((await call<AgentInbox>(env, '/v1/agent/inbox')).body.data.proposals).toBe(1)
    await runScheduledAgent(env, new Date('2026-10-14T16:01:00Z'))
    const inbox = (await call<AgentInbox>(env, '/v1/agent/inbox')).body.data
    expect(inbox.proposals).toBe(0)
    const history = (await call<AssistantHistory>(env, `/v1/assistant/messages?chat=${inbox.chatId}`)).body.data
    expect(history.messages.map((message) => message.text)).toEqual(['Expired without an answer: Record a transaction'])
  })
})

describe('notifications', () => {
  it('holds messages in quiet hours, lets urgent ones through, and pages after a cursor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T03:30:00Z'))
    const env = await environment()
    const key = await mcpKey(env)
    const start = (await call<AgentNotificationPage>(env, '/v1/agent/notifications')).body.data
    expect(start.notifications).toEqual([])
    expect(start.cursor).toBe('2026-10-08T03:30:00.000Z|')
    expect(start.devices).toEqual({ phone: true, desktop: true, web: true })

    await tool(env, key, 'send_message', { runId: null, text: 'Your card was charged twice', urgent: false })
    await tool(env, key, 'send_message', { runId: null, text: 'The server is down', urgent: true })
    const first = await call<AgentNotificationPage>(env, `/v1/agent/notifications?after=${encodeURIComponent(start.cursor ?? '')}`)
    const page = first.body.data
    expect(page.notifications.map((item) => [item.body, item.deliverAt, item.silent]).sort()).toEqual([
      ['The server is down', '2026-10-08T03:30:00.000Z', false],
      ['Your card was charged twice', '2026-10-08T12:00:00.000Z', false]
    ])
    const later = (await call<AgentNotificationPage>(env, `/v1/agent/notifications?after=${encodeURIComponent(page.cursor ?? '')}`)).body.data
    expect(later.notifications).toEqual([])

    const unread = (await call<AgentInbox>(env, '/v1/agent/inbox')).body.data
    expect(unread.unread).toBe(2)
    expect((await call<AgentInbox>(env, '/v1/agent/inbox/read', { method: 'POST', body: '{}' })).body.data.unread).toBe(0)
  })

  it('saves settings and keeps only write tools as trusted', async () => {
    const env = await environment()
    const saved = await call<AgentSettingsView>(env, '/v1/agent/settings', {
      method: 'PUT',
      body: JSON.stringify({
        quietStart: '23:00', quietEnd: '07:30', dailyCap: 3, devices: { phone: true, desktop: false, web: true }, proposalDays: 3,
        trusted: ['log_habit', 'read_mood', 'remember', 'nonsense', 'save_mood']
      })
    })
    expect(saved.body.data.settings).toEqual({
      quietStart: '23:00', quietEnd: '07:30', dailyCap: 3, devices: { phone: true, desktop: false, web: true }, proposalDays: 3,
      trusted: ['log_habit', 'save_mood']
    })
    expect(saved.body.data.timeZone).toBe('America/New_York')
    expect((await call(env, '/v1/agent/settings', { method: 'PUT', body: JSON.stringify({ quietStart: 'late' }) })).status).toBe(400)
  })
})

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('the chat hands work to the agent', () => {
  it('puts delegate_task on a card, then queues the run and wakes the routine when it saves', async () => {
    const env = await environment()
    const routine = routineFetch()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === ROUTINE) return routine(url)
      const body = JSON.parse(String(init?.body)) as { messages: unknown[] }
      return body.messages.length <= 2
        ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_d', type: 'function', function: { name: 'delegate_task', arguments: JSON.stringify({ title: 'Flights to NYC', instructions: 'Find the cheapest flight to New York next weekend.' }) } }] } }] }])
        : sse([{ choices: [{ delta: { content: 'The agent will post it in the Agent chat.' } }] }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const turn = await handle(new Request(`${API}/v1/assistant/turns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: null, text: 'Find me a cheap flight to NYC next weekend', today: '2026-10-07', timeZone: 'America/New_York', units: 'imperial' })
    }), env)
    const events = (await turn.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as AssistantStreamEvent)
    const pending = events.find((event): event is Extract<AssistantStreamEvent, { type: 'pending' }> => event.type === 'pending')?.pending
    expect(pending?.changes).toEqual([{ toolName: 'delegate_task', title: 'Hand this to the agent', lines: ['Flights to NYC', 'Find the cheapest flight to New York next weekend.'] }])

    const confirm = await handle(new Request(`${API}/v1/assistant/confirm`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: pending?.chatId, callId: pending?.callId, approved: true, today: '2026-10-07', timeZone: 'America/New_York', units: 'imperial' })
    }), env)
    const saved = (await confirm.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line) as AssistantStreamEvent)
    expect(saved.some((event) => event.type === 'trail' && event.line === 'The agent is on it: Flights to NYC')).toBe(true)
    expect(routine).toHaveBeenCalledTimes(1)
    const runs = (await call<AgentRunList>(env, '/v1/agent/runs')).body.data.runs
    expect(runs[0]).toMatchObject({ reason: 'delegate', goalTitle: 'Flights to NYC' })
  })

  it('keeps the agent posts in the model context when the user replies in the Agent chat', async () => {
    const env = await environment()
    const key = await mcpKey(env)
    await tool(env, key, 'send_message', { runId: null, text: 'Rent is due Friday.', urgent: true })
    const chatId = (await call<AgentInbox>(env, '/v1/agent/inbox')).body.data.chatId
    const fetchMock = vi.fn(async () => sse([{ choices: [{ delta: { content: 'Noted.' } }] }]))
    vi.stubGlobal('fetch', fetchMock)
    await (await handle(new Request(`${API}/v1/assistant/turns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, text: 'Thanks, remind me Thursday', today: '2026-10-07', timeZone: 'America/New_York', units: 'imperial' })
    }), env)).text()
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { messages: Array<{ role: string; content: unknown }> }
    expect(sent.messages.slice(1).map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(sent.messages[2].content).toBe('Rent is due Friday.')
  })
})
