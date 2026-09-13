import { afterEach, describe, expect, it } from 'vitest'
import type { TransactionPage } from '@ego/api-contracts'
import { hashToken } from '../src/auth'
import { handle } from '../src/router'
import { NOW, addTransaction, exec, expense, operation, seedLedger, type Ledger } from './helpers'

const TOKEN = 'device-token-that-is-long-enough-0123456789'

let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

async function withDevice(revoked = false): Promise<Ledger> {
  const seeded = await seedLedger()
  await exec(seeded.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at, revoked_at)
    VALUES ('device-1', 'Phone', ?, 'ego-money', ?, ?)`,
  [await hashToken(TOKEN), NOW, revoked ? NOW : null])
  return seeded
}

function request(path: string, init: RequestInit & { token?: string | null } = {}): Request {
  const { token = TOKEN, ...rest } = init
  const headers = new Headers(rest.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  return new Request(`https://ego.example${path}`, { ...rest, headers })
}

async function body<T>(response: Response): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  return response.json()
}

describe('device authorization', () => {
  it('answers the health check without a credential', async () => {
    ledger = await withDevice()
    const response = await handle(request('/v1/health', { token: null }), { DB: ledger.db })
    expect(response.status).toBe(200)
  })

  it('refuses a request without a credential', async () => {
    ledger = await withDevice()
    const response = await handle(request('/v1/reference', { token: null }), { DB: ledger.db })
    expect(response.status).toBe(401)
    expect((await body(response)).error?.code).toBe('AUTH_REQUIRED')
  })

  it('refuses a revoked device and an unknown token', async () => {
    ledger = await withDevice(true)
    expect((await handle(request('/v1/reference'), { DB: ledger.db })).status).toBe(401)
    expect((await handle(request('/v1/reference', { token: 'a'.repeat(40) }), { DB: ledger.db })).status).toBe(401)
  })

  it('serves reference data to an enrolled device', async () => {
    ledger = await withDevice()
    const response = await handle(request('/v1/reference'), { DB: ledger.db })
    expect(response.status).toBe(200)
    const payload = await body<{ accounts: unknown[]; categories: unknown[] }>(response)
    expect(payload.data?.accounts).toHaveLength(3)
    expect(payload.data?.categories).toHaveLength(2)
  })

  it('records when the device was last seen', async () => {
    ledger = await withDevice()
    await handle(request('/v1/reference'), { DB: ledger.db })
    const rows = await ledger.db.prepare('SELECT last_seen_at FROM devices').all<{ last_seen_at: string | null }>()
    expect(rows.results?.[0]?.last_seen_at).not.toBeNull()
  })
})

describe('routes', () => {
  it('pages transactions and keeps the response bounded', async () => {
    ledger = await withDevice()
    for (let index = 0; index < 60; index += 1) {
      await addTransaction(ledger, expense(`tx-${String(index).padStart(4, '0')}`, '2026-09-12', 100 + index))
    }
    const response = await handle(request('/v1/transactions'), { DB: ledger.db })
    const payload = await body<TransactionPage>(response)
    expect(payload.data?.items).toHaveLength(50)
    expect(payload.data?.hasMore).toBe(true)
    expect(payload.data?.nextCursor).toBeTruthy()
    const next = await handle(
      request(`/v1/transactions?cursor=${encodeURIComponent(payload.data?.nextCursor ?? '')}`), { DB: ledger.db })
    expect((await body<TransactionPage>(next)).data?.items).toHaveLength(10)
  })

  it('rejects a cursor that belongs to a different search', async () => {
    ledger = await withDevice()
    await addTransaction(ledger, expense('tx-1', '2026-09-12', 100))
    await addTransaction(ledger, expense('tx-2', '2026-09-11', 100))
    const first = await body<TransactionPage>(await handle(
      request('/v1/transactions?limit=1'), { DB: ledger.db }))
    expect(first.data?.nextCursor).toBeTruthy()
    const mismatched = await handle(
      request(`/v1/transactions?limit=1&search=coffee&cursor=${encodeURIComponent(first.data?.nextCursor ?? '')}`),
      { DB: ledger.db })
    expect(mismatched.status).toBe(400)
  })

  it('rejects an invalid date filter', async () => {
    ledger = await withDevice()
    expect((await handle(request('/v1/transactions?from=yesterday'), { DB: ledger.db })).status).toBe(400)
    expect((await handle(request('/v1/summary?from=2026-13-01'), { DB: ledger.db })).status).toBe(400)
  })

  it('applies operations over HTTP', async () => {
    ledger = await withDevice()
    const response = await handle(request('/v1/operations', {
      method: 'POST',
      body: JSON.stringify({ operations: [operation()] })
    }), { DB: ledger.db })
    expect(response.status).toBe(200)
    const payload = await body<{ results: Array<{ status: string }>; failed: unknown }>(response)
    expect(payload.data?.results[0].status).toBe('applied')
    expect(payload.data?.failed).toBeNull()
  })

  it('refuses a malformed operation body', async () => {
    ledger = await withDevice()
    const response = await handle(request('/v1/operations', {
      method: 'POST',
      body: JSON.stringify({ operations: [{ operationId: 'op-1' }] })
    }), { DB: ledger.db })
    expect(response.status).toBe(400)
  })

  it('answers an unknown path with not found', async () => {
    ledger = await withDevice()
    expect((await handle(request('/v1/unknown'), { DB: ledger.db })).status).toBe(404)
  })

  it('still serves the legacy snapshot for desktop', async () => {
    ledger = await withDevice()
    await addTransaction(ledger, expense('tx-1', '2026-09-12', 4220))
    const payload = await body<{ accounts: Array<{ balanceCents: number }>; transactions: unknown[] }>(
      await handle(request('/v1/legacy/snapshot'), { DB: ledger.db }))
    expect(payload.data?.transactions).toHaveLength(1)
    expect(payload.data?.accounts[0].balanceCents).toBe(10000 - 4220)
  })
})
