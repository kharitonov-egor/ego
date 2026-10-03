import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, BootstrapData, DiaryMediaInfo, OperationResponse } from '@ego/api-contracts'
import type { FoodEntryInput, FridgeItemInput } from '@ego/core'
import { filterQuery, type MoneyApi } from '../../mobile/lib/api-client'
import type { LocalDatabase } from '../../mobile/lib/database/types'
import { queueUploads, uploadPendingMedia, type UploadTransport } from '../../mobile/lib/diary/uploads'
import { localFood } from '../../mobile/lib/food/repository'
import {
  createFridgeItem, deleteFoodEntry, deleteFridgeItem, saveFoodEntry, saveFoodGoal
} from '../../mobile/lib/sync/commands'
import { keepMine } from '../../mobile/lib/sync/conflicts'
import { createSyncCoordinator } from '../../mobile/lib/sync/coordinator'
import { allOperations } from '../../mobile/lib/sync/outbox'
import { openTestLedger } from '../../mobile/test/local-db'
import { hashToken, type Env } from '../src/auth'
import { handle } from '../src/router'
import { NOW, exec, operation, seedLedger, type Ledger } from './helpers'
import { createTestBucket } from './r2'

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

function transportOver(env: Env): UploadTransport {
  return async (upload): Promise<ApiResult<DiaryMediaInfo>> => {
    const bytes = new TextEncoder().encode(upload.localUri.padEnd(upload.size, '.'))
    return over(env, `/v1/${upload.scope ?? 'diary'}/media/${upload.mediaId}`, {
      method: 'PUT', body: bytes, headers: { 'content-type': upload.contentType, 'content-length': String(bytes.length) }
    })
  }
}

async function setup(): Promise<Env> {
  server = await seedLedger()
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-1', 'Phone', ?, 'ego-money', ?)`, [await hashToken(TOKEN), NOW])
  return { DB: server.db, DIARY_MEDIA: createTestBucket().bucket }
}

async function phone(env: Env): Promise<{ db: LocalDatabase; sync: () => Promise<unknown> }> {
  const db = await openTestLedger(`phone-${phones.length}`)
  phones.push(db)
  const coordinator = createSyncCoordinator({
    db, api: apiOver(env), now: () => NOW, uploadMedia: () => uploadPendingMedia(db, transportOver(env), () => NOW)
  })
  return { db, sync: () => coordinator.sync() }
}

const lunch = (overrides: Partial<FoodEntryInput> = {}): FoodEntryInput => ({
  name: 'Chicken burrito bowl', date: '2026-09-12', eatenAt: '2026-09-12T16:30:00.000Z', serving: '1 bowl',
  calories: 640, protein: 45, carbs: 60, fat: 22,
  parts: [
    { name: 'Chicken', calories: 280, protein: 40, carbs: 0, fat: 12 },
    { name: 'Rice and beans', calories: 360, protein: 5, carbs: 60, fat: 10 }
  ],
  source: 'photo', barcode: null, photo: { mediaId: 'meal-1', previewId: 'meal-1-small', width: 1600, height: 1200 }, note: '',
  ...overrides
})

const milk: FridgeItemInput = {
  name: 'Whole milk', icon: '🥛', brand: 'Publix', barcode: '041415012345', source: 'barcode', purchaseId: null, addedAt: NOW
}

describe('food between two phones and the Worker', () => {
  it('uploads a meal photo first, then shows the entry on the other phone', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await saveFoodEntry(tx, 'f-1', null, lunch(), NOW, true)
      await queueUploads(tx, [
        { mediaId: 'meal-1', messageId: 'f-1', localUri: 'file:///docs/meal-1.jpg', contentType: 'image/jpeg', size: 64, scope: 'food' },
        { mediaId: 'meal-1-small', messageId: 'f-1', localUri: 'file:///docs/meal-1-small.jpg', contentType: 'image/jpeg', size: 32, scope: 'food' }
      ], NOW)
    })
    expect((await allOperations(first.db))[0]).toMatchObject({ entity: 'foodEntry', status: 'held' })
    await first.sync()
    expect(await allOperations(first.db)).toEqual([])
    const served = await handle(new Request('https://ego.example/v1/food/media/meal-1', { headers: { authorization: `Bearer ${TOKEN}` } }), env)
    expect(served.status).toBe(200)

    const second = await phone(env)
    await second.sync()
    const seen = await localFood(second.db)
    expect(seen.entries).toHaveLength(1)
    expect(seen.entries[0]).toMatchObject({
      id: 'f-1', name: 'Chicken burrito bowl', calories: 640, protein: 45, source: 'photo',
      photo: { mediaId: 'meal-1', previewId: 'meal-1-small', width: 1600, height: 1200 }
    })
    expect(seen.entries[0].parts.map((part) => part.name)).toEqual(['Chicken', 'Rice and beans'])

    await saveFoodEntry(second.db, 'f-1', seen.entries[0].revision, lunch({ calories: 700, serving: '1 large bowl' }), NOW)
    await second.sync()
    await first.sync()
    expect((await localFood(first.db)).entries[0]).toMatchObject({ calories: 700, serving: '1 large bowl', revision: 2 })
    await deleteFoodEntry(first.db, 'f-1', 2, NOW)
    await first.sync()
    await second.sync()
    expect((await localFood(second.db)).entries).toEqual([])
  })

  it('drops an entry the server never saw, with its photo', async () => {
    const env = await setup()
    const first = await phone(env)
    await first.db.transaction(async (tx) => {
      await saveFoodEntry(tx, 'f-1', null, lunch(), NOW, true)
      await queueUploads(tx, [
        { mediaId: 'meal-1', messageId: 'f-1', localUri: 'file:///docs/meal-1.jpg', contentType: 'image/jpeg', size: 64, scope: 'food' }
      ], NOW)
    })
    expect(await deleteFoodEntry(first.db, 'f-1', 1, NOW)).toEqual(['file:///docs/meal-1.jpg'])
    expect(await allOperations(first.db)).toEqual([])
    expect((await localFood(first.db)).entries).toEqual([])
  })

  it('adds and removes fridge items on both phones', async () => {
    const env = await setup()
    const first = await phone(env)
    await createFridgeItem(first.db, milk, NOW, 'i-milk')
    await createFridgeItem(first.db, { ...milk, name: 'Eggs', icon: '🥚', brand: null, barcode: null, source: 'photo' }, NOW, 'i-eggs')
    await first.sync()
    const second = await phone(env)
    await second.sync()
    expect((await localFood(second.db)).fridge.map((item) => item.name).sort()).toEqual(['Eggs', 'Whole milk'])
    await deleteFridgeItem(second.db, 'i-milk', 1, NOW)
    await second.sync()
    await first.sync()
    expect((await localFood(first.db)).fridge.map((item) => item.name)).toEqual(['Eggs'])
  })

  it('keeps one set of targets, and turns a second phone\'s first save into an edit', async () => {
    const env = await setup()
    const first = await phone(env)
    const second = await phone(env)
    await second.sync()
    await saveFoodGoal(first.db, { calories: 2200, protein: 150, carbs: null, fat: null }, null, NOW)
    await first.sync()
    await saveFoodGoal(second.db, { calories: 2000, protein: 160, carbs: 200, fat: 70 }, null, NOW)
    await second.sync()
    const conflict = (await allOperations(second.db)).find((entry) => entry.status === 'conflict')
    if (!conflict) throw new Error('Expected the second create to conflict')
    await keepMine(second.db, conflict, 'op-keep', NOW)
    await second.sync()
    await first.sync()
    expect((await localFood(first.db)).goal).toMatchObject({ id: 'daily', calories: 2000, protein: 160, carbs: 200, fat: 70, revision: 2 })
    const bootstrap = await over<BootstrapData>(env, '/v1/bootstrap')
    expect(bootstrap.ok && bootstrap.data.foodGoals?.map((goal) => goal.calories)).toEqual([2000])
  })
})

describe('the Worker checks food before saving it', () => {
  async function send(env: Env, payload: FoodEntryInput, id = 'f-1'): Promise<OperationResponse> {
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({ operationId: `op-${id}`, entityId: id, command: { entity: 'foodEntry', type: 'create', payload } })] })
    })
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  }

  it('refuses a photo that was never uploaded and accepts an entry without one', async () => {
    const env = await setup()
    expect((await send(env, lunch())).failed?.error.message).toBe('Upload the photo before saving')
    expect((await send(env, lunch({ photo: null }), 'f-2')).failed).toBeNull()
  })

  it('rejects targets under any ID but the daily one', async () => {
    const env = await setup()
    const result = await over<OperationResponse>(env, '/v1/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation({
        entityId: 'weekly', command: { entity: 'foodGoal', type: 'create', payload: { calories: 2000, protein: null, carbs: null, fat: null } }
      })] })
    })
    expect(result.ok).toBe(false)
  })
})
