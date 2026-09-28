import { describe, expect, it } from 'vitest'
import {
  convertWeight, estimatedOneRepMax, exerciseRecords, formatSetDuration, formatWeight, graphMetricsFor,
  graphPoints, isGymExerciseInput, isGymSetInput, isGymWorkoutInput, joinSuperset, parseDuration,
  withoutSuperset, type GymSetInput, type GymSetLike
} from '../src/gym'
import {
  GYM_LIBRARY_CATEGORIES, GYM_LIBRARY_EXERCISES, customExerciseId, libraryExerciseId, slugify
} from '../src/gym-library'
import { parseCsv, parseFitNotesCsv, planFitNotesImport } from '../src/fitnotes'

const set = (overrides: Partial<GymSetInput> = {}): GymSetInput => ({
  exerciseId: 'ge-barbell-squat', date: '2026-09-27', position: 0, weight: 25, weightUnit: 'lbs',
  reps: 12, distance: null, distanceUnit: null, durationSeconds: null, comment: '', ...overrides
})

const logged = (id: string, date: string, weight: number | null, reps: number | null, position = 0): GymSetLike => ({
  id, date, position, weight, weightUnit: weight === null ? null : 'lbs', reps,
  distance: null, distanceUnit: null, durationSeconds: null
})

describe('gym input validation', () => {
  it('accepts a weight and reps set', () => {
    expect(isGymSetInput(set())).toBe(true)
  })

  it('requires a unit exactly when a weight or distance is present', () => {
    expect(isGymSetInput(set({ weightUnit: null }))).toBe(false)
    expect(isGymSetInput(set({ weight: null, weightUnit: 'lbs' }))).toBe(false)
    expect(isGymSetInput(set({ weight: null, weightUnit: null, reps: null, distance: 1.53, distanceUnit: null }))).toBe(false)
  })

  it('rejects an empty set, a negative weight, and fractional reps', () => {
    expect(isGymSetInput(set({ weight: null, weightUnit: null, reps: null }))).toBe(false)
    expect(isGymSetInput(set({ weight: -5 }))).toBe(false)
    expect(isGymSetInput(set({ reps: 2.5 }))).toBe(false)
  })

  it('checks exercise type and unit names', () => {
    const exercise = { name: 'Тянуяка', categoryId: 'gc-back', type: 'weight_reps', weightUnit: 'default', notes: '' }
    expect(isGymExerciseInput(exercise)).toBe(true)
    expect(isGymExerciseInput({ ...exercise, type: 'cardio' })).toBe(false)
    expect(isGymExerciseInput({ ...exercise, weightUnit: 'stone' })).toBe(false)
    expect(isGymExerciseInput({ ...exercise, name: '  ' })).toBe(false)
  })

  it('keeps an exercise in one superset at most', () => {
    const workout = { date: '2026-09-27', exerciseOrder: ['a', 'b', 'c'], supersets: [['a', 'b']], notes: '' }
    expect(isGymWorkoutInput(workout)).toBe(true)
    expect(isGymWorkoutInput({ ...workout, supersets: [['a', 'b'], ['b', 'c']] })).toBe(false)
    expect(isGymWorkoutInput({ ...workout, supersets: [['a']] })).toBe(false)
    expect(isGymWorkoutInput({ ...workout, exerciseOrder: ['a', 'a'] })).toBe(false)
  })
})

describe('gym formatting', () => {
  it('shows weights the way FitNotes does', () => {
    expect(formatWeight(25)).toBe('25.0')
    expect(formatWeight(27.5)).toBe('27.5')
    expect(formatWeight(11.339)).toBe('11.34')
  })

  it('round-trips durations', () => {
    expect(parseDuration('0:00:40')).toBe(40)
    expect(parseDuration('0:32:06')).toBe(1926)
    expect(parseDuration('1:30')).toBe(90)
    expect(parseDuration('45')).toBe(45)
    expect(parseDuration('1:75')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(formatSetDuration(40)).toBe('0:40')
    expect(formatSetDuration(1926)).toBe('32:06')
    expect(formatSetDuration(3723)).toBe('1:02:03')
  })

  it('converts between pounds and kilograms', () => {
    expect(convertWeight(100, 'kg', 'lbs')).toBeCloseTo(220.462, 2)
    expect(convertWeight(convertWeight(25, 'lbs', 'kg'), 'kg', 'lbs')).toBeCloseTo(25, 10)
  })
})

describe('records', () => {
  it('estimates a one-rep max with Epley', () => {
    expect(estimatedOneRepMax(100, 1)).toBe(100)
    expect(estimatedOneRepMax(100, 10)).toBeCloseTo(133.33, 2)
    expect(estimatedOneRepMax(100, 0)).toBeNull()
  })

  it('keeps only rep maxes that nothing heavier beat for as many reps', () => {
    const sets = [
      logged('a', '2026-01-01', 100, 5),
      logged('b', '2026-01-08', 90, 8),
      logged('c', '2026-01-15', 95, 3),
      logged('d', '2026-01-22', 100, 5)
    ]
    const records = exerciseRecords(sets, 'weight_reps', 'lbs', 'mi')
    expect(records.repMaxes.map((record) => [record.reps, record.weight])).toEqual([[5, 100], [8, 90]])
    expect([...records.recordSetIds].sort()).toEqual(['a', 'b'])
    expect(records.heaviestWeight?.value).toBe(100)
    expect(records.bestWorkoutVolume?.value).toBe(720)
  })

  it('marks the longest hold for a time exercise', () => {
    const sets: GymSetLike[] = [
      { ...logged('p1', '2024-03-15', null, null), durationSeconds: 40 },
      { ...logged('p2', '2024-03-20', null, null), durationSeconds: 60 }
    ]
    expect([...exerciseRecords(sets, 'time', 'lbs', 'mi').recordSetIds]).toEqual(['p2'])
  })

  it('plots one point per day in the display unit', () => {
    const sets = [
      logged('a', '2026-01-01', 100, 5),
      logged('b', '2026-01-01', 110, 3, 1),
      { ...logged('c', '2026-01-08', 50, 5), weightUnit: 'kg' as const }
    ]
    const points = graphPoints(sets, 'max_weight', 'lbs', 'mi')
    expect(points.map((point) => point.date)).toEqual(['2026-01-01', '2026-01-08'])
    expect(points[0].value).toBe(110)
    expect(points[1].value).toBeCloseTo(110.23, 2)
    expect(graphMetricsFor('reps')).toEqual(['max_reps', 'workout_reps'])
  })
})

describe('supersets', () => {
  it('merges groups when joining and drops a group left with one member', () => {
    const joined = joinSuperset([['a', 'b']], 'c', 'a')
    expect(joined).toEqual([['c', 'a', 'b']])
    expect(withoutSuperset([['a', 'b']], 'a')).toEqual([])
  })
})

describe('library', () => {
  it('has unique IDs within the length the sync API accepts', () => {
    const ids = [...GYM_LIBRARY_CATEGORIES.map((item) => item.id), ...GYM_LIBRARY_EXERCISES.map((item) => item.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length <= 64)).toBe(true)
    expect(slugify('Running (Outdoor)')).toBe('running-outdoor')
    expect(GYM_LIBRARY_EXERCISES.every((item) => isGymExerciseInput(item.input))).toBe(true)
  })
})

const SAMPLE = [
  'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment',
  '2024-03-13,Flat Barbell Bench Press,Chest,10.0,lbs,12,,,,""',
  '2024-03-13,Flat Barbell Bench Press,Chest,25.0,lbs,9,,,,"Артем помогал"',
  '2024-03-15,Barbell Squat,Legs,15.0,lbs,12,,,,""',
  '2024-03-15,Колокол,Пресс,,,20,,,,""',
  '2024-03-15,Военный,Пресс,,,,,,0:00:40,""',
  '2024-03-15,Barbell Squat,Legs,20.0,lbs,12,,,,""',
  '2024-03-16,Treadmill + incline,Cardio,,,,1.53,mi,0:32:06,""',
  '2024-03-17,Barbell Bent Over Row,Biceps,20.0,lbs,10,,,,"Плохо сделал, техника плохая"',
  '2024-03-18,Test1,Chest,5.0,lbs,5,,,,""'
].join('\n')

describe('FitNotes import', () => {
  it('parses quoted commas and Cyrillic text', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n')).toEqual([['a', 'b, c', 'd "e"']])
    const { rows, problems } = parseFitNotesCsv(SAMPLE)
    expect(problems).toEqual([])
    expect(rows).toHaveLength(9)
    expect(rows[1].comment).toBe('Артем помогал')
    expect(rows[4]).toMatchObject({ exercise: 'Военный', weight: null, reps: null, durationSeconds: 40 })
    expect(rows[6]).toMatchObject({ distance: 1.53, distanceUnit: 'mi', durationSeconds: 1926 })
  })

  it('reports lines it cannot read instead of guessing', () => {
    const { rows, problems } = parseFitNotesCsv('Date,Exercise,Category,Weight,Weight Unit,Reps\n27/09/2026,Squat,Legs,25,lbs,12\n')
    expect(rows).toEqual([])
    expect(problems[0]).toContain('Line 2')
  })

  it('applies the cleanup rules and reuses library exercises by name', () => {
    const plan = planFitNotesImport(parseFitNotesCsv(SAMPLE).rows, {
      skipExercises: ['Test1'],
      categoryMerges: { 'Пресс': 'Abs' },
      exerciseCategories: { 'Barbell Bent Over Row': 'Back' }
    })
    expect(plan.skippedRows).toBe(1)
    expect(plan.categories.map((category) => category.input.name)).not.toContain('Пресс')
    const byName = new Map(plan.exercises.map((exercise) => [exercise.input.name, exercise]))
    expect(byName.get('Barbell Squat')?.id).toBe(libraryExerciseId('Barbell Squat'))
    expect(byName.get('Колокол')).toMatchObject({ id: customExerciseId('Колокол'), input: { categoryId: 'gc-abs', type: 'reps' } })
    expect(byName.get('Военный')?.input.type).toBe('time')
    expect(byName.get('Treadmill + incline')?.input.type).toBe('distance_time')
    expect(byName.get('Barbell Bent Over Row')?.input.categoryId).toBe('gc-back')
    expect(byName.has('Test1')).toBe(false)
    expect(plan.exercises.length).toBe(GYM_LIBRARY_EXERCISES.length + 4)

    expect(plan.sets).toHaveLength(8)
    expect(plan.sets.every((item) => isGymSetInput(item.input))).toBe(true)
    expect(new Set(plan.sets.map((item) => item.id)).size).toBe(8)
    const squats = plan.sets.filter((item) => item.input.exerciseId === libraryExerciseId('Barbell Squat'))
    expect(squats.map((item) => item.input.position)).toEqual([0, 1])

    const march15 = plan.workouts.find((workout) => workout.date === '2024-03-15')
    expect(march15?.exerciseOrder).toEqual([
      libraryExerciseId('Barbell Squat'), customExerciseId('Колокол'), customExerciseId('Военный')
    ])
    expect(plan.workouts.every(isGymWorkoutInput)).toBe(true)
  })

  it('produces the same IDs every time', () => {
    const rows = parseFitNotesCsv(SAMPLE).rows
    expect(planFitNotesImport(rows).sets.map((item) => item.id)).toEqual(planFitNotesImport(rows).sets.map((item) => item.id))
  })
})
