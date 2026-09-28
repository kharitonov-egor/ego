import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from '../lib/database/types'
import { exerciseSetsPage, exerciseTrackSets } from '../lib/repositories/gym'
import { openTestLedger } from './local-db'

let db: LocalDatabase | null = null

afterEach(async () => {
  await db?.close()
  db = null
})

describe('gym repository', () => {
  it('loads Track without reading lifetime history and pages History separately', async () => {
    db = await openTestLedger()
    await db.run(`INSERT INTO gym_categories
      (id, name, color, created_at, updated_at, revision, deleted_at)
      VALUES ('category-1', 'Strength', '#ffffff', '2026-01-01', '2026-01-01', 1, NULL)`)
    await db.run(`INSERT INTO gym_exercises
      (id, name, category_id, type, weight_unit, notes, created_at, updated_at, revision, deleted_at)
      VALUES ('exercise-1', 'Squat', 'category-1', 'weight_reps', 'lbs', '', '2026-01-01', '2026-01-01', 1, NULL)`)
    for (let index = 0; index < 6; index += 1) {
      const day = `2026-09-${10 + Math.floor(index / 2)}`
      await db.run(`INSERT INTO gym_sets
        (id, exercise_id, date, position, weight, weight_unit, reps, distance, distance_unit,
          duration_seconds, comment, created_at, updated_at, revision, deleted_at)
        VALUES (?, 'exercise-1', ?, ?, 100, 'lbs', 5, NULL, NULL, NULL, '', ?, ?, 1, NULL)`,
      [`set-${index}`, day, index % 2, `${day}T10:0${index}:00.000Z`, `${day}T10:0${index}:00.000Z`])
    }

    const track = await exerciseTrackSets(db, 'exercise-1', '2026-09-12')
    expect(track.today.map((set) => set.id)).toEqual(['set-4', 'set-5'])
    expect(track.previous?.id).toBe('set-2')

    const first = await exerciseSetsPage(db, 'exercise-1', 3)
    expect(first.items.map((set) => set.id)).toEqual(['set-4', 'set-5', 'set-2'])
    expect(first.nextOffset).toBe(3)
    const second = await exerciseSetsPage(db, 'exercise-1', 3, first.nextOffset ?? 0)
    expect(second.items.map((set) => set.id)).toEqual(['set-3', 'set-0', 'set-1'])
    expect(second.nextOffset).toBeNull()
  })
})
