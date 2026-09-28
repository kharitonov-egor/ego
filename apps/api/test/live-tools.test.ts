import { afterEach, describe, expect, it } from 'vitest'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'desktop-device-token-that-is-long-enough-tools'
let ledger: Ledger | null = null

afterEach(() => {
  ledger?.close()
  ledger = null
})

async function environment(): Promise<Env> {
  ledger = await seedLedger()
  await exec(ledger.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-tools', 'Desktop', ?, 'ego-money', ?)`, [await hashToken(TOKEN), NOW])
  await exec(ledger.db, `INSERT INTO live_tool_sessions
    (openai_session_id, device_id, dataset_id, enabled_tools, created_at, expires_at)
    VALUES ('live-tools', 'device-tools', 'ego-money', ?, ?, '2099-01-01T00:00:00.000Z')`, [
    JSON.stringify(['ego_list_accounts', 'ego_record_transaction']), NOW
  ])
  return { DB: ledger.db }
}

function toolRequest(body: unknown): Request {
  return new Request('https://ego.example/v1/live/tools/execute', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}

describe('POST /v1/live/tools/execute', () => {
  it('rejects unknown properties before a read runs', async () => {
    const env = await environment()
    const response = await handle(toolRequest({
      sessionId: 'live-tools', callId: 'read-1', toolName: 'ego_list_accounts',
      arguments: { secret: true }
    }), env)
    expect(response.status).toBe(400)
    expect((await response.json() as any).error.code).toBe('INVALID_TOOL_ARGUMENTS')
  })

  it('requires visible approval and makes write call IDs idempotent', async () => {
    const env = await environment()
    const base = {
      sessionId: 'live-tools', callId: 'write-1', toolName: 'ego_record_transaction',
      arguments: {
        kind: 'expense', accountId: 'acc-check', categoryId: 'cat-food', amountCents: 725,
        date: '2026-09-15', merchant: 'Cafe', destinationAccountId: null, notes: null
      }
    }
    expect((await handle(toolRequest(base), env)).status).toBe(409)
    const first = await handle(toolRequest({ ...base, approved: true }), env)
    expect((await first.json() as any).data).toMatchObject({ outcome: 'succeeded', duplicate: false })
    const duplicate = await handle(toolRequest({ ...base, approved: true }), env)
    expect((await duplicate.json() as any).data).toMatchObject({ outcome: 'succeeded', duplicate: true })
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE notes = 'Cafe'`)
      .first<{ count: number }>()
    expect(count?.count).toBe(1)
  })

  it('records a rejection without creating a transaction', async () => {
    const env = await environment()
    const response = await handle(toolRequest({
      sessionId: 'live-tools', callId: 'write-rejected', toolName: 'ego_record_transaction', approved: false,
      arguments: {
        kind: 'expense', accountId: 'acc-check', categoryId: 'cat-food', amountCents: 725,
        date: '2026-09-15', merchant: 'Nope', destinationAccountId: null, notes: null
      }
    }), env)
    expect((await response.json() as any).data.outcome).toBe('rejected')
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE notes = 'Nope'`)
      .first<{ count: number }>()
    expect(count?.count).toBe(0)
  })
})
