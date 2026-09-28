import {
  DEFAULT_WEIGHT_UNIT, EXERCISE_TYPE_FIELDS, GYM_CATEGORY_COLORS, parseDuration,
  type DistanceUnit, type ExerciseType, type GymSetInput, type GymWorkoutInput, type SetField, type WeightUnit
} from './gym'
import {
  GYM_LIBRARY_CATEGORIES, GYM_LIBRARY_EXERCISES, customCategoryId, customExerciseId, stableHash,
  type LibraryCategory, type LibraryExercise
} from './gym-library'

export interface FitNotesRow {
  line: number
  date: string
  exercise: string
  category: string
  weight: number | null
  weightUnit: WeightUnit | null
  reps: number | null
  distance: number | null
  distanceUnit: DistanceUnit | null
  durationSeconds: number | null
  comment: string
}

export interface FitNotesParse {
  rows: FitNotesRow[]
  problems: string[]
}

/** RFC 4180: quoted fields may hold commas, doubled quotes, and line breaks. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((cell) => cell.length > 0))
}

function number(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null
  const value = Number(text.trim())
  return Number.isFinite(value) ? value : null
}

function weightUnitFrom(text: string): WeightUnit | null {
  const unit = text.trim().toLowerCase()
  if (unit === 'lbs' || unit === 'lb') return 'lbs'
  if (unit === 'kg' || unit === 'kgs') return 'kg'
  return null
}

function distanceUnitFrom(text: string): DistanceUnit | null {
  const unit = text.trim().toLowerCase()
  if (unit === 'mi' || unit === 'mile' || unit === 'miles') return 'mi'
  if (unit === 'km' || unit === 'kms') return 'km'
  if (unit === 'm' || unit === 'meters' || unit === 'metres') return 'm'
  return null
}

/**
 * Reads a FitNotes "Export workout data" file. Newer exports carry a Weight Unit column; older
 * ones put the unit in the header, as in "Weight (kgs)".
 */
export function parseFitNotesCsv(text: string): FitNotesParse {
  const table = parseCsv(text)
  const problems: string[] = []
  if (table.length === 0) return { rows: [], problems: ['The file is empty'] }
  const header = table[0].map((cell) => cell.trim().toLowerCase())
  const column = (...names: string[]): number => header.findIndex((cell) => names.some((name) => cell === name || cell.startsWith(`${name} (`)))
  const at = {
    date: column('date'),
    exercise: column('exercise'),
    category: column('category'),
    weight: column('weight'),
    weightUnit: column('weight unit'),
    reps: column('reps'),
    distance: column('distance'),
    distanceUnit: column('distance unit'),
    time: column('time'),
    comment: column('comment')
  }
  if (at.date < 0 || at.exercise < 0 || at.category < 0) {
    return { rows: [], problems: ['This does not look like a FitNotes export: Date, Exercise, and Category are required'] }
  }
  const headerWeightUnit = at.weight >= 0 ? weightUnitFrom(header[at.weight].match(/\((.+)\)/)?.[1] ?? '') : null
  const rows: FitNotesRow[] = []
  table.slice(1).forEach((cells, index) => {
    const line = index + 2
    const cell = (position: number): string => position >= 0 ? (cells[position] ?? '').trim() : ''
    const date = cell(at.date)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      problems.push(`Line ${line}: "${date}" is not a YYYY-MM-DD date`)
      return
    }
    const weight = number(cell(at.weight))
    const reps = number(cell(at.reps))
    const distance = number(cell(at.distance))
    const time = cell(at.time)
    const durationSeconds = time ? parseDuration(time) : null
    if (time && durationSeconds === null) {
      problems.push(`Line ${line}: "${time}" is not a duration`)
      return
    }
    const distanceUnit = distance === null ? null : distanceUnitFrom(cell(at.distanceUnit))
    if (distance !== null && distanceUnit === null) {
      problems.push(`Line ${line}: unknown distance unit "${cell(at.distanceUnit)}"`)
      return
    }
    if (weight === null && reps === null && distance === null && durationSeconds === null) {
      problems.push(`Line ${line}: the set has no weight, reps, distance, or time`)
      return
    }
    rows.push({
      line,
      date,
      exercise: cell(at.exercise),
      category: cell(at.category),
      weight,
      weightUnit: weight === null ? null : weightUnitFrom(cell(at.weightUnit)) ?? headerWeightUnit ?? DEFAULT_WEIGHT_UNIT,
      reps: reps === null ? null : Math.round(reps),
      distance,
      distanceUnit,
      durationSeconds,
      comment: cell(at.comment)
    })
  })
  return { rows, problems }
}

export interface FitNotesImportRules {
  /** Exercise names to leave out entirely. */
  skipExercises?: readonly string[]
  /** Category name to the category its exercises move into. */
  categoryMerges?: Readonly<Record<string, string>>
  /** Exercise name to the category it belongs in, for exercises filed under the wrong one. */
  exerciseCategories?: Readonly<Record<string, string>>
}

export interface PlannedSet {
  id: string
  input: GymSetInput
}

export interface GymImportPlan {
  categories: LibraryCategory[]
  exercises: LibraryExercise[]
  sets: PlannedSet[]
  workouts: GymWorkoutInput[]
  skippedRows: number
}

const TYPE_BY_FIELDS: Record<string, ExerciseType> = {
  'weight,reps': 'weight_reps',
  'weight,distance': 'weight_distance',
  'weight,time': 'weight_time',
  'reps,distance': 'reps_distance',
  'reps,time': 'reps_time',
  'distance,time': 'distance_time',
  weight: 'weight',
  reps: 'reps',
  distance: 'distance',
  time: 'time'
}

function fieldsOf(row: FitNotesRow): SetField[] {
  const fields: SetField[] = []
  if (row.weight !== null) fields.push('weight')
  if (row.reps !== null) fields.push('reps')
  if (row.distance !== null) fields.push('distance')
  if (row.durationSeconds !== null) fields.push('time')
  return fields
}

/** Three or more filled fields keep the first pair FitNotes itself supports. */
function typeFor(fields: SetField[]): ExerciseType {
  const exact = TYPE_BY_FIELDS[fields.join(',')]
  if (exact) return exact
  return TYPE_BY_FIELDS[fields.slice(0, 2).join(',')] ?? 'weight_reps'
}

function inferType(rows: FitNotesRow[]): ExerciseType {
  const counts = new Map<ExerciseType, number>()
  for (const row of rows) {
    const type = typeFor(fieldsOf(row))
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'weight_reps'
}

function key(name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Turns parsed rows into the records Ego stores. Library categories and exercises are reused by
 * name, so "Barbell Squat" from FitNotes and from the library are one exercise. Every ID is derived
 * from the data, so running the same import twice produces identical records.
 */
export function planFitNotesImport(rows: readonly FitNotesRow[], rules: FitNotesImportRules = {}): GymImportPlan {
  const skip = new Set((rules.skipExercises ?? []).map(key))
  const merges = new Map(Object.entries(rules.categoryMerges ?? {}).map(([from, to]) => [key(from), to]))
  const moves = new Map(Object.entries(rules.exerciseCategories ?? {}).map(([name, category]) => [key(name), category]))
  const kept = rows.filter((row) => !skip.has(key(row.exercise)))

  const categories = new Map<string, LibraryCategory>(GYM_LIBRARY_CATEGORIES.map((category) => [key(category.input.name), {
    id: category.id, input: { ...category.input }
  }]))
  let customColor = 0
  const categoryFor = (name: string): LibraryCategory => {
    const resolved = merges.get(key(name)) ?? name
    const existing = categories.get(key(resolved))
    if (existing) return existing
    const created: LibraryCategory = {
      id: customCategoryId(resolved),
      input: { name: resolved.trim(), color: GYM_CATEGORY_COLORS[customColor % GYM_CATEGORY_COLORS.length] }
    }
    customColor += 1
    categories.set(key(resolved), created)
    return created
  }

  const exercises = new Map<string, LibraryExercise>(GYM_LIBRARY_EXERCISES.map((exercise) => [key(exercise.input.name), {
    id: exercise.id, input: { ...exercise.input }
  }]))
  const rowsByExercise = new Map<string, FitNotesRow[]>()
  for (const row of kept) {
    const group = rowsByExercise.get(key(row.exercise))
    if (group) group.push(row)
    else rowsByExercise.set(key(row.exercise), [row])
  }
  for (const [name, group] of rowsByExercise) {
    const first = group[0]
    const category = categoryFor(moves.get(name) ?? first.category)
    const type = inferType(group)
    const existing = exercises.get(name)
    if (existing) {
      existing.input = { ...existing.input, categoryId: category.id, type }
    } else {
      exercises.set(name, {
        id: customExerciseId(first.exercise),
        input: { name: first.exercise.trim(), categoryId: category.id, type, weightUnit: 'default', notes: '' }
      })
    }
  }

  const positions = new Map<string, number>()
  const orderByDate = new Map<string, string[]>()
  const sets: PlannedSet[] = []
  for (const row of kept) {
    const exercise = exercises.get(key(row.exercise))
    if (!exercise) continue
    const fields = EXERCISE_TYPE_FIELDS[exercise.input.type]
    const slot = `${row.date}|${exercise.id}`
    const position = positions.get(slot) ?? 0
    positions.set(slot, position + 1)
    const order = orderByDate.get(row.date) ?? []
    if (!order.includes(exercise.id)) order.push(exercise.id)
    orderByDate.set(row.date, order)
    const weight = fields.includes('weight') ? row.weight ?? 0 : null
    const distance = fields.includes('distance') ? row.distance ?? 0 : null
    sets.push({
      id: `gs-${row.date}-${stableHash(exercise.id)}-${position}`,
      input: {
        exerciseId: exercise.id,
        date: row.date,
        position,
        weight,
        weightUnit: weight === null ? null : row.weightUnit ?? DEFAULT_WEIGHT_UNIT,
        reps: fields.includes('reps') ? row.reps ?? 0 : null,
        distance,
        distanceUnit: distance === null ? null : row.distanceUnit ?? 'mi',
        durationSeconds: fields.includes('time') ? row.durationSeconds ?? 0 : null,
        comment: row.comment.slice(0, 500)
      }
    })
  }

  return {
    categories: [...categories.values()],
    exercises: [...exercises.values()],
    sets,
    workouts: [...orderByDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, exerciseOrder]) => ({ date, exerciseOrder, supersets: [], notes: '' })),
    skippedRows: rows.length - kept.length
  }
}
