import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError, ApiResult, SyncOperation } from '@ego/api-contracts'
import {
  GYM_LIBRARY_CATEGORIES, GYM_LIBRARY_EXERCISES, parseFitNotesCsv, planFitNotesImport,
  type GymExerciseInput, type GymSetInput
} from '@ego/core'
import { filterQuery, type MoneyApi } from '../../../packages/local/src/api-client'
import type { LocalDatabase } from '../../../packages/local/src/database/types'
import { exerciseSets, gymCalendar, gymCategories, gymDay, gymExercises, gymPlans } from '../../../packages/local/src/repositories/gym'
import {
  createGymCategory, createGymExercise, createGymPlan, createGymSet, deleteGymCategory, deleteGymExercise,
  deleteGymPlan, deleteGymSet, saveGymWorkout, updateGymPlan, updateGymSet
} from '../../../packages/local/src/sync/commands'
import { createSyncCoordinator } from '../../../packages/local/src/sync/coordinator'
import { allOperations } from '../../../packages/local/src/sync/outbox'
import { openTestLedger } from '../../../packages/local/test/local-db'
import { hashToken } from '../src/auth'
import { handle } from '../src/router'
import { readChanges } from '../src/reads'
import { NOW, exec, seedLedger, type Ledger } from './helpers'

const TOKEN = 'device-token-that-is-long-enough-0123456789'

let server: Ledger | null = null
let device: LocalDatabase | null = null

afterEach(async () => {
  server?.close()
  await device?.close()
  server = null
  device = null
})

interface Envelope {
  ok: boolean
  data?: unknown
  error?: ApiError
}

function apiOver(db: D1Database): MoneyApi {
  const send = async <T>(path: string, init?: RequestInit): Promise<ApiResult<T>> => {
    const response = await handle(new Request(`https://ego.example${path}`, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
    }), { DB: db })
    const payload = await response.json() as Envelope
    if (!payload.ok) return { ok: false, error: payload.error ?? { code: 'SERVER_ERROR', message: 'The request failed' } }
    return { ok: true, data: payload.data as T }
  }
  return {
    reference: () => send('/v1/reference'),
    bootstrap: () => send('/v1/bootstrap'),
    transactions: (filters, cursor, limit) => send(`/v1/transactions?${filterQuery(filters, cursor, limit)}`),
    receipt: (purchaseId) => send(`/v1/receipts/${encodeURIComponent(purchaseId)}`),
    balances: () => send('/v1/balances'),
    changes: (after, limit) => send(`/v1/changes?after=${after}&limit=${limit}`),
    operations: (operations) => send('/v1/operations', { method: 'POST', body: JSON.stringify({ operations }) })
  }
}

async function post(db: D1Database, operations: SyncOperation[]): Promise<{ results: Array<{ status: string }>; failed: { error: ApiError } | null }> {
  const response = await handle(new Request('https://ego.example/v1/operations', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operations })
  }), { DB: db })
  const payload = await response.json() as { data: { results: Array<{ status: string }>; failed: { error: ApiError } | null } }
  return payload.data
}

async function pair(): Promise<ReturnType<typeof createSyncCoordinator>> {
  server = await seedLedger()
  await exec(server.db, `INSERT INTO devices (id, name, token_hash, dataset_id, created_at)
    VALUES ('device-1', 'Phone', ?, 'ego', ?)`, [await hashToken(TOKEN), NOW])
  device = await openTestLedger()
  return createSyncCoordinator({ db: device, api: apiOver(server.db), now: () => NOW })
}

async function serverRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await server!.db.prepare(sql).bind(...params).all<T>()
  return result.results ?? []
}

const legs = { name: 'Legs', color: '#008300' }
const squat = (overrides: Partial<GymExerciseInput> = {}): GymExerciseInput => ({
  name: 'Barbell Squat', categoryId: 'gc-legs', type: 'weight_reps', weightUnit: 'default', notes: '', ...overrides
})
const set = (overrides: Partial<GymSetInput> = {}): GymSetInput => ({
  exerciseId: 'ge-squat', date: '2026-09-27', position: 0, weight: 25, weightUnit: 'lbs', reps: 12,
  distance: null, distanceUnit: null, durationSeconds: null, comment: '', ...overrides
})

describe('gym log between the phone and the Worker', () => {
  it('delivers a category, an exercise, and sets logged offline, in order', async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await createGymSet(device!, set(), NOW, 'gs-1')
    await createGymSet(device!, set({ position: 1, weight: 30 }), NOW, 'gs-2')

    const local = await gymDay(device!, '2026-09-27')
    expect(local.exercises.map((item) => [item.exercise.name, item.sets.map((entry) => entry.weight)])).toEqual([['Barbell Squat', [25, 30]]])

    const outcome = await coordinator.sync()
    expect(outcome.state).toBe('synced')
    expect(outcome.touched).toEqual({ money: false, gym: true, health: false, habits: false, diary: false, tasks: false, sheets: false, food: false })
    expect(await allOperations(device!)).toHaveLength(0)
    const sets = await serverRows<{ id: string; weight: number; revision: number }>('SELECT id, weight, revision FROM gym_sets ORDER BY position')
    expect(sets).toEqual([{ id: 'gs-1', weight: 25, revision: 1 }, { id: 'gs-2', weight: 30, revision: 1 }])
    const changes = await readChanges(server!.db, 0, 10)
    expect(changes.changes.map((change) => change.entity)).toEqual(['gymCategory', 'gymExercise', 'gymSet', 'gymSet'])
  })

  it("brings another device's set down and applies edits and deletes", async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await coordinator.sync()

    const remote = await post(server!.db, [{
      operationId: 'other-1', entityId: 'gs-remote', expectedRevision: null, createdAt: NOW,
      command: { entity: 'gymSet', type: 'create', payload: set({ weight: 45, comment: 'Артем помогал' }) }
    }])
    expect(remote.failed).toBeNull()
    const outcome = await coordinator.sync()
    expect(outcome.touched.gym).toBe(true)
    expect((await exerciseSets(device!, 'ge-squat')).map((item) => [item.weight, item.comment])).toEqual([[45, 'Артем помогал']])

    await updateGymSet(device!, 'gs-remote', 1, set({ weight: 50 }), NOW)
    await coordinator.sync()
    expect(await serverRows('SELECT weight, revision FROM gym_sets WHERE id = ?', ['gs-remote'])).toEqual([{ weight: 50, revision: 2 }])

    await deleteGymSet(device!, 'gs-remote', 2, NOW)
    await coordinator.sync()
    expect(await serverRows('SELECT COUNT(*) AS total FROM gym_sets WHERE deleted_at IS NULL')).toEqual([{ total: 0 }])
    expect(await gymCalendar(device!)).toEqual([])
  })

  it('refuses a set for an exercise another device deleted', async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await coordinator.sync()
    const removed = await post(server!.db, [{
      operationId: 'other-delete', entityId: 'ge-squat', expectedRevision: 1, createdAt: NOW,
      command: { entity: 'gymExercise', type: 'delete' }
    }])
    expect(removed.failed).toBeNull()

    await createGymSet(device!, set(), NOW, 'gs-orphan')
    const outcome = await coordinator.sync()
    expect(outcome.state).toBe('attention')
    const [entry] = await allOperations(device!)
    expect(entry).toMatchObject({ entity: 'gymSet', status: 'conflict' })
    expect(await serverRows('SELECT COUNT(*) AS total FROM gym_sets')).toEqual([{ total: 0 }])
    expect(await serverRows('SELECT COUNT(*) AS total FROM changes WHERE entity = ?', ['gymSet'])).toEqual([{ total: 0 }])
  })

  it('keeps a category while it still has exercises', async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await coordinator.sync()
    await deleteGymCategory(device!, 'gc-legs', 1, NOW)
    const outcome = await coordinator.sync()
    expect(outcome.conflictCount).toBe(1)
    expect(await serverRows('SELECT deleted_at FROM gym_categories')).toEqual([{ deleted_at: null }])
  })

  it('hides the sets of a deleted exercise without deleting them', async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await createGymSet(device!, set(), NOW, 'gs-1')
    await coordinator.sync()
    await deleteGymExercise(device!, 'ge-squat', 1, NOW)
    await coordinator.sync()
    expect((await gymDay(device!, '2026-09-27')).exercises).toEqual([])
    expect(await gymExercises(device!)).toEqual([])
    expect(await serverRows('SELECT COUNT(*) AS total FROM gym_sets WHERE deleted_at IS NULL')).toEqual([{ total: 1 }])
  })

  it('orders a day by its workout record and keeps supersets to exercises done that day', async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await createGymExercise(device!, squat({ name: 'Leg Press' }), NOW, 'ge-press')
    await createGymSet(device!, set(), NOW, 'gs-1')
    await createGymSet(device!, set({ exerciseId: 'ge-press' }), NOW, 'gs-2')
    await saveGymWorkout(device!, {
      date: '2026-09-27', exerciseOrder: ['ge-press', 'ge-squat'], supersets: [['ge-squat', 'ge-press', 'ge-gone']], notes: ''
    }, null, NOW)
    const day = await gymDay(device!, '2026-09-27')
    expect(day.exercises.map((item) => item.exercise.id)).toEqual(['ge-press', 'ge-squat'])
    expect(day.supersets).toEqual([['ge-press', 'ge-squat']])

    await coordinator.sync()
    await saveGymWorkout(device!, { date: '2026-09-27', exerciseOrder: ['ge-squat', 'ge-press'], supersets: [], notes: '' }, 1, NOW)
    await coordinator.sync()
    expect(await serverRows('SELECT exercise_order, revision FROM gym_workouts')).toEqual([
      { exercise_order: '["ge-squat","ge-press"]', revision: 2 }
    ])
  })

  it('syncs a plan through create, edit, and delete, and a new phone downloads it', async () => {
    const coordinator = await pair()
    await coordinator.sync()
    await createGymCategory(device!, legs, NOW, 'gc-legs')
    await createGymExercise(device!, squat(), NOW, 'ge-squat')
    await createGymExercise(device!, squat({ name: 'Leg Press' }), NOW, 'ge-press')
    const plan = { name: ' Legs A ', exerciseOrder: ['ge-squat', 'ge-press'], supersets: [['ge-squat', 'ge-press']] }
    await createGymPlan(device!, plan, NOW, 'gp-legs')
    expect((await gymPlans(device!)).map((item) => [item.name, item.exerciseOrder, item.revision])).toEqual([
      ['Legs A', ['ge-squat', 'ge-press'], 1]
    ])

    const outcome = await coordinator.sync()
    expect(outcome.state).toBe('synced')
    expect(outcome.touched.gym).toBe(true)
    expect(await serverRows('SELECT name, exercise_order, supersets, revision FROM gym_plans')).toEqual([
      { name: 'Legs A', exercise_order: '["ge-squat","ge-press"]', supersets: '[["ge-squat","ge-press"]]', revision: 1 }
    ])

    await updateGymPlan(device!, 'gp-legs', 1, { ...plan, name: 'Legs', supersets: [] }, NOW)
    await coordinator.sync()
    expect(await serverRows('SELECT name, supersets, revision FROM gym_plans')).toEqual([{ name: 'Legs', supersets: '[]', revision: 2 }])

    const fresh = await openTestLedger()
    try {
      await createSyncCoordinator({ db: fresh, api: apiOver(server!.db), now: () => NOW }).sync()
      expect((await gymPlans(fresh)).map((item) => [item.id, item.name])).toEqual([['gp-legs', 'Legs']])
    } finally {
      await fresh.close()
    }

    await deleteGymPlan(device!, 'gp-legs', 2, NOW)
    await coordinator.sync()
    expect(await gymPlans(device!)).toEqual([])
    expect(await serverRows('SELECT COUNT(*) AS total FROM gym_plans WHERE deleted_at IS NULL')).toEqual([{ total: 0 }])
    const changes = await readChanges(server!.db, 0, 20)
    expect(changes.changes.filter((change) => change.entity === 'gymPlan').map((change) => change.action)).toEqual(['upsert', 'upsert', 'delete'])
  })

  it('imports a FitNotes export through the operations endpoint, and a second run changes nothing', async () => {
    const coordinator = await pair()
    const csv = [
      'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment',
      '2024-03-15,Barbell Squat,Legs,15.0,lbs,12,,,,""',
      '2024-03-15,Колокол,Пресс,,,20,,,,""',
      '2024-03-16,Treadmill + incline,Cardio,,,,1.53,mi,0:32:06,""'
    ].join('\n')
    const plan = planFitNotesImport(parseFitNotesCsv(csv).rows, { categoryMerges: { 'Пресс': 'Abs' } })
    const operations: SyncOperation[] = [
      ...plan.categories.map((item): SyncOperation => ({
        operationId: `import-${item.id}`, entityId: item.id, expectedRevision: null, createdAt: NOW,
        command: { entity: 'gymCategory', type: 'create', payload: item.input }
      })),
      ...plan.exercises.map((item): SyncOperation => ({
        operationId: `import-${item.id}`, entityId: item.id, expectedRevision: null, createdAt: NOW,
        command: { entity: 'gymExercise', type: 'create', payload: item.input }
      })),
      ...plan.sets.map((item): SyncOperation => ({
        operationId: `import-${item.id}`, entityId: item.id, expectedRevision: null, createdAt: NOW,
        command: { entity: 'gymSet', type: 'create', payload: item.input }
      })),
      ...plan.workouts.map((item): SyncOperation => ({
        operationId: `import-w-${item.date}`, entityId: item.date, expectedRevision: null, createdAt: NOW,
        command: { entity: 'gymWorkout', type: 'save', payload: item }
      }))
    ]
    for (let index = 0; index < operations.length; index += 25) {
      expect((await post(server!.db, operations.slice(index, index + 25))).failed).toBeNull()
    }
    const again = await post(server!.db, operations.slice(0, 25))
    expect(again.results.every((result) => result.status === 'duplicate')).toBe(true)

    await coordinator.sync()
    expect((await gymCategories(device!)).length).toBe(GYM_LIBRARY_CATEGORIES.length)
    expect((await gymExercises(device!)).length).toBe(GYM_LIBRARY_EXERCISES.length + 2)
    const march15 = await gymDay(device!, '2024-03-15')
    expect(march15.exercises.map((item) => [item.exercise.name, item.exercise.categoryName])).toEqual([
      ['Barbell Squat', 'Legs'], ['Колокол', 'Abs']
    ])
    const calendar = await gymCalendar(device!)
    expect(calendar.map((day) => day.date)).toEqual(['2024-03-15', '2024-03-16'])
    expect(calendar[0].colors).toHaveLength(2)
  })
})
