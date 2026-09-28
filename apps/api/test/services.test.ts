import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MoneyAgentResponse, TrelloCardResponse } from '@ego/api-contracts'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'phone-device-token-that-is-long-enough-aaaaaa'
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
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-a', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: ledger.db, ...overrides }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://ego.example${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...init.headers }
  })
}

const agentBody = {
  message: 'Lunch $12 at Chipotle',
  today: '2026-09-12',
  accounts: [{ id: 'acc-check', name: 'Checking' }],
  categories: [{ id: 'cat-food', name: 'Food', kind: 'expense' }]
}

function toolCall(transactions: unknown[]): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { tool_calls: [{ function: { name: 'record_transactions', arguments: JSON.stringify({ transactions }) } }] } }]
  }), { status: 200 })
}

describe('money agent', () => {
  it('reports a missing server key without calling OpenRouter', async () => {
    const env = await environment()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(request('/v1/agent/money', { method: 'POST', body: JSON.stringify(agentBody) }), env)
    expect(response.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls OpenRouter with the server key and model and returns drafts', async () => {
    const env = await environment({ OPENROUTER_API_KEY: 'server-key', OPENROUTER_MODEL: 'test/model' })
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => toolCall([{
      kind: 'expense', counterparty: 'Chipotle', date: '2026-09-12', currency: 'USD', amountCents: 1200,
      notes: '', accountId: 'acc-check', categoryId: 'cat-food', receipt: null
    }]))
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(request('/v1/agent/money', { method: 'POST', body: JSON.stringify(agentBody) }), env)
    expect(response.status).toBe(200)
    const data = (await payload<MoneyAgentResponse>(response)).data
    expect(data.drafts).toHaveLength(1)
    expect(data.drafts[0].amountCents).toBe(1200)
    const init = fetchMock.mock.calls[0][1]
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-key')
    expect(JSON.parse(String(init?.body)).model).toBe('test/model')
  })

  it('says the server key was rejected rather than pointing at phone settings', async () => {
    const env = await environment({ OPENROUTER_API_KEY: 'revoked' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const response = await handle(request('/v1/agent/money', { method: 'POST', body: JSON.stringify(agentBody) }), env)
    const body = await payload<null>(response)
    expect(response.status).toBe(502)
    expect(body.error?.message).toContain('OPENROUTER_API_KEY')
  })

  it('rejects malformed reference data before spending a model call', async () => {
    const env = await environment({ OPENROUTER_API_KEY: 'server-key' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(request('/v1/agent/money', {
      method: 'POST', body: JSON.stringify({ ...agentBody, categories: [{ id: 'x', name: 'X', kind: 'transfer' }] })
    }), env)
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Trello', () => {
  it('is unavailable until the server holds a key and token', async () => {
    const env = await environment({ TRELLO_API_KEY: 'key' })
    expect((await handle(request('/v1/trello/boards'), env)).status).toBe(503)
  })

  it('lists boards and lists with the server credentials', async () => {
    const env = await environment({ TRELLO_API_KEY: 'key', TRELLO_TOKEN: 'ATTAtoken' })
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/lists') ? [{ id: 'list1', name: 'Inbox' }] : [{ id: 'board1', name: 'Life' }]
    ), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const boards = await handle(request('/v1/trello/boards'), env)
    expect((await payload<unknown[]>(boards)).data).toEqual([{ id: 'board1', name: 'Life' }])
    const lists = await handle(request('/v1/trello/boards/board1/lists'), env)
    expect((await payload<unknown[]>(lists)).data).toEqual([{ id: 'list1', name: 'Inbox' }])
    expect(String(fetchMock.mock.calls[0][0])).toContain('token=ATTAtoken')
    expect((await handle(request('/v1/trello/boards/..%2Fx/lists'), env)).status).toBe(400)
  })

  it('creates a card and forwards an attachment', async () => {
    const env = await environment({ TRELLO_API_KEY: 'key', TRELLO_TOKEN: 'ATTAtoken' })
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(
      url.includes('/attachments') ? {} : { id: 'card1', shortUrl: 'https://trello.com/c/abc' }
    ), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const created = await handle(request('/v1/trello/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Buy milk', description: '', listId: 'list1' })
    }), env)
    expect((await payload<TrelloCardResponse>(created)).data).toEqual({ id: 'card1', shortUrl: 'https://trello.com/c/abc' })
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'shot.png')
    const attached = await handle(request('/v1/trello/cards/card1/attachments', { method: 'POST', body: form }), env)
    expect(attached.status).toBe(200)
    const forwarded = fetchMock.mock.calls[1]
    expect(String(forwarded[0])).toContain('/cards/card1/attachments')
    expect(forwarded[1]?.body).toBeInstanceOf(FormData)
  })
})
