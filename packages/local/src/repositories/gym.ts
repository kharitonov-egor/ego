import type {
  DistanceUnit, ExerciseType, ExerciseWeightUnit, GymSetLike, WeightUnit
} from '@ego/core'
import type { LocalDatabase } from '../database/types'

export interface GymCategoryView {
  id: string
  name: string
  color: string
  revision: number
  exerciseCount: number
}

export interface GymExerciseView {
  id: string
  name: string
  categoryId: string
  categoryName: string
  categoryColor: string
  type: ExerciseType
  weightUnit: ExerciseWeightUnit
  notes: string
  revision: number
  setCount: number
}

export interface GymSetView extends GymSetLike {
  exerciseId: string
  comment: string
  createdAt: string
  revision: number
}

export interface WorkoutExercise {
  exercise: GymExerciseView
  sets: GymSetView[]
}

export interface GymWorkoutView {
  revision: number
  exerciseOrder: string[]
  supersets: string[][]
  notes: string
}

export interface GymPlanView {
  id: string
  name: string
  exerciseOrder: string[]
  supersets: string[][]
  revision: number
}

export interface GymDay {
  date: string
  workout: GymWorkoutView | null
  /** Exercises with sets that day, and any the day's order lists without sets yet, like a started plan. */
  exercises: WorkoutExercise[]
  /** Superset groups limited to exercises done that day, in workout order. */
  supersets: string[][]
}

export interface CalendarDay {
  date: string
  colors: string[]
}

export interface ExerciseTrackSets {
  today: GymSetView[]
  previous: GymSetView | null
}

export interface ExerciseSetPage {
  items: GymSetView[]
  hasMore: boolean
  nextOffset: number | null
}

interface CategoryRow {
  id: string
  name: string
  color: string
  revision: number
  exercise_count: number
}

interface ExerciseRow {
  id: string
  name: string
  category_id: string
  category_name: string
  category_color: string
  type: ExerciseType
  weight_unit: ExerciseWeightUnit
  notes: string
  revision: number
  set_count: number
}

interface SetRow {
  id: string
  exercise_id: string
  date: string
  position: number
  weight: number | null
  weight_unit: WeightUnit | null
  reps: number | null
  distance: number | null
  distance_unit: DistanceUnit | null
  duration_seconds: number | null
  comment: string
  created_at: string
  revision: number
}

interface WorkoutRow {
  revision: number
  exercise_order: string
  supersets: string
  notes: string
}

interface PlanRow {
  id: string
  name: string
  exercise_order: string
  supersets: string
  revision: number
}

interface HistoryCache {
  version: number
  exercises: Map<string, Promise<GymSetView[]>>
}

const historyCaches = new WeakMap<LocalDatabase, HistoryCache>()

const EXERCISE_COLUMNS = `e.id, e.name, e.category_id, c.name AS category_name, c.color AS category_color,
  e.type, e.weight_unit, e.notes, e.revision,
  (SELECT COUNT(*) FROM gym_sets s WHERE s.exercise_id = e.id AND s.deleted_at IS NULL) AS set_count`

const EXERCISE_FROM = `FROM gym_exercises e
  JOIN gym_categories c ON c.id = e.category_id
  WHERE e.deleted_at IS NULL`

function toExercise(row: ExerciseRow): GymExerciseView {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    type: row.type,
    weightUnit: row.weight_unit,
    notes: row.notes,
    revision: row.revision,
    setCount: row.set_count
  }
}

function toSet(row: SetRow): GymSetView {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    date: row.date,
    position: row.position,
    weight: row.weight,
    weightUnit: row.weight_unit,
    reps: row.reps,
    distance: row.distance,
    distanceUnit: row.distance_unit,
    durationSeconds: row.duration_seconds,
    comment: row.comment,
    createdAt: row.created_at,
    revision: row.revision
  }
}

function parseList(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function supersetGroups(raw: string): string[][] {
  const groups = parseList(raw)
  return Array.isArray(groups) ? groups.map(strings).filter((group) => group.length >= 2) : []
}

function toWorkout(row: WorkoutRow): GymWorkoutView {
  return {
    revision: row.revision,
    exerciseOrder: strings(parseList(row.exercise_order)),
    supersets: supersetGroups(row.supersets),
    notes: row.notes
  }
}

export async function gymCategories(db: LocalDatabase): Promise<GymCategoryView[]> {
  const rows = await db.all<CategoryRow>(`SELECT c.id, c.name, c.color, c.revision,
      (SELECT COUNT(*) FROM gym_exercises e WHERE e.category_id = c.id AND e.deleted_at IS NULL) AS exercise_count
    FROM gym_categories c WHERE c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE`)
  return rows.map((row) => ({
    id: row.id, name: row.name, color: row.color, revision: row.revision, exerciseCount: row.exercise_count
  }))
}

export async function gymExercises(db: LocalDatabase): Promise<GymExerciseView[]> {
  const rows = await db.all<ExerciseRow>(`SELECT ${EXERCISE_COLUMNS} ${EXERCISE_FROM} ORDER BY e.name COLLATE NOCASE`)
  return rows.map(toExercise)
}

export async function gymPlans(db: LocalDatabase): Promise<GymPlanView[]> {
  const rows = await db.all<PlanRow>(`SELECT id, name, exercise_order, supersets, revision FROM gym_plans
    WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`)
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    exerciseOrder: strings(parseList(row.exercise_order)),
    supersets: supersetGroups(row.supersets),
    revision: row.revision
  }))
}

export async function gymWorkout(db: LocalDatabase, date: string): Promise<GymWorkoutView | null> {
  const rows = await db.all<WorkoutRow>(
    'SELECT revision, exercise_order, supersets, notes FROM gym_workouts WHERE id = ? AND deleted_at IS NULL', [date])
  return rows[0] ? toWorkout(rows[0]) : null
}

/**
 * The day's exercises in the order the workout record gives, then any exercise it does not list
 * in the order its first set was logged.
 */
export async function gymDay(db: LocalDatabase, date: string): Promise<GymDay> {
  const [setRows, workout] = await Promise.all([
    db.all<SetRow>(`SELECT s.* FROM gym_sets s
      JOIN gym_exercises e ON e.id = s.exercise_id AND e.deleted_at IS NULL
      WHERE s.date = ? AND s.deleted_at IS NULL
      ORDER BY s.position, s.created_at, s.id`, [date]),
    gymWorkout(db, date)
  ])
  const ids = [...new Set([...setRows.map((row) => row.exercise_id), ...(workout?.exerciseOrder ?? [])])]
  const exerciseRows = ids.length === 0 ? [] : await db.all<ExerciseRow>(
    `SELECT ${EXERCISE_COLUMNS} ${EXERCISE_FROM} AND e.id IN (${ids.map(() => '?').join(', ')})`, ids)
  const sets = new Map<string, GymSetView[]>()
  const firstLogged = new Map<string, string>()
  for (const row of setRows) {
    const set = toSet(row)
    const list = sets.get(set.exerciseId)
    if (list) list.push(set)
    else sets.set(set.exerciseId, [set])
    const first = firstLogged.get(set.exerciseId)
    if (!first || set.createdAt < first) firstLogged.set(set.exerciseId, set.createdAt)
  }
  const order = workout?.exerciseOrder ?? []
  const rank = (id: string): number => {
    const index = order.indexOf(id)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  const exercises = exerciseRows.map(toExercise).sort((left, right) =>
    rank(left.id) - rank(right.id) ||
    (firstLogged.get(left.id) ?? '').localeCompare(firstLogged.get(right.id) ?? '') ||
    left.name.localeCompare(right.name))
  const present = new Set(exercises.map((exercise) => exercise.id))
  const position = new Map(exercises.map((exercise, index) => [exercise.id, index]))
  const supersets = (workout?.supersets ?? [])
    .map((group) => group.filter((id) => present.has(id)).sort((left, right) => (position.get(left) ?? 0) - (position.get(right) ?? 0)))
    .filter((group) => group.length >= 2)
  return {
    date,
    workout,
    exercises: exercises.map((exercise) => ({ exercise, sets: sets.get(exercise.id) ?? [] })),
    supersets
  }
}

/** Every set of one exercise, newest day first and in logged order within a day. */
export async function exerciseSets(db: LocalDatabase, exerciseId: string): Promise<GymSetView[]> {
  const rows = await db.all<SetRow>(`SELECT * FROM gym_sets
    WHERE exercise_id = ? AND deleted_at IS NULL
    ORDER BY date DESC, position, created_at, id`, [exerciseId])
  return rows.map(toSet)
}

/** Shares the lifetime read between record badges, Records, and Graph until gym data changes. */
export function cachedExerciseSets(
  db: LocalDatabase, exerciseId: string, version: number
): Promise<GymSetView[]> {
  let cache = historyCaches.get(db)
  if (!cache || cache.version !== version) {
    cache = { version, exercises: new Map() }
    historyCaches.set(db, cache)
  }
  let pending = cache.exercises.get(exerciseId)
  if (!pending) {
    pending = exerciseSets(db, exerciseId)
    cache.exercises.set(exerciseId, pending)
  }
  return pending
}

/** The rows needed by Track before History or Graph opens. */
export async function exerciseTrackSets(
  db: LocalDatabase, exerciseId: string, date: string
): Promise<ExerciseTrackSets> {
  const [todayRows, previousRows] = await Promise.all([
    db.all<SetRow>(`SELECT * FROM gym_sets
      WHERE exercise_id = ? AND date = ? AND deleted_at IS NULL
      ORDER BY position, created_at, id`, [exerciseId, date]),
    db.all<SetRow>(`SELECT * FROM gym_sets
      WHERE exercise_id = ? AND date < ? AND deleted_at IS NULL
      ORDER BY date DESC, position, created_at, id LIMIT 1`, [exerciseId, date])
  ])
  return {
    today: todayRows.map(toSet),
    previous: previousRows[0] ? toSet(previousRows[0]) : null
  }
}

/**
 * The names of the exercises this one was supersetted with, by date. A partner counts only on a day
 * both have sets, the same rule the day view uses.
 */
export async function exerciseSupersetPartners(db: LocalDatabase, exerciseId: string): Promise<Map<string, string[]>> {
  const quoted = JSON.stringify(exerciseId)
  const [workouts, logged] = await Promise.all([
    db.all<{ id: string; supersets: string }>(`SELECT id, supersets FROM gym_workouts
      WHERE deleted_at IS NULL AND instr(supersets, ?) > 0`, [quoted]),
    db.all<{ date: string; exercise_id: string; name: string }>(`SELECT DISTINCT s.date, s.exercise_id, e.name
      FROM gym_sets s
      JOIN gym_exercises e ON e.id = s.exercise_id AND e.deleted_at IS NULL
      JOIN gym_workouts w ON w.id = s.date AND w.deleted_at IS NULL AND instr(w.supersets, ?) > 0
      WHERE s.deleted_at IS NULL`, [quoted])
  ])
  const present = new Map<string, Map<string, string>>()
  for (const row of logged) {
    const day = present.get(row.date) ?? new Map<string, string>()
    day.set(row.exercise_id, row.name)
    present.set(row.date, day)
  }
  const partners = new Map<string, string[]>()
  for (const workout of workouts) {
    const day = present.get(workout.id)
    const group = supersetGroups(workout.supersets).find((members) => members.includes(exerciseId))
    if (!day || !group || !day.has(exerciseId)) continue
    const names = group.flatMap((id) => {
      const name = id === exerciseId ? undefined : day.get(id)
      return name === undefined ? [] : [name]
    })
    if (names.length > 0) partners.set(workout.id, names)
  }
  return partners
}

/** A bounded slice for History. Graph and record calculations use their own reads. */
export async function exerciseSetsPage(
  db: LocalDatabase, exerciseId: string, pageSize: number, offset = 0
): Promise<ExerciseSetPage> {
  const rows = await db.all<SetRow>(`SELECT * FROM gym_sets
    WHERE exercise_id = ? AND deleted_at IS NULL
    ORDER BY date DESC, position, created_at, id
    LIMIT ? OFFSET ?`, [exerciseId, pageSize + 1, offset])
  const hasMore = rows.length > pageSize
  const items = rows.slice(0, pageSize).map(toSet)
  return { items, hasMore, nextOffset: hasMore ? offset + items.length : null }
}

export async function gymExercise(db: LocalDatabase, id: string): Promise<GymExerciseView | null> {
  const rows = await db.all<ExerciseRow>(`SELECT ${EXERCISE_COLUMNS} ${EXERCISE_FROM} AND e.id = ?`, [id])
  return rows[0] ? toExercise(rows[0]) : null
}

/** Each workout day with one color per category trained, in category name order. */
export async function gymCalendar(db: LocalDatabase): Promise<CalendarDay[]> {
  const rows = await db.all<{ date: string; color: string }>(`SELECT s.date, c.color
    FROM gym_sets s
    JOIN gym_exercises e ON e.id = s.exercise_id AND e.deleted_at IS NULL
    JOIN gym_categories c ON c.id = e.category_id
    WHERE s.deleted_at IS NULL
    GROUP BY s.date, c.id
    ORDER BY s.date, c.name COLLATE NOCASE`)
  const days: CalendarDay[] = []
  for (const row of rows) {
    const last = days[days.length - 1]
    if (last && last.date === row.date) last.colors.push(row.color)
    else days.push({ date: row.date, colors: [row.color] })
  }
  return days
}

export async function nextSetPosition(db: LocalDatabase, exerciseId: string, date: string): Promise<number> {
  const rows = await db.all<{ next: number }>(`SELECT COALESCE(MAX(position) + 1, 0) AS next FROM gym_sets
    WHERE exercise_id = ? AND date = ? AND deleted_at IS NULL`, [exerciseId, date])
  return rows[0]?.next ?? 0
}

export async function gymRevision(
  db: LocalDatabase, table: 'gym_categories' | 'gym_exercises' | 'gym_sets' | 'gym_plans', id: string
): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(`SELECT revision FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
  return rows[0]?.revision ?? null
}
