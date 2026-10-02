import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, BootstrapData, OperationResponse } from '@ego/api-contracts'
import type { SheetInput, SheetRowInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../mobile/lib/api-client'
import type { LocalDatabase } from '../../mobile/lib/database/types'
import { localSheets } from '../../mobile/lib/sheets/repository'
import {
  createSheet, createSheetRow, deleteSheet, deleteSheetRow, updateSheet, updateSheetRow
} from '../../mobile/lib/sync/commands'
import { createSyncCoordinator } from '../../mobile/lib/sync/coordinator'
import { allOperations } from '../../mobile/lib/sync/outbox'
import { openTestLedger } from '../../mobile/test/local-db'
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

async function phone(env: Env): Promise<{ db: LocalDatabase; sync: () => Promise<unknown> }> {
  const db = await openTestLedger(`phone-${phones.length}`)
  phones.push(db)
  const coordinator = createSyncCoordinator({ db, api: apiOver(env), now: () => NOW })
  return { db, sync: () => coordinator.sync() }
}

const connections = (overrides: Partial<SheetInput> = {}): SheetInput => ({
  name: 'Connections',
  icon: '👥',
  position: 1024,
  columns: [
    { id: 'name', name: 'Name', type: 'text', options: [], typeIds: null, hidden: false },
    {
      id: 'c-met', name: 'Met at', type: 'tags', typeIds: ['t-person'], hidden: false,
      options: [{ id: 'o-nyu', name: 'NYU', shade: 0 }, { id: 'o-hack', name: 'Hackathon', shade: 1 }]
    },
    { id: 'c-size', name: 'Size', type: 'number', options: [], typeIds: ['t-company'], hidden: false }
  ],
  typesEnabled: true,
  rowTypes: [{ id: 't-person', name: 'Person' }, { id: 't-company', name: 'Company' }],
  view: {
    typeId: null,
    sorts: [{ columnId: 'name', direction: 'asc' }],
    filters: [{ id: 'f-1', columnId: 'c-met', operator: 'anyOf', value: ['o-nyu'] }],
    groupBy: null
  },
  archivedAt: null,
  ...overrides
})

const alex: SheetRowInput = { sheetId: 's-1', typeId: 't-person', cells: { name: 'Alex K', 'c-met': ['o-nyu', 'o-hack'] } }

describe('sheets between two phones and the Worker', () => {
  it('carries a sheet, its rows, and later edits to the other phone', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await createSheet(tx, connections(), NOW, 's-1')
      await createSheetRow(tx, alex, NOW, 'r-1')
      await createSheetRow(tx, { sheetId: 's-1', typeId: 't-company', cells: { name: 'Stripe', 'c-size': 8000 } }, NOW, 'r-2')
    })
    await first.sync()
    expect(await allOperations(first.db)).toEqual([])

    const second = await phone(env)
    await second.sync()
    const seen = await localSheets(second.db)
    expect(seen.sheets).toHaveLength(1)
    expect(seen.sheets[0]).toMatchObject({ name: 'Connections', icon: '👥', typesEnabled: true, view: connections().view })
    expect(seen.sheets[0].columns.map((column) => column.type)).toEqual(['text', 'tags', 'number'])
    expect(seen.rows.map((row) => row.cells)).toEqual([
      { name: 'Alex K', 'c-met': ['o-nyu', 'o-hack'] },
      { name: 'Stripe', 'c-size': 8000 }
    ])

    await updateSheetRow(second.db, 'r-1', 1, { ...alex, cells: { name: 'Alex Kim', 'c-met': ['o-hack'] } }, NOW)
    await updateSheet(second.db, 's-1', 1, connections({ name: 'People' }), NOW)
    await second.sync()
    await first.sync()
    const updated = await localSheets(first.db)
    expect(updated.sheets[0]).toMatchObject({ name: 'People', revision: 2 })
    expect(updated.rows.find((row) => row.id === 'r-1')).toMatchObject({ cells: { name: 'Alex Kim', 'c-met': ['o-hack'] }, revision: 2 })
  })

  it('asks before overwriting a row another phone changed', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await createSheet(tx, connections(), NOW, 's-1')
      await createSheetRow(tx, alex, NOW, 'r-1')
    })
    await first.sync()
    const second = await phone(env)
    await second.sync()
    await updateSheetRow(second.db, 'r-1', 1, { ...alex, cells: { name: 'From the second phone' } }, NOW)
    await second.sync()
    await updateSheetRow(first.db, 'r-1', 1, { ...alex, cells: { name: 'From the first phone' } }, NOW)
    await first.sync()
    const waiting = await allOperations(first.db)
    expect(waiting).toHaveLength(1)
    expect(waiting[0]).toMatchObject({ entity: 'sheetRow', status: 'conflict' })
  })

  it('hides the rows of a deleted sheet on both sides', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await createSheet(tx, connections(), NOW, 's-1')
      await createSheetRow(tx, alex, NOW, 'r-1')
    })
    await first.sync()
    await deleteSheet(first.db, 's-1', 1, NOW)
    await first.sync()
    expect(await localSheets(first.db)).toEqual({ sheets: [], rows: [] })
    const bootstrap = await over<BootstrapData>(env, '/v1/bootstrap')
    expect(bootstrap.ok && bootstrap.data.sheets).toEqual([])
    expect(bootstrap.ok && bootstrap.data.sheetRows).toEqual([])
  })

  it('removes a deleted row from the other phone', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await createSheet(tx, connections(), NOW, 's-1')
      await createSheetRow(tx, alex, NOW, 'r-1')
    })
    await first.sync()
    const second = await phone(env)
    await second.sync()
    await deleteSheetRow(first.db, 'r-1', 1, NOW)
    await first.sync()
    await second.sync()
    expect((await localSheets(second.db)).rows).toEqual([])
  })
})

describe('the Worker checks a row before saving it', () => {
  async function send(env: Env, payload: SheetRowInput, id: string, type: 'create' | 'update' = 'create', expectedRevision: number | null = null): Promise<OperationResponse> {
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [operation({ operationId: `op-${id}-${type}`, entityId: id, expectedRevision, command: { entity: 'sheetRow', type, payload } })]
      })
    })
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  it('refuses a row for a sheet that is gone and a row moving between sheets', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await createSheet(tx, connections(), NOW, 's-1')
      await createSheet(tx, connections({ name: 'Reading list', position: 2048 }), NOW, 's-2')
    })
    await first.sync()
    expect((await send(env, { ...alex, sheetId: 's-gone' }, 'r-1')).failed?.error.message).toBe('That sheet was deleted on another device')
    expect((await send(env, alex, 'r-2')).failed).toBeNull()
    expect((await send(env, { ...alex, sheetId: 's-2' }, 'r-2', 'update', 1)).failed?.error.message).toBe('A row cannot move to another sheet')
  })
})
