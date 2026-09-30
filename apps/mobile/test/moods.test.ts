import { afterEach, describe, expect, it } from 'vitest'
import type { ChangeRecord, MoodRecord } from '@ego/api-contracts'
import type { LocalDatabase } from '../lib/database/types'
import { localMoodRevision, localMoods } from '../lib/repositories/moods'
import { deleteMood, saveMood } from '../lib/sync/commands'
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

const record = (overrides: Partial<MoodRecord> = {}): MoodRecord => ({
  id: 'mood-2026-09-27', date: '2026-09-27', mood: 4, note: 'Good run',
  createdAt: '2026-09-27T21:00:00.000Z', updatedAt: '2026-09-27T21:00:00.000Z', revision: 1,
  ...overrides
})

async function bootstrapped(): Promise<LocalDatabase> {
  const database = await openTestLedger()
  await database.run('UPDATE sync_state SET bootstrapped_at = ?, bootstrap_version = ? WHERE id = 1', [NOW, BOOTSTRAP_VERSION])
  return database
}

describe('mood entries on the phone', () => {
  it('saves a day with its operation keyed by date, then edits and clears it', async () => {
    db = await openTestLedger()
    await saveMood(db, { date: '2026-09-28', mood: 3, note: '  Slow day  ' }, null, NOW)
    expect(await localMoods(db)).toEqual([expect.objectContaining({
      id: 'mood-2026-09-28', mood: 3, note: 'Slow day', revision: 1
    })])
    await saveMood(db, { date: '2026-09-28', mood: 5, note: 'Turned around' }, 1, NOW)
    expect(await localMoodRevision(db, '2026-09-28')).toBe(2)
    await deleteMood(db, '2026-09-28', 2, NOW)
    expect(await localMoods(db)).toHaveLength(0)
    const outbox = await allOperations(db)
    expect(outbox.map((entry) => [entry.entity, entry.entityId, entry.commandType])).toEqual([
      ['mood', '2026-09-28', 'save'], ['mood', '2026-09-28', 'save'], ['mood', '2026-09-28', 'delete']
    ])
  })

  it('revives a cleared day on the next revision, as the server will', async () => {
    db = await openTestLedger()
    await saveMood(db, { date: '2026-09-28', mood: 2, note: '' }, null, NOW)
    await deleteMood(db, '2026-09-28', 1, NOW)
    await saveMood(db, { date: '2026-09-28', mood: 4, note: '' }, null, NOW)
    expect(await localMoods(db)).toEqual([expect.objectContaining({ mood: 4, revision: 3 })])
  })

  it('downloads entries and drops the ones the server no longer has', async () => {
    db = await openTestLedger()
    await db.run(`INSERT INTO mood_entries (id, date, mood, note, created_at, updated_at, revision)
      VALUES ('mood-2026-09-01', '2026-09-01', 1, '', ?, ?, 1)`, [NOW, NOW])
    const api = fakeApi({ bootstrap: [{ ok: true, data: { ...emptyBootstrap(9), moods: [record()] } }] })
    expect(await bootstrap({ db, api, now: () => NOW })).toBeNull()
    expect((await localMoods(db)).map((entry) => entry.date)).toEqual(['2026-09-27'])
  })

  it('delivers a saved day and applies an edit pulled from the server', async () => {
    db = await bootstrapped()
    await saveMood(db, { date: '2026-09-28', mood: 3, note: '' }, null, NOW)
    const pulled: ChangeRecord = {
      seq: 5, entityId: '2026-09-27', action: 'upsert', revision: 2, committedAt: NOW,
      entity: 'mood', record: record({ mood: 1, note: 'Edited elsewhere', revision: 2 })
    }
    await db.run(`INSERT INTO mood_entries (id, date, mood, note, created_at, updated_at, revision)
      VALUES ('mood-2026-09-27', '2026-09-27', 4, 'Good run', ?, ?, 1)`, [NOW, NOW])
    const api = fakeApi({ changes: [{ ok: true, data: { changes: [pulled], cursor: 5, hasMore: false } }] })
    const outcome = await createSyncCoordinator({ db, api, now: () => NOW }).sync()
    expect(outcome).toMatchObject({ state: 'synced', delivered: 1 })
    expect(outcome.touched).toEqual({ money: false, gym: false, health: true, habits: false, diary: false, tasks: false })
    expect(api.sentOperations[0][0]).toMatchObject({ entityId: '2026-09-28', command: { entity: 'mood', type: 'save' } })
    expect(await allOperations(db)).toHaveLength(0)
    const entries = await localMoods(db)
    expect(entries.find((entry) => entry.date === '2026-09-27')).toMatchObject({ mood: 1, note: 'Edited elsewhere', revision: 2 })
  })
})
