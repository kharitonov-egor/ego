import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashToken, type Env } from '../src/auth'
import { buildLiveSessionConfig, LIVE_SESSION_CONFIG, MAX_LIVE_SDP_LENGTH } from '../src/live'
import { DEFAULT_LIVE_PREFERENCES, type LivePreferences } from '@ego/core'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'desktop-device-token-that-is-long-enough-0123'
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n'

let ledger: Ledger | null = null

afterEach(() => {
  vi.unstubAllGlobals()
  ledger?.close()
  ledger = null
})

async function environment(options: { revoked?: boolean; key?: string } = {}): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, revoked_at)
    VALUES ('desktop-1', 'Desktop', ?, 'ego-money', ?, ?)`, [
    await hashToken(TOKEN), NOW, options.revoked ? NOW : null
  ])
  return { DB: ledger.db, OPENAI_API_KEY: options.key ?? 'server-openai-key' }
}

function request(body: unknown, token: string | null = TOKEN): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request('https://ego.example/v1/live/sessions', {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

async function payload(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>
}

describe('POST /v1/live/sessions', () => {
  it('requires a current device credential', async () => {
    const env = await environment()
    expect((await handle(request({ sdp: SDP }, null), env)).status).toBe(401)
    ledger?.close()
    ledger = null
    const revokedEnv = await environment({ revoked: true })
    expect((await handle(request({ sdp: SDP }), revokedEnv)).status).toBe(401)
  })

  it('requires the Worker OpenAI secret', async () => {
    const env = await environment()
    delete env.OPENAI_API_KEY
    const response = await handle(request({ sdp: SDP }), env)
    expect(response.status).toBe(503)
    expect((await payload(response)).error).toEqual({
      code: 'NOT_CONFIGURED', message: 'Voice service is not configured'
    })
  })

  it.each([
    ['invalid JSON', '{'],
    ['missing SDP', {}],
    ['empty SDP', { sdp: '   ' }],
    ['oversized SDP', { sdp: 'x'.repeat(MAX_LIVE_SDP_LENGTH + 1) }],
    ['invalid settings', { sdp: SDP, settings: { ...DEFAULT_LIVE_PREFERENCES, voice: 'unknown' } }]
  ])('rejects %s', async (_label, body) => {
    const env = await environment()
    const response = await handle(request(body), env)
    expect(response.status).toBe(400)
    expect((await payload(response)).error.code).toBe('INVALID_REQUEST')
  })

  it('sends the fixed Live and Responses configuration and forwards only the answer', async () => {
    const env = await environment()
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      session: { id: 'live_123', expires_at: 12345, model: 'gpt-live-1' },
      transport: { type: 'webrtc', sdp: 'answer-sdp' }
    }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await handle(request({ sdp: SDP }), env)
    expect(response.status).toBe(201)
    expect(await payload(response)).toEqual({ sessionId: 'live_123', sdp: 'answer-sdp' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/live/sessions')
    expect(init?.headers).toEqual({
      authorization: 'Bearer server-openai-key',
      'content-type': 'application/json'
    })
    expect(JSON.parse(String(init?.body))).toEqual({
      session: LIVE_SESSION_CONFIG,
      transport: { type: 'webrtc', sdp: SDP }
    })
  })

  it('maps validated preferences into the server-controlled session configuration', async () => {
    const env = await environment()
    const preferences: LivePreferences = {
      voice: 'coral',
      answerDetail: 'high',
      reasoningEffort: 'xhigh',
      webSearch: 'required',
      maxOutputTokens: 1536,
      customInstructions: 'Speak slowly and define acronyms.'
    }
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      session: { id: 'live_custom' }, transport: { sdp: 'answer-sdp' }
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await handle(request({ sdp: SDP, settings: preferences }), env)
    expect(response.status).toBe(201)
    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      session: buildLiveSessionConfig(preferences),
      transport: { type: 'webrtc', sdp: SDP }
    })
    expect(JSON.stringify(JSON.parse(String(init?.body)))).toContain('cannot read Ego data')
  })

  it('adds enabled Ego functions with strict schemas and leaves Trello cards to the Inbox', async () => {
    const env = await environment()
    const preferences: LivePreferences = {
      ...DEFAULT_LIVE_PREFERENCES,
      tools: {
        readGmail: false,
        readGoogleDrive: false,
        readWispr: false,
        readEgoMoney: true,
        recordEgoTransactions: true,
        createTrelloCards: true
      }
    }
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({
      session: { id: 'live_tools', expires_at: 1_900_000_000 }, transport: { sdp: 'answer-sdp' }
    }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const response = await handle(request({
      sdp: SDP,
      settings: preferences,
      trello: { boardId: 'board123', listId: 'list123' }
    }), env)
    expect(response.status).toBe(201)
    const [, init] = fetchMock.mock.calls[0]!
    interface SentTool {
      type: string
      name: string
      strict: boolean
      parameters: { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> }
    }
    const sent = JSON.parse(String(init?.body)) as { session: { delegation: { responses: { tools: SentTool[] } } } }
    const functions = sent.session.delegation.responses.tools.filter((tool) => tool.type === 'function')
    expect(functions.map((tool) => tool.name)).toEqual([
      'ego_get_summary', 'ego_list_accounts', 'ego_get_budget', 'ego_search_transactions',
      'ego_get_transaction', 'ego_record_transaction'
    ])
    for (const tool of functions) {
      expect(tool.strict).toBe(true)
      expect(tool.parameters.additionalProperties).toBe(false)
      expect(new Set(tool.parameters.required)).toEqual(new Set(Object.keys(tool.parameters.properties)))
    }
    const stored = await env.DB.prepare(`SELECT enabled_tools FROM live_tool_sessions
      WHERE openai_session_id = 'live_tools'`).first<{ enabled_tools: string }>()
    expect(JSON.parse(stored?.enabled_tools ?? '[]')).not.toContain('trello_create_card')
  })

  it('maps rate limits without returning the upstream body', async () => {
    const env = await environment()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'secret upstream detail', request_id: 'req_123' } }),
      { status: 429 }
    )))
    const response = await handle(request({ sdp: SDP }), env)
    expect(response.status).toBe(429)
    expect(JSON.stringify(await payload(response))).not.toContain('secret upstream detail')
  })

  it('sanitizes upstream and malformed success failures', async () => {
    const env = await environment()
    for (const upstream of [
      new Response('OpenAI internals', { status: 500 }),
      new Response(JSON.stringify({ session: { id: 'live_123' } }), { status: 201 })
    ]) {
      vi.stubGlobal('fetch', vi.fn(async () => upstream))
      const response = await handle(request({ sdp: SDP }), env)
      expect(response.status).toBe(502)
      expect(await payload(response)).toEqual({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Voice session creation failed' }
      })
    }
  })
})
