import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}))

import { moneyClientFor } from '../lib/money'

function d1Response(queries: Array<{ sql: string }>): Response {
  const results = queries.map((query) => {
    if (query.sql.startsWith('SELECT * FROM accounts')) return {
      success: true,
      results: [{
        id: 'checking', name: 'Checking', kind: 'checking', icon: 'Landmark', color: '#42a5f5',
        opening_balance_cents: 0, opening_date: '2026-01-01', archived_at: null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'
      }]
    }
    if (query.sql.startsWith('SELECT * FROM categories')) return {
      success: true,
      results: [{
        id: 'food', name: 'Food', kind: 'expense', icon: 'Utensils', color: '#f4511e',
        archived_at: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'
      }]
    }
    return { success: true, results: [] }
  })
  return { ok: true, status: 200, json: async () => ({ success: true, result: results }) } as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('mobile D1 money client', () => {
  it('writes a transaction and reloads the snapshot in one D1 request', async () => {
    const requests: Array<Array<{ sql: string }>> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { sql?: string; batch?: Array<{ sql: string }> }
      const queries = body.batch ?? [{ sql: body.sql ?? '' }]
      requests.push(queries)
      return d1Response(queries)
    }))
    const client = moneyClientFor({
      cloudflareAccountId: 'account-latency-test',
      d1DatabaseId: 'database-latency-test',
      d1ApiToken: 'token'
    })

    await expect(client.getSnapshot()).resolves.toMatchObject({ ok: true })
    const beforeWrite = requests.length
    await expect(client.createTransaction({
      kind: 'expense', accountId: 'checking', destinationAccountId: null,
      categoryId: 'food', amountCents: 1250, date: '2026-08-29', notes: 'Lunch'
    })).resolves.toMatchObject({ ok: true })

    expect(requests).toHaveLength(beforeWrite + 1)
    expect(requests.at(-1)?.[0].sql).toContain('INSERT INTO transactions')
    expect(requests.at(-1)).toHaveLength(8)
  })
})
