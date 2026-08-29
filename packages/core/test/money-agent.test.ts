import { describe, expect, it, vi } from 'vitest'
import { runMoneyAgent, type RunMoneyAgentInput } from '../src/money-agent'

const draft = {
  kind: 'expense' as const,
  counterparty: 'Publix',
  date: '2026-08-29',
  currency: 'USD',
  amountCents: 2500,
  notes: '',
  accountId: 'checking',
  categoryId: 'groceries',
  receipt: null
}

const base: RunMoneyAgentInput = {
  message: 'Add a $25 Publix purchase',
  apiKey: 'key',
  model: 'model',
  today: '2026-08-29',
  accounts: [{ id: 'checking', name: 'Checking' }],
  categories: [{ id: 'groceries', name: 'Groceries', kind: 'expense' }]
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function toolResponse(value: unknown): Response {
  return response(200, {
    choices: [{ message: { tool_calls: [{ function: { name: 'record_transactions', arguments: JSON.stringify(value) } }] } }]
  })
}

describe('money agent', () => {
  it('requires and parses the record_transactions tool call', async () => {
    const fetcher = vi.fn(async () => toolResponse({ transactions: [draft] }))
    await expect(runMoneyAgent(base, fetcher)).resolves.toEqual({ ok: true, data: [draft] })
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(request.tool_choice).toEqual({ type: 'function', function: { name: 'record_transactions' } })
    expect(JSON.stringify(request)).toContain('Today is 2026-08-29')
  })

  it('sends an attached receipt in the user message', async () => {
    const fetcher = vi.fn(async () => toolResponse({ transactions: [draft] }))
    await runMoneyAgent({ ...base, message: '', image: { base64: 'aGVsbG8=', mimeType: 'image/jpeg' } }, fetcher)
    const body = String(fetcher.mock.calls[0][1]?.body)
    expect(body).toContain('data:image/jpeg;base64,aGVsbG8=')
    expect(body).toContain('Read this receipt and prepare the matching purchase.')
  })

  it('rejects a tool call that names an unknown account or mismatched category', async () => {
    const unknownAccount = await runMoneyAgent(base, async () => toolResponse({ transactions: [{ ...draft, accountId: 'savings' }] }))
    expect(unknownAccount).toMatchObject({ ok: false })
    const incomeCategory = [{ id: 'salary', name: 'Salary', kind: 'income' as const }]
    const wrongKind = await runMoneyAgent({ ...base, categories: incomeCategory }, async () =>
      toolResponse({ transactions: [{ ...draft, categoryId: 'salary' }] }))
    expect(wrongKind).toMatchObject({ ok: false })
  })

  it('returns several transactions from one tool call', async () => {
    const second = { ...draft, counterparty: 'Target', amountCents: 4200 }
    await expect(runMoneyAgent(base, async () => toolResponse({ transactions: [draft, second] })))
      .resolves.toEqual({ ok: true, data: [draft, second] })
  })

  it('blocks empty requests before making a network call', async () => {
    const fetcher = vi.fn()
    await expect(runMoneyAgent({ ...base, message: '' }, fetcher)).resolves.toEqual({
      ok: false,
      message: 'Write a message or attach a receipt.'
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
