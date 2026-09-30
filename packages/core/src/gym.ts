export type WeightUnit = 'lbs' | 'kg'
export type DistanceUnit = 'mi' | 'km' | 'm'
export type ExerciseWeightUnit = 'default' | WeightUnit

export type ExerciseType =
  | 'weight_reps'
  | 'weight_distance'
  | 'weight_time'
  | 'reps_distance'
  | 'reps_time'
  | 'distance_time'
  | 'weight'
  | 'reps'
  | 'distance'
  | 'time'

export type SetField = 'weight' | 'reps' | 'distance' | 'time'

export const EXERCISE_TYPES: readonly ExerciseType[] = [
  'weight_reps', 'weight_distance', 'weight_time', 'reps_distance', 'reps_time', 'distance_time',
  'weight', 'reps', 'distance', 'time'
]

export const EXERCISE_TYPE_FIELDS: Record<ExerciseType, readonly SetField[]> = {
  weight_reps: ['weight', 'reps'],
  weight_distance: ['weight', 'distance'],
  weight_time: ['weight', 'time'],
  reps_distance: ['reps', 'distance'],
  reps_time: ['reps', 'time'],
  distance_time: ['distance', 'time'],
  weight: ['weight'],
  reps: ['reps'],
  distance: ['distance'],
  time: ['time']
}

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  weight_reps: 'Weight and reps',
  weight_distance: 'Weight and distance',
  weight_time: 'Weight and time',
  reps_distance: 'Reps and distance',
  reps_time: 'Reps and time',
  distance_time: 'Distance and time',
  weight: 'Weight',
  reps: 'Reps',
  distance: 'Distance',
  time: 'Time'
}

export const WEIGHT_UNITS: readonly WeightUnit[] = ['lbs', 'kg']
export const DISTANCE_UNITS: readonly DistanceUnit[] = ['mi', 'km', 'm']
export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'lbs'
export const DEFAULT_DISTANCE_UNIT: DistanceUnit = 'mi'

/**
 * The eight dark-mode categorical slots, in their validated order. Adjacent dots on the calendar
 * stay distinguishable under protanopia and deuteranopia against the black screen.
 */
export const GYM_CATEGORY_COLORS = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'
] as const

export interface GymCategoryInput {
  name: string
  color: string
}

export interface GymCategory extends GymCategoryInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface GymExerciseInput {
  name: string
  categoryId: string
  type: ExerciseType
  weightUnit: ExerciseWeightUnit
  notes: string
}

export interface GymExercise extends GymExerciseInput {
  id: string
  createdAt: string
  updatedAt: string
}

/** One logged set. Only the fields the exercise type uses are set; the rest stay null. */
export interface GymSetInput {
  exerciseId: string
  date: string
  /** Order among this exercise's sets on this date. Gaps after a delete are fine. */
  position: number
  weight: number | null
  weightUnit: WeightUnit | null
  reps: number | null
  distance: number | null
  distanceUnit: DistanceUnit | null
  durationSeconds: number | null
  comment: string
}

export interface GymSet extends GymSetInput {
  id: string
  createdAt: string
  updatedAt: string
}

/**
 * A day's arrangement. The sets say which exercises were done; this record only orders them and
 * groups supersets. Its ID is the date itself.
 */
export interface GymWorkoutInput {
  date: string
  exerciseOrder: string[]
  supersets: string[][]
  notes: string
}

export interface GymWorkout extends GymWorkoutInput {
  id: string
  createdAt: string
  updatedAt: string
}

/** A named list of exercises, in order and with supersets, that can start any day's workout. */
export interface GymPlanInput {
  name: string
  exerciseOrder: string[]
  supersets: string[][]
}

export interface GymPlan extends GymPlanInput {
  id: string
  createdAt: string
  updatedAt: string
}

const MAX_WEIGHT = 10000
const MAX_REPS = 100000
const MAX_DISTANCE = 100000
const MAX_DURATION_SECONDS = 7 * 24 * 60 * 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

function isName(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
}

function isMeasure(value: unknown, max: number): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max)
}

function isCount(value: unknown, max: number): boolean {
  return value === null || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max)
}

export function isExerciseType(value: unknown): value is ExerciseType {
  return typeof value === 'string' && (EXERCISE_TYPES as readonly string[]).includes(value)
}

export function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lbs' || value === 'kg'
}

export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === 'mi' || value === 'km' || value === 'm'
}

export function isGymCategoryInput(value: unknown): value is GymCategoryInput {
  return isRecord(value) && isName(value.name, 60) &&
    typeof value.color === 'string' && value.color.length > 0 && value.color.length <= 20
}

export function isGymExerciseInput(value: unknown): value is GymExerciseInput {
  return isRecord(value) && isName(value.name, 100) && isIdentifier(value.categoryId) &&
    isExerciseType(value.type) &&
    (value.weightUnit === 'default' || isWeightUnit(value.weightUnit)) &&
    typeof value.notes === 'string' && value.notes.length <= 1000
}

export function isGymSetInput(value: unknown): value is GymSetInput {
  if (!isRecord(value) || !isIdentifier(value.exerciseId) || !isDate(value.date)) return false
  if (!Number.isSafeInteger(value.position) || Number(value.position) < 0 || Number(value.position) > 10000) return false
  if (!isMeasure(value.weight, MAX_WEIGHT) || !isCount(value.reps, MAX_REPS) ||
    !isMeasure(value.distance, MAX_DISTANCE) || !isCount(value.durationSeconds, MAX_DURATION_SECONDS)) return false
  if ((value.weight === null) !== (value.weightUnit === null)) return false
  if (value.weightUnit !== null && !isWeightUnit(value.weightUnit)) return false
  if ((value.distance === null) !== (value.distanceUnit === null)) return false
  if (value.distanceUnit !== null && !isDistanceUnit(value.distanceUnit)) return false
  if (value.weight === null && value.reps === null && value.distance === null && value.durationSeconds === null) return false
  return typeof value.comment === 'string' && value.comment.length <= 500
}

/** An exercise order without repeats, and superset groups that never share an exercise. */
function isArrangement(exerciseOrder: unknown, supersets: unknown): boolean {
  if (!Array.isArray(exerciseOrder) || exerciseOrder.length > 200 ||
    !exerciseOrder.every(isIdentifier) || new Set(exerciseOrder).size !== exerciseOrder.length) return false
  if (!Array.isArray(supersets) || supersets.length > 50) return false
  const grouped = new Set<string>()
  return supersets.every((group) => {
    if (!Array.isArray(group) || group.length < 2 || group.length > 20 || !group.every(isIdentifier)) return false
    for (const id of group) {
      if (grouped.has(id)) return false
      grouped.add(id)
    }
    return true
  })
}

export function isGymWorkoutInput(value: unknown): value is GymWorkoutInput {
  if (!isRecord(value) || !isDate(value.date) || typeof value.notes !== 'string' || value.notes.length > 1000) return false
  return isArrangement(value.exerciseOrder, value.supersets)
}

export function isGymPlanInput(value: unknown): value is GymPlanInput {
  return isRecord(value) && isName(value.name, 60) && isArrangement(value.exerciseOrder, value.supersets)
}

export function fieldsFor(type: ExerciseType): readonly SetField[] {
  return EXERCISE_TYPE_FIELDS[type]
}

export function usesWeight(type: ExerciseType): boolean {
  return EXERCISE_TYPE_FIELDS[type].includes('weight')
}

export function displayWeightUnit(unit: ExerciseWeightUnit, fallback: WeightUnit = DEFAULT_WEIGHT_UNIT): WeightUnit {
  return unit === 'default' ? fallback : unit
}

const POUNDS_PER_KILOGRAM = 2.2046226218

export function convertWeight(value: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return value
  return from === 'kg' ? value * POUNDS_PER_KILOGRAM : value / POUNDS_PER_KILOGRAM
}

const METERS: Record<DistanceUnit, number> = { m: 1, km: 1000, mi: 1609.344 }

export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return value
  return value * METERS[from] / METERS[to]
}

export function roundTo(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** 25 reads "25.0" the way FitNotes shows it; 27.25 keeps its second place. */
export function formatWeight(value: number): string {
  const rounded = roundTo(value, 2)
  return Number.isInteger(rounded * 10) ? rounded.toFixed(1) : rounded.toFixed(2)
}

export function formatDistance(value: number): string {
  const rounded = roundTo(value, 2)
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded)
}

export function formatSetDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** Accepts "40", "1:30", and "0:01:30". Returns null for anything else. */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+(:\d{1,2}){0,2}$/.test(trimmed)) return null
  const parts = trimmed.split(':').map(Number)
  if (parts.slice(1).some((part) => part >= 60)) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/** Epley. A single rep is its own maximum, and a set without reps has none. */
export function estimatedOneRepMax(weight: number, reps: number): number | null {
  if (reps <= 0 || weight <= 0) return null
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}

export interface GymSetLike {
  id: string
  date: string
  position: number
  weight: number | null
  weightUnit: WeightUnit | null
  reps: number | null
  distance: number | null
  distanceUnit: DistanceUnit | null
  durationSeconds: number | null
  createdAt?: string
}

export function setWeightIn(set: GymSetLike, unit: WeightUnit): number | null {
  if (set.weight === null) return null
  return convertWeight(set.weight, set.weightUnit ?? unit, unit)
}

export function setDistanceIn(set: GymSetLike, unit: DistanceUnit): number | null {
  if (set.distance === null) return null
  return convertDistance(set.distance, set.distanceUnit ?? unit, unit)
}

function chronological<T extends GymSetLike>(sets: readonly T[]): T[] {
  return [...sets].sort((left, right) => left.date.localeCompare(right.date) ||
    left.position - right.position || (left.createdAt ?? '').localeCompare(right.createdAt ?? '') ||
    left.id.localeCompare(right.id))
}

export interface RepRecord {
  reps: number
  weight: number
  date: string
  setId: string
}

export interface RecordValue {
  value: number
  date: string
  setId: string | null
}

export interface ExerciseRecords {
  /** Heaviest weight at each rep count that nothing heavier was lifted for as many reps. */
  repMaxes: RepRecord[]
  estimatedOneRepMax: RecordValue | null
  heaviestWeight: RecordValue | null
  mostReps: RecordValue | null
  bestSetVolume: RecordValue | null
  bestWorkoutVolume: RecordValue | null
  longestDistance: RecordValue | null
  longestTime: RecordValue | null
  /** Sets that currently hold a record. The first set to reach a value keeps it. */
  recordSetIds: Set<string>
}

function better(current: RecordValue | null, value: number, date: string, setId: string | null): RecordValue | null {
  if (value <= 0) return current
  if (current && current.value >= value) return current
  return { value, date, setId }
}

/**
 * Records in the unit the exercise displays, so a set logged in kilograms competes fairly with
 * one logged in pounds.
 */
export function exerciseRecords(
  sets: readonly GymSetLike[], type: ExerciseType, weightUnit: WeightUnit, distanceUnit: DistanceUnit
): ExerciseRecords {
  const fields = EXERCISE_TYPE_FIELDS[type]
  const hasWeight = fields.includes('weight')
  const hasReps = fields.includes('reps')
  const ordered = chronological(sets)
  const byReps = new Map<number, RepRecord>()
  let estimated: RecordValue | null = null
  let heaviest: RecordValue | null = null
  let mostReps: RecordValue | null = null
  let setVolume: RecordValue | null = null
  let distance: RecordValue | null = null
  let time: RecordValue | null = null
  const volumeByDate = new Map<string, number>()

  for (const set of ordered) {
    const weight = setWeightIn(set, weightUnit)
    const reps = set.reps
    if (hasWeight && weight !== null) heaviest = better(heaviest, weight, set.date, set.id)
    if (hasReps && reps !== null) mostReps = better(mostReps, reps, set.date, set.id)
    if (hasWeight && hasReps && weight !== null && reps !== null && reps > 0) {
      const existing = byReps.get(reps)
      if (!existing || weight > existing.weight) byReps.set(reps, { reps, weight, date: set.date, setId: set.id })
      const oneRep = estimatedOneRepMax(weight, reps)
      if (oneRep !== null) estimated = better(estimated, oneRep, set.date, set.id)
      setVolume = better(setVolume, weight * reps, set.date, set.id)
      volumeByDate.set(set.date, (volumeByDate.get(set.date) ?? 0) + weight * reps)
    }
    const meters = setDistanceIn(set, distanceUnit)
    if (fields.includes('distance') && meters !== null) distance = better(distance, meters, set.date, set.id)
    if (fields.includes('time') && set.durationSeconds !== null) time = better(time, set.durationSeconds, set.date, set.id)
  }

  const repMaxes: RepRecord[] = []
  let heavierAbove = -Infinity
  for (const record of [...byReps.values()].sort((left, right) => right.reps - left.reps)) {
    if (record.weight > heavierAbove) {
      repMaxes.push(record)
      heavierAbove = record.weight
    }
  }
  repMaxes.sort((left, right) => left.reps - right.reps)

  let workoutVolume: RecordValue | null = null
  for (const [date, volume] of [...volumeByDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    workoutVolume = better(workoutVolume, volume, date, null)
  }

  const recordSetIds = new Set<string>()
  if (hasWeight && hasReps) {
    for (const record of repMaxes) recordSetIds.add(record.setId)
  } else {
    const primary = hasWeight ? heaviest : hasReps ? mostReps : fields.includes('distance') ? distance : time
    if (primary?.setId) recordSetIds.add(primary.setId)
  }

  return {
    repMaxes,
    estimatedOneRepMax: estimated,
    heaviestWeight: heaviest,
    mostReps,
    bestSetVolume: setVolume,
    bestWorkoutVolume: workoutVolume,
    longestDistance: distance,
    longestTime: time,
    recordSetIds
  }
}

export type GraphMetric =
  | 'estimated_1rm'
  | 'max_weight'
  | 'max_reps'
  | 'workout_volume'
  | 'workout_reps'
  | 'max_distance'
  | 'workout_distance'
  | 'max_time'
  | 'workout_time'

export const GRAPH_METRIC_LABELS: Record<GraphMetric, string> = {
  estimated_1rm: 'Estimated 1RM',
  max_weight: 'Max weight',
  max_reps: 'Max reps',
  workout_volume: 'Workout volume',
  workout_reps: 'Workout reps',
  max_distance: 'Max distance',
  workout_distance: 'Workout distance',
  max_time: 'Max time',
  workout_time: 'Workout time'
}

export function graphMetricsFor(type: ExerciseType): GraphMetric[] {
  const fields = EXERCISE_TYPE_FIELDS[type]
  const metrics: GraphMetric[] = []
  if (fields.includes('weight') && fields.includes('reps')) metrics.push('estimated_1rm')
  if (fields.includes('weight')) metrics.push('max_weight')
  if (fields.includes('reps')) metrics.push('max_reps')
  if (fields.includes('weight') && fields.includes('reps')) metrics.push('workout_volume')
  if (fields.includes('reps')) metrics.push('workout_reps')
  if (fields.includes('distance')) metrics.push('max_distance', 'workout_distance')
  if (fields.includes('time')) metrics.push('max_time', 'workout_time')
  return metrics
}

export interface GraphPoint {
  date: string
  value: number
}

/** One point per workout day that has something to plot, oldest first. */
export function graphPoints(
  sets: readonly GymSetLike[], metric: GraphMetric, weightUnit: WeightUnit, distanceUnit: DistanceUnit
): GraphPoint[] {
  const byDate = new Map<string, GymSetLike[]>()
  for (const set of chronological(sets)) {
    const day = byDate.get(set.date)
    if (day) day.push(set)
    else byDate.set(set.date, [set])
  }
  const points: GraphPoint[] = []
  for (const [date, day] of byDate) {
    let value = 0
    for (const set of day) {
      const weight = setWeightIn(set, weightUnit) ?? 0
      const reps = set.reps ?? 0
      const meters = setDistanceIn(set, distanceUnit) ?? 0
      const seconds = set.durationSeconds ?? 0
      switch (metric) {
        case 'estimated_1rm': value = Math.max(value, estimatedOneRepMax(weight, reps) ?? 0); break
        case 'max_weight': value = Math.max(value, weight); break
        case 'max_reps': value = Math.max(value, reps); break
        case 'workout_volume': value += weight * reps; break
        case 'workout_reps': value += reps; break
        case 'max_distance': value = Math.max(value, meters); break
        case 'workout_distance': value += meters; break
        case 'max_time': value = Math.max(value, seconds); break
        case 'workout_time': value += seconds; break
      }
    }
    if (value > 0) points.push({ date, value: roundTo(value, 2) })
  }
  return points
}

/** Sets across two or more exercises alternate, so each group lists the exercises it links. */
export function supersetOf(supersets: readonly string[][], exerciseId: string): string[] | null {
  return supersets.find((group) => group.includes(exerciseId)) ?? null
}

/** The superset groups after one exercise leaves, dropping any group left with a single member. */
export function withoutSuperset(supersets: readonly string[][], exerciseId: string): string[][] {
  return supersets
    .map((group) => group.filter((id) => id !== exerciseId))
    .filter((group) => group.length >= 2)
}

/** Joins two exercises, merging their existing groups so an exercise is never in two supersets. */
export function joinSuperset(supersets: readonly string[][], first: string, second: string): string[][] {
  if (first === second) return supersets.map((group) => [...group])
  const firstGroup = supersetOf(supersets, first)
  const secondGroup = supersetOf(supersets, second)
  const merged = [...new Set([...(firstGroup ?? [first]), ...(secondGroup ?? [second])])]
  return [...supersets.filter((group) => group !== firstGroup && group !== secondGroup), merged]
}

/** The order of a day or a plan and its superset groups. */
export interface GymArrangement {
  exerciseOrder: string[]
  supersets: string[][]
}

/** Moves each superset's exercises next to each other, where the first of them stands. */
export function gatherSupersets(arrangement: GymArrangement): GymArrangement {
  let order = [...arrangement.exerciseOrder]
  for (const group of arrangement.supersets) {
    const members = order.filter((id) => group.includes(id))
    if (members.length < 2) continue
    const anchor = order.indexOf(members[0])
    const rest = order.filter((id) => !group.includes(id))
    rest.splice(anchor, 0, ...members)
    order = rest
  }
  return { exerciseOrder: order, supersets: arrangement.supersets.map((group) => [...group]) }
}

export function linkSuperset(arrangement: GymArrangement, first: string, second: string): GymArrangement {
  return gatherSupersets({
    exerciseOrder: arrangement.exerciseOrder,
    supersets: joinSuperset(arrangement.supersets, first, second)
  })
}

/**
 * A day with a plan added. Exercises the day lacks follow in the plan's order, and the plan's
 * supersets join the day's, merging where they share an exercise.
 */
export function addPlan(day: GymArrangement, plan: GymArrangement): GymArrangement {
  const exerciseOrder = [...day.exerciseOrder, ...plan.exerciseOrder.filter((id) => !day.exerciseOrder.includes(id))]
  let supersets = day.supersets.map((group) => [...group])
  for (const group of plan.supersets) {
    for (const id of group.slice(1)) supersets = joinSuperset(supersets, group[0], id)
  }
  return gatherSupersets({ exerciseOrder, supersets })
}
