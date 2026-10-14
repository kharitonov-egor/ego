import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, BootstrapData, OperationResponse } from '@ego/api-contracts'
import type { StudyEntryInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../../packages/local/src/api-client'
import type { LocalDatabase } from '../../../packages/local/src/database/types'
import { addStudyEntry, cachedStudy, editStudyEntry, markStudyEntry, removeStudyEntry } from '../../../packages/local/src/study/store'
import { createSyncCoordinator, type SyncOutcome } from '../../../packages/local/src/sync/coordinator'
import { allOperations } from '../../../packages/local/src/sync/outbox'
import { openTestLedger } from '../../../packages/local/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, operation, seedLedger, type Ledger } from './helpers'

const TOKEN = 'device-token-that-is-long-enough-0123456789'

let server: Ledger | null = null
const phones: LocalDatabase[] = []

afterEach(async () => {
  server?.close()
  server = null
  for (const phone of phones.splice(0)) await phone.close()
})

interface Envelope {
  ok: boolean
  data?: unknown
  error?: ApiError
}

async function over<T>(env: Env, path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  const payload = await (await handle(new Request(`https://ego.example${path}`, { ...init, headers }), env)).json() as Envelope
  return payload.ok ? { ok: true, data: payload.data as T } : { ok: false, error: payload.error ?? { code: 'SERVER_ERROR', message: 'Failed' } }
}

function apiOver(env: Env): MoneyApi {
  return {
    reference: () => over(env, '/v1/reference'),
    bootstrap: () => over(env, '/v1/bootstrap'),
    transactions: (filters, cursor, limit) => over(env, `/v1/transactions?${filterQuery(filters, cursor, limit)}`),
    receipt: (purchaseId) => over(env, `/v1/receipts/${encodeURIComponent(purchaseId)}`),
    balances: () => over(env, '/v1/balances'),
    changes: (after, limit) => over(env, `/v1/changes?after=${after}&limit=${limit}`),
    operations: (operations) => over(env, '/v1/operations', {
      method: 'POST', body: JSON.stringify({ operations }), headers: { 'content-type': 'application/json' }
    })
  }
}

async function setup(): Promise<Env> {
  server = await seedLedger()
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-1', 'Phone', ?, 'ego-money', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: server.db }
}

async function phone(env: Env): Promise<{ db: LocalDatabase; sync: () => Promise<SyncOutcome> }> {
  const db = await openTestLedger(`phone-${phones.length}`)
  phones.push(db)
  const coordinator = createSyncCoordinator({ db, api: apiOver(env), now: () => NOW })
  return { db, sync: () => coordinator.sync() }
}

const midterm = (overrides: Partial<StudyEntryInput> = {}): StudyEntryInput => ({
  kind: 'exam', title: 'Midterm 2', course: 'COP4530', due: { kind: 'time', at: '2026-10-20T18:00:00.000Z' },
  notes: 'Chapters 5 to 8', doneAt: null, ...overrides
})

async function entries(db: LocalDatabase) {
  return (await cachedStudy(db)).items.filter((item) => item.entry !== null)
}

describe('study entries between two phones and the Worker', () => {
  it('adds, edits, checks off, and deletes an entry on both phones', async () => {
    const env = await setup()
    const first = await phone(env)
    await addStudyEntry(first.db, 's-1', midterm(), NOW)
    const [added] = await entries(first.db)
    expect(added).toMatchObject({ kind: 'exam', title: 'Midterm 2', course: 'COP4530', description: 'Chapters 5 to 8', pending: true })
    const outcome = await first.sync()
    expect(outcome.touched.study).toBe(true)
    expect(await allOperations(first.db)).toEqual([])
    expect((await entries(first.db))[0].pending).toBe(false)

    const second = await phone(env)
    await second.sync()
    const [seen] = await entries(second.db)
    expect(seen).toMatchObject({ id: added.id, kind: 'exam', due: { kind: 'time', at: '2026-10-20T18:00:00.000Z' }, doneAt: null })

    await editStudyEntry(second.db, seen.id, midterm({ title: 'Midterm 2 (room change)', due: { kind: 'day', date: '2026-10-21' } }), NOW)
    await markStudyEntry(second.db, seen.id, true, NOW)
    await second.sync()
    await first.sync()
    const [edited] = await entries(first.db)
    expect(edited).toMatchObject({ title: 'Midterm 2 (room change)', due: { kind: 'day', date: '2026-10-21' }, doneAt: NOW })
    expect(edited.entry?.revision).toBe(3)

    await removeStudyEntry(first.db, edited.id, NOW)
    await first.sync()
    await second.sync()
    expect(await entries(second.db)).toEqual([])
    const bootstrap = await over<BootstrapData>(env, '/v1/bootstrap')
    expect(bootstrap.ok && bootstrap.data.studyEntries).toEqual([])
  })

  it('downloads entries in the first bootstrap', async () => {
    const env = await setup()
    const first = await phone(env)
    await addStudyEntry(first.db, 's-2', midterm({ kind: 'deadline', title: 'Drop deadline', course: null, due: { kind: 'day', date: '2026-10-30' } }), NOW)
    await first.sync()
    const bootstrap = await over<BootstrapData>(env, '/v1/bootstrap')
    expect(bootstrap.ok && bootstrap.data.studyEntries?.map((entry) => [entry.kind, entry.title, entry.due])).toEqual([
      ['deadline', 'Drop deadline', { kind: 'day', date: '2026-10-30' }]
    ])
    const second = await phone(env)
    await second.sync()
    expect((await entries(second.db)).map((item) => item.title)).toEqual(['Drop deadline'])
  })

  it('turns away an entry with no title or a broken due date', async () => {
    const env = await setup()
    const send = async (payload: unknown): Promise<OperationResponse> => {
      const result = await over<OperationResponse>(env, '/v1/operations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations: [operation({ operationId: 'op-1', entityId: 's-1', command: { entity: 'studyEntry', type: 'create', payload: payload as StudyEntryInput } })] })
      })
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
    await expect(send({ ...midterm(), title: '  ' })).rejects.toThrow()
    await expect(send({ ...midterm(), due: { kind: 'day', date: '2026-13-40' } })).rejects.toThrow()
    await expect(send({ ...midterm(), kind: 'quiz' })).rejects.toThrow()
    await expect(send({ ...midterm(), course: ' ' })).rejects.toThrow()
    const saved = await send(midterm({ title: '  Final  ', course: ' COP4530 ' }))
    expect(saved.results).toHaveLength(1)
    const bootstrap = await over<BootstrapData>(env, '/v1/bootstrap')
    expect(bootstrap.ok && bootstrap.data.studyEntries?.[0]).toMatchObject({ title: 'Final', course: 'COP4530', revision: 1 })
  })
})
