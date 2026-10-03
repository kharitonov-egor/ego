import { afterEach, describe, expect, it } from 'vitest'
import type { LocalDatabase } from '../src/database/types'
import { exerciseSetsPage, exerciseSupersetPartners, exerciseTrackSets, gymDay } from '../src/repositories/gym'
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

  it('shows exercises the day lists without sets yet, in the listed order', async () => {
    db = await openTestLedger()
    await db.run(`INSERT INTO gym_categories
      (id, name, color, created_at, updated_at, revision, deleted_at)
      VALUES ('category-1', 'Strength', '#ffffff', '2026-01-01', '2026-01-01', 1, NULL)`)
    for (const [id, name, deleted] of [['squat', 'Squat', null], ['press', 'Leg Press', null], ['gone', 'Gone', '2026-02-01']]) {
      await db.run(`INSERT INTO gym_exercises
        (id, name, category_id, type, weight_unit, notes, created_at, updated_at, revision, deleted_at)
        VALUES (?, ?, 'category-1', 'weight_reps', 'lbs', '', '2026-01-01', '2026-01-01', 1, ?)`, [id, name, deleted])
    }
    await db.run(`INSERT INTO gym_sets
      (id, exercise_id, date, position, weight, weight_unit, reps, distance, distance_unit,
        duration_seconds, comment, created_at, updated_at, revision, deleted_at)
      VALUES ('set-1', 'press', '2026-09-30', 0, 200, 'lbs', 8, NULL, NULL, NULL, '', '2026-09-30T10:00:00.000Z',
        '2026-09-30T10:00:00.000Z', 1, NULL)`)
    await db.run(`INSERT INTO gym_workouts (id, exercise_order, supersets, notes, created_at, updated_at, revision, deleted_at)
      VALUES ('2026-09-30', '["squat","gone","press"]', '[["squat","press"]]', '', '2026-09-30', '2026-09-30', 1, NULL)`)

    const day = await gymDay(db, '2026-09-30')
    expect(day.exercises.map((item) => [item.exercise.id, item.sets.length])).toEqual([['squat', 0], ['press', 1]])
    expect(day.supersets).toEqual([['squat', 'press']])
    expect((await gymDay(db, '2026-09-29')).exercises).toEqual([])
  })

  it('names superset partners only on days both exercises have sets', async () => {
    db = await openTestLedger()
    await db.run(`INSERT INTO gym_categories
      (id, name, color, created_at, updated_at, revision, deleted_at)
      VALUES ('category-1', 'Strength', '#ffffff', '2026-01-01', '2026-01-01', 1, NULL)`)
    for (const [id, name] of [['bench', 'Bench Press'], ['row', 'Barbell Row'], ['dips', 'Dips'], ['bench-2', 'Incline Bench']]) {
      await db.run(`INSERT INTO gym_exercises
        (id, name, category_id, type, weight_unit, notes, created_at, updated_at, revision, deleted_at)
        VALUES (?, ?, 'category-1', 'weight_reps', 'lbs', '', '2026-01-01', '2026-01-01', 1, NULL)`, [id, name])
    }
    const logged: [string, string][] = [
      ['bench', '2026-09-01'], ['row', '2026-09-01'], ['dips', '2026-09-01'],
      ['bench', '2026-09-03'],
      ['bench', '2026-09-05'], ['row', '2026-09-05'],
      ['bench-2', '2026-09-07'], ['row', '2026-09-07']
    ]
    for (const [index, [exercise, day]] of logged.entries()) {
      await db.run(`INSERT INTO gym_sets
        (id, exercise_id, date, position, weight, weight_unit, reps, distance, distance_unit,
          duration_seconds, comment, created_at, updated_at, revision, deleted_at)
        VALUES (?, ?, ?, 0, 100, 'lbs', 5, NULL, NULL, NULL, '', ?, ?, 1, NULL)`,
      [`set-${index}`, exercise, day, `${day}T10:00:00.000Z`, `${day}T10:00:00.000Z`])
    }
    const workouts: [string, string[][]][] = [
      ['2026-09-01', [['bench', 'row', 'dips']]],
      ['2026-09-03', [['bench', 'row']]],
      ['2026-09-05', [['dips', 'row']]],
      ['2026-09-07', [['bench-2', 'row']]]
    ]
    for (const [day, supersets] of workouts) {
      await db.run(`INSERT INTO gym_workouts (id, exercise_order, supersets, notes, created_at, updated_at, revision, deleted_at)
        VALUES (?, '[]', ?, '', ?, ?, 1, NULL)`, [day, JSON.stringify(supersets), day, day])
    }

    const partners = await exerciseSupersetPartners(db, 'bench')
    expect([...partners.entries()]).toEqual([['2026-09-01', ['Barbell Row', 'Dips']]])
    expect([...(await exerciseSupersetPartners(db, 'row')).entries()].sort()).toEqual([
      ['2026-09-01', ['Bench Press', 'Dips']],
      ['2026-09-07', ['Incline Bench']]
    ])
  })
})
