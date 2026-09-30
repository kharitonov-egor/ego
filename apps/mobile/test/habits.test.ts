import { afterEach, describe, expect, it } from 'vitest'
import type { ChangeRecord, HabitEntryRecord, HabitRecord } from '@ego/api-contracts'
import type { HabitInput } from '@ego/core'
import type { LocalDatabase } from '../lib/database/types'
import { localHabitEntries, localHabits, localRevision } from '../lib/repositories/habits'
import { createHabit, createHabitEntry, deleteHabit, deleteHabitEntry, updateHabit } from '../lib/sync/commands'
import { BOOTSTRAP_VERSION, bootstrap, createSyncCoordinator } from '../lib/sync/coordinator'
import { allOperations } from '../lib/sync/outbox'
import { emptyBootstrap, fakeApi } from './fake-api'
import { openTestLedger } from './local-db'

const NOW = '2026-09-28T21:00:00.000Z'
let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

const input = (overrides: Partial<HabitInput> = {}): HabitInput => ({
  name: 'Read', icon: '📚', kind: 'build', startDate: '2026-09-01', position: 0, ...overrides
})

const habitRecord = (overrides: Partial<HabitRecord> = {}): HabitRecord => ({
  id: 'hb-read', name: 'Read', icon: '📚', kind: 'build', startDate: '2026-09-01', position: 0, target: 1,
  period: 'day', startedAt: null, createdAt: NOW, updatedAt: NOW, revision: 1, ...overrides
})

const entryRecord = (overrides: Partial<HabitEntryRecord> = {}): HabitEntryRecord => ({
  id: 'he-1', habitId: 'hb-read', date: '2026-09-27', kind: 'done', loggedAt: null, createdAt: NOW, updatedAt: NOW,
  revision: 1, ...overrides
})

describe('habits on the phone', () => {
  it('keeps a target, a period, and an exact quit moment', async () => {
    db = await openTestLedger()
    await createHabit(db, input({ name: 'Gym', target: 3, period: 'week' }), NOW, 'hb-gym')
    await createHabit(db, input({ name: 'Smoking', kind: 'break', startedAt: '2026-09-20T01:30:00.000Z' }), NOW, 'hb-smoke')
    await createHabitEntry(db, { habitId: 'hb-smoke', date: '2026-09-28', kind: 'slipped', loggedAt: '2026-09-28T20:15:00.000Z' }, NOW, 'he-slip')
    expect(await localHabits(db)).toEqual([
      expect.objectContaining({ id: 'hb-gym', target: 3, period: 'week', startedAt: null }),
      expect.objectContaining({ id: 'hb-smoke', target: 1, period: 'day', startedAt: '2026-09-20T01:30:00.000Z' })
    ])
    expect(await localHabitEntries(db)).toEqual([expect.objectContaining({ id: 'he-slip', loggedAt: '2026-09-28T20:15:00.000Z' })])
  })

  it('reads a pulled habit written before targets as once a day', async () => {
    db = await openTestLedger()
    await db.run('UPDATE sync_state SET bootstrapped_at = ?, bootstrap_version = ? WHERE id = 1', [NOW, BOOTSTRAP_VERSION])
    const { target, period, startedAt, ...legacy } = habitRecord({ id: 'hb-old' })
    const pulled = { seq: 3, entityId: 'hb-old', action: 'upsert', revision: 1, committedAt: NOW, entity: 'habit', record: legacy }
    const api = fakeApi({ changes: [{ ok: true, data: { changes: [pulled as ChangeRecord], cursor: 3, hasMore: false } }] })
    expect(await createSyncCoordinator({ db, api, now: () => NOW }).sync()).toMatchObject({ state: 'synced', applied: 1 })
    expect(await localHabits(db)).toEqual([expect.objectContaining({ id: 'hb-old', target: 1, period: 'day', startedAt: null })])
    expect([target, period, startedAt]).toEqual([1, 'day', null])
  })

  it('adds a habit, checks it off, unchecks it, and queues every step', async () => {
    db = await openTestLedger()
    await createHabit(db, input({ name: '  Read  ' }), NOW, 'hb-read')
    await createHabitEntry(db, { habitId: 'hb-read', date: '2026-09-28', kind: 'done' }, NOW, 'he-1')
    expect(await localHabits(db)).toEqual([expect.objectContaining({ id: 'hb-read', name: 'Read', revision: 1 })])
    expect(await localHabitEntries(db)).toEqual([expect.objectContaining({ id: 'he-1', date: '2026-09-28', kind: 'done' })])
    await deleteHabitEntry(db, 'he-1', 1, NOW)
    expect(await localHabitEntries(db)).toHaveLength(0)
    expect(await localRevision(db, 'habit_entries', 'he-1')).toBeNull()
    const outbox = await allOperations(db)
    expect(outbox.map((entry) => [entry.entity, entry.entityId, entry.commandType])).toEqual([
      ['habit', 'hb-read', 'create'], ['habitEntry', 'he-1', 'create'], ['habitEntry', 'he-1', 'delete']
    ])
  })

  it('orders habits by position and hides the entries of a deleted habit', async () => {
    db = await openTestLedger()
    await createHabit(db, input({ name: 'Walk', position: 1 }), NOW, 'hb-walk')
    await createHabit(db, input({ name: 'Read', position: 0 }), NOW, 'hb-read')
    await createHabitEntry(db, { habitId: 'hb-walk', date: '2026-09-28', kind: 'done' }, NOW, 'he-walk')
    expect((await localHabits(db)).map((habit) => habit.name)).toEqual(['Read', 'Walk'])
    await updateHabit(db, 'hb-walk', 1, input({ name: 'Walk', position: 0 }), NOW)
    await updateHabit(db, 'hb-read', 1, input({ name: 'Read', position: 1 }), NOW)
    expect((await localHabits(db)).map((habit) => [habit.name, habit.revision])).toEqual([['Walk', 2], ['Read', 2]])
    await deleteHabit(db, 'hb-walk', 2, NOW)
    expect((await localHabits(db)).map((habit) => habit.id)).toEqual(['hb-read'])
    expect(await localHabitEntries(db)).toHaveLength(0)
  })

  it('downloads habits and check-offs and drops the ones the server no longer has', async () => {
    db = await openTestLedger()
    await db.run(`INSERT INTO habits (id, name, icon, kind, start_date, position, created_at, updated_at, revision)
      VALUES ('hb-old', 'Old', '🧹', 'build', '2026-01-01', 0, ?, ?, 1)`, [NOW, NOW])
    const api = fakeApi({
      bootstrap: [{ ok: true, data: { ...emptyBootstrap(9), habits: [habitRecord()], habitEntries: [entryRecord()] } }]
    })
    expect(await bootstrap({ db, api, now: () => NOW })).toBeNull()
    expect((await localHabits(db)).map((habit) => habit.id)).toEqual(['hb-read'])
    expect((await localHabitEntries(db)).map((entry) => entry.id)).toEqual(['he-1'])
  })

  it('delivers a check-off, applies a slip pulled from the server, and reports only habits as touched', async () => {
    db = await openTestLedger()
    await db.run('UPDATE sync_state SET bootstrapped_at = ?, bootstrap_version = ? WHERE id = 1', [NOW, BOOTSTRAP_VERSION])
    await createHabit(db, input(), NOW, 'hb-read')
    await createHabit(db, input({ name: 'Smoking', kind: 'break', position: 0 }), NOW, 'hb-smoke')
    await createHabitEntry(db, { habitId: 'hb-read', date: '2026-09-28', kind: 'done' }, NOW, 'he-1')
    const pulled: ChangeRecord = {
      seq: 7, entityId: 'he-slip', action: 'upsert', revision: 1, committedAt: NOW,
      entity: 'habitEntry', record: entryRecord({ id: 'he-slip', habitId: 'hb-smoke', kind: 'slipped' })
    }
    const api = fakeApi({ changes: [{ ok: true, data: { changes: [pulled], cursor: 7, hasMore: false } }] })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome).toMatchObject({ state: 'synced', delivered: 3 })
    expect(outcome.touched).toEqual({ money: false, gym: false, health: false, habits: true, diary: false, tasks: false })
    expect(await allOperations(db)).toHaveLength(0)
    expect((await localHabitEntries(db)).map((entry) => [entry.id, entry.kind])).toEqual([['he-slip', 'slipped'], ['he-1', 'done']])
  })
})
