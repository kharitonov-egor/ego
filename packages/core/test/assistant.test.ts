import { describe, expect, it, vi } from 'vitest'
import { runAssistant, type AssistantEvent, type ModelMessage, type RunAssistantOptions } from '../src/assistant'

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + ': OPENROUTER PROCESSING\n\ndata: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function text(...pieces: string[]): unknown[] {
  return [
    ...pieces.map((piece) => ({ choices: [{ delta: { content: piece } }] })),
    { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 8 } }
  ]
}

function toolCall(id: string, name: string, args: string): unknown[] {
  const [head, tail] = [args.slice(0, Math.ceil(args.length / 2)), args.slice(Math.ceil(args.length / 2))]
  return [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: head } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: tail } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }
  ]
}

function options(overrides: Partial<RunAssistantOptions> = {}): RunAssistantOptions & { events: AssistantEvent[] } {
  const events: AssistantEvent[] = []
  return {
    fetcher: vi.fn(async () => sse(text('Hi'))),
    apiKey: 'key',
    model: 'test/model',
    system: 'You are a test.',
    history: [{ role: 'user', content: 'hello' }],
    run: vi.fn(async () => ({ data: { ok: true }, trail: 'Ran a tool' })),
    onEvent: (event) => { events.push(event) },
    deadline: Date.now() + 60_000,
    events,
    ...overrides
  }
}

function sentMessages(fetcher: ReturnType<typeof vi.fn>, call: number): ModelMessage[] {
  const init = fetcher.mock.calls[call][1] as RequestInit
  return (JSON.parse(String(init.body)) as { messages: ModelMessage[] }).messages
}

describe('runAssistant', () => {
  it('streams the reply and reports usage', async () => {
    const fetcher = vi.fn(async () => sse(text('Hel', 'lo')))
    const input = options({ fetcher })
    const result = await runAssistant(input)
    expect(result).toEqual({ ok: true, reply: 'Hello', pending: [], usage: { inputTokens: 120, outputTokens: 8, modelCalls: 1 } })
    expect(input.events.filter((event) => event.type === 'delta').map((event) => event.type === 'delta' ? event.text : '')).toEqual(['Hel', 'lo'])
    expect(input.events.find((event) => event.type === 'message')).toEqual({ type: 'message', message: { role: 'assistant', content: 'Hello' } })
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body.stream).toBe(true)
    expect(body.model).toBe('test/model')
    const system = sentMessages(fetcher, 0)[0]
    expect(system.role).toBe('system')
    expect(JSON.stringify(system)).toContain('ephemeral')
    expect((body.tools as unknown[]).length).toBeGreaterThan(10)
  })

  it('runs a read tool, feeds the result back, and answers', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse(toolCall('call_1', 'read_mood', JSON.stringify({ from: '2026-09-01', to: '2026-09-07' }))))
      .mockResolvedValueOnce(sse(text('Mostly good.')))
    const run = vi.fn(async () => ({ data: { entries: [{ date: '2026-09-01', mood: 4 }] }, trail: 'Read mood for 7 days' }))
    const input = options({ fetcher, run })
    const result = await runAssistant(input)
    expect(result).toMatchObject({ ok: true, reply: 'Mostly good.', pending: [] })
    expect(result.usage).toEqual({ inputTokens: 220, outputTokens: 28, modelCalls: 2 })
    expect(run).toHaveBeenCalledWith({ name: 'read_mood', args: { from: '2026-09-01', to: '2026-09-07' }, callId: 'call_1' })
    expect(input.events).toContainEqual({ type: 'trail', line: 'Read mood for 7 days' })
    const second = sentMessages(fetcher, 1)
    expect(second[second.length - 2]).toEqual({
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_mood', arguments: JSON.stringify({ from: '2026-09-01', to: '2026-09-07' }) } }]
    })
    expect(second[second.length - 1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: JSON.stringify({ entries: [{ date: '2026-09-01', mood: 4 }] }) })
    const stored = input.events.filter((event) => event.type === 'message')
    expect(stored).toHaveLength(3)
  })

  it('fills nullable fields the model left out before running the tool', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse(toolCall('call_2', 'search_transactions', JSON.stringify({ query: 'Publix' }))))
      .mockResolvedValueOnce(sse(text('Two visits.')))
    const run = vi.fn(async () => ({ data: [], trail: 'Searched transactions' }))
    await runAssistant(options({ fetcher, run }))
    expect(run).toHaveBeenCalledWith({
      name: 'search_transactions',
      args: { query: 'Publix', from: null, to: null, accountId: null, categoryId: null, kind: null, limit: null },
      callId: 'call_2'
    })
  })

  it('stops on a write without running it', async () => {
    const args = { transactions: [{ kind: 'expense', accountId: 'acc', categoryId: 'cat', amountCents: 4200, date: '2026-09-28', merchant: 'Publix', notes: null, receipt: null, fridgeItems: null }] }
    const fetcher = vi.fn(async () => sse([
      { choices: [{ delta: { content: 'Recording that.' } }] },
      ...toolCall('call_3', 'record_transactions', JSON.stringify(args))
    ]))
    const run = vi.fn()
    const input = options({ fetcher, run })
    const result = await runAssistant(input)
    expect(result).toMatchObject({ ok: true, reply: 'Recording that.', pending: [{ callId: 'call_3', name: 'record_transactions', args }] })
    expect(run).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(input.events.filter((event) => event.type === 'message').map((event) => event.type === 'message' ? event.message.role : '')).toEqual(['assistant'])
  })

  it('collects every write in a step and still runs the reads beside them', async () => {
    const money = JSON.stringify({ transactions: [{ kind: 'expense', accountId: 'acc', categoryId: 'cat', amountCents: 100, date: '2026-09-28', merchant: null, notes: null, receipt: null, fridgeItems: null }] })
    const fetcher = vi.fn(async () => sse([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_a', type: 'function', function: { name: 'record_transactions', arguments: money } },
        { index: 1, id: 'call_b', type: 'function', function: { name: 'read_mood', arguments: JSON.stringify({ from: '2026-09-28', to: '2026-09-28' }) } },
        { index: 2, id: 'call_c', type: 'function', function: { name: 'log_habit', arguments: JSON.stringify({ habitId: 'h1', date: '2026-09-28', times: null }) } }
      ] } }] }
    ]))
    const run = vi.fn(async () => ({ data: { entries: [] }, trail: 'Read mood for today' }))
    const input = options({ fetcher, run })
    const result = await runAssistant(input)
    expect(result.ok && result.pending.map((write) => write.callId)).toEqual(['call_a', 'call_c'])
    expect(run).toHaveBeenCalledTimes(1)
    const toolMessages = input.events.filter((event) => event.type === 'message' && event.message.role === 'tool')
    expect(toolMessages.map((event) => event.type === 'message' && event.message.role === 'tool' ? event.message.tool_call_id : '')).toEqual(['call_b'])
  })

  it('tells the model when its arguments are wrong and lets it try again', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse(toolCall('call_4', 'read_mood', JSON.stringify({ from: 'yesterday', to: '2026-09-07' }))))
      .mockResolvedValueOnce(sse(text('Let me rephrase.')))
    const run = vi.fn()
    await runAssistant(options({ fetcher, run }))
    expect(run).not.toHaveBeenCalled()
    const second = sentMessages(fetcher, 1)
    expect(second[second.length - 1]).toMatchObject({ role: 'tool', tool_call_id: 'call_4' })
    expect(String((second[second.length - 1] as { content: string }).content)).toContain('from has the wrong format')
  })

  it('fills nullable fields of a write before handing it back', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(sse(toolCall('call_5', 'log_habit', JSON.stringify({ habitId: 'h1', date: '2026-09-28' }))))
    const run = vi.fn()
    const result = await runAssistant(options({ fetcher, run }))
    expect(run).not.toHaveBeenCalled()
    expect(result.ok && result.pending).toEqual([{ name: 'log_habit', args: { habitId: 'h1', date: '2026-09-28', times: null }, callId: 'call_5' }])
  })

  it('turns a thrown tool error into a result the model can read', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse(toolCall('call_6', 'read_budget', JSON.stringify({ month: '2026-09' }))))
      .mockResolvedValueOnce(sse(text('No budget yet.')))
    const run = vi.fn(async () => { throw new Error('No budget for that month') })
    await runAssistant(options({ fetcher, run }))
    const second = sentMessages(fetcher, 1)
    expect(second[second.length - 1]).toEqual({ role: 'tool', tool_call_id: 'call_6', content: JSON.stringify({ error: 'No budget for that month' }) })
  })

  it('separates text from a second model call with a blank line', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Checking.' } }] }, ...toolCall('call_7', 'list_accounts', '{}')]))
      .mockResolvedValueOnce(sse(text('Two accounts.')))
    const input = options({ fetcher })
    const result = await runAssistant(input)
    expect(result).toMatchObject({ ok: true, reply: 'Checking.\n\nTwo accounts.' })
    const deltas = input.events.filter((event) => event.type === 'delta').map((event) => event.type === 'delta' ? event.text : '')
    expect(deltas.join('')).toBe('Checking.\n\nTwo accounts.')
  })

  it('reads a plain JSON completion when the provider does not stream', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Plain answer.' } }], usage: { prompt_tokens: 5, completion_tokens: 2 }
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const result = await runAssistant(options({ fetcher }))
    expect(result).toEqual({ ok: true, reply: 'Plain answer.', pending: [], usage: { inputTokens: 5, outputTokens: 2, modelCalls: 1 } })
  })

  it('maps upstream statuses to reasons', async () => {
    const unauthorized = await runAssistant(options({ fetcher: vi.fn(async () => new Response('{}', { status: 401 })) }))
    expect(unauthorized).toMatchObject({ ok: false, reason: 'unauthorized' })
    const limited = await runAssistant(options({ fetcher: vi.fn(async () => new Response('{}', { status: 429 })) }))
    expect(limited).toMatchObject({ ok: false, reason: 'rate_limited' })
    const broken = await runAssistant(options({ fetcher: vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Model down' } }), { status: 502 })) }))
    expect(broken).toMatchObject({ ok: false, reason: 'upstream', message: 'Model down' })
    const midStream = await runAssistant(options({ fetcher: vi.fn(async () => sse([{ error: { message: 'Provider overloaded' } }])) }))
    expect(midStream).toMatchObject({ ok: false, reason: 'upstream', message: 'Provider overloaded' })
  })

  it('stops before calling the model once the deadline has passed', async () => {
    const fetcher = vi.fn()
    const result = await runAssistant(options({ fetcher, deadline: Date.now() - 1 }))
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('gives up after too many tool steps', async () => {
    const fetcher = vi.fn(async () => sse(toolCall('call_x', 'list_accounts', '{}')))
    const result = await runAssistant(options({ fetcher, maxModelCalls: 3 }))
    expect(result).toMatchObject({ ok: false, reason: 'steps' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
