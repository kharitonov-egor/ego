import { GYM_CATEGORY_COLORS, type ExerciseType, type GymCategoryInput, type GymExerciseInput } from './gym'

export interface LibraryCategory {
  id: string
  input: GymCategoryInput
}

export interface LibraryExercise {
  id: string
  input: GymExerciseInput
}

/** ASCII only, so a name like "Running (Outdoor)" becomes "running-outdoor". */
export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** FNV-1a. Stable across runs, so a re-import produces the same IDs and changes nothing. */
export function stableHash(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function libraryCategoryId(name: string): string {
  return `gc-${slugify(name)}`
}

export function libraryExerciseId(name: string): string {
  return `ge-${slugify(name)}`
}

/** Names outside the library, including Cyrillic ones that do not slug, get a hashed ID. */
export function customCategoryId(name: string): string {
  return `gc-x-${stableHash(name.trim().toLowerCase())}`
}

export function customExerciseId(name: string): string {
  return `ge-x-${stableHash(name.trim().toLowerCase())}`
}

const CATEGORY_NAMES = ['Abs', 'Back', 'Biceps', 'Cardio', 'Chest', 'Legs', 'Shoulders', 'Triceps'] as const

type CategoryName = typeof CATEGORY_NAMES[number]

export const GYM_LIBRARY_CATEGORIES: readonly LibraryCategory[] = CATEGORY_NAMES.map((name, index) => ({
  id: libraryCategoryId(name),
  input: { name, color: GYM_CATEGORY_COLORS[index] }
}))

const STRENGTH: ExerciseType = 'weight_reps'

const EXERCISES: Record<CategoryName, Array<[string, ExerciseType]>> = {
  Abs: [
    ['Ab-Wheel Rollout', 'reps'], ['Cable Crunch', STRENGTH], ['Crunch', 'reps'],
    ['Crunch Machine', STRENGTH], ['Decline Crunch', 'reps'], ['Dragon Flag', 'reps'],
    ['Hanging Knee Raise', 'reps'], ['Hanging Leg Raise', 'reps'], ['Plank', 'time'],
    ['Russian Twist', STRENGTH], ['Side Plank', 'time'], ['Sit Up', 'reps']
  ],
  Back: [
    ['Back Extension', STRENGTH], ['Barbell Row', STRENGTH], ['Barbell Shrug', STRENGTH],
    ['Chin Up', STRENGTH], ['Deadlift', STRENGTH], ['Dumbbell Row', STRENGTH],
    ['Good Morning', STRENGTH], ['Hammer Strength Row', STRENGTH], ['Lat Pulldown', STRENGTH],
    ['Machine Shrug', STRENGTH], ['Neutral Chin Up', STRENGTH], ['Pendlay Row', STRENGTH],
    ['Pull Up', STRENGTH], ['Rack Pull', STRENGTH], ['Seated Cable Row', STRENGTH],
    ['Straight-Arm Cable Pushdown', STRENGTH], ['T-Bar Row', STRENGTH]
  ],
  Biceps: [
    ['Barbell Curl', STRENGTH], ['Cable Curl', STRENGTH], ['Dumbbell Concentration Curl', STRENGTH],
    ['Dumbbell Curl', STRENGTH], ['Dumbbell Hammer Curl', STRENGTH], ['Dumbbell Preacher Curl', STRENGTH],
    ['EZ-Bar Curl', STRENGTH], ['EZ-Bar Preacher Curl', STRENGTH], ['Seated Incline Dumbbell Curl', STRENGTH],
    ['Seated Machine Curl', STRENGTH]
  ],
  Cardio: [
    ['Cycling', 'distance_time'], ['Elliptical Trainer', 'distance_time'], ['Jump Rope', 'time'],
    ['Rowing Machine', 'distance_time'], ['Running (Outdoor)', 'distance_time'],
    ['Running (Treadmill)', 'distance_time'], ['Stair Climber', 'time'],
    ['Stationary Bike', 'distance_time'], ['Swimming', 'distance_time'], ['Walking', 'distance_time']
  ],
  Chest: [
    ['Cable Crossover', STRENGTH], ['Chest Dip', STRENGTH], ['Decline Barbell Bench Press', STRENGTH],
    ['Decline Hammer Strength Chest Press', STRENGTH], ['Flat Barbell Bench Press', STRENGTH],
    ['Flat Dumbbell Bench Press', STRENGTH], ['Flat Dumbbell Fly', STRENGTH],
    ['Incline Barbell Bench Press', STRENGTH], ['Incline Dumbbell Bench Press', STRENGTH],
    ['Incline Dumbbell Fly', STRENGTH], ['Incline Hammer Strength Chest Press', STRENGTH],
    ['Machine Chest Press', STRENGTH], ['Push Up', 'reps'], ['Seated Machine Fly', STRENGTH]
  ],
  Legs: [
    ['Barbell Calf Raise', STRENGTH], ['Barbell Front Squat', STRENGTH], ['Barbell Glute Bridge', STRENGTH],
    ['Barbell Hip Thrust', STRENGTH], ['Barbell Squat', STRENGTH], ['Bulgarian Split Squat', STRENGTH],
    ['Donkey Calf Raise', STRENGTH], ['Dumbbell Lunge', STRENGTH], ['Glute-Ham Raise', STRENGTH],
    ['Goblet Squat', STRENGTH], ['Hack Squat', STRENGTH], ['Hip Abductor Machine', STRENGTH],
    ['Hip Adductor Machine', STRENGTH], ['Leg Extension Machine', STRENGTH], ['Leg Press', STRENGTH],
    ['Lying Leg Curl Machine', STRENGTH], ['Romanian Deadlift', STRENGTH],
    ['Seated Calf Raise Machine', STRENGTH], ['Seated Leg Curl Machine', STRENGTH],
    ['Smith Machine Squat', STRENGTH], ['Standing Calf Raise Machine', STRENGTH],
    ['Stiff-Legged Deadlift', STRENGTH], ['Sumo Deadlift', STRENGTH]
  ],
  Shoulders: [
    ['Arnold Dumbbell Press', STRENGTH], ['Behind The Neck Barbell Press', STRENGTH],
    ['Cable Face Pull', STRENGTH], ['Front Dumbbell Raise', STRENGTH],
    ['Hammer Strength Shoulder Press', STRENGTH], ['Lateral Cable Raise', STRENGTH],
    ['Lateral Dumbbell Raise', STRENGTH], ['Lateral Machine Raise', STRENGTH], ['Log Press', STRENGTH],
    ['Machine Shoulder Press', STRENGTH], ['One-Arm Standing Dumbbell Press', STRENGTH],
    ['Overhead Press', STRENGTH], ['Push Press', STRENGTH], ['Rear Delt Dumbbell Raise', STRENGTH],
    ['Rear Delt Machine Fly', STRENGTH], ['Seated Dumbbell Lateral Raise', STRENGTH],
    ['Seated Dumbbell Press', STRENGTH], ['Smith Machine Overhead Press', STRENGTH], ['Upright Row', STRENGTH]
  ],
  Triceps: [
    ['Cable Overhead Triceps Extension', STRENGTH], ['Close Grip Barbell Bench Press', STRENGTH],
    ['Dumbbell Overhead Triceps Extension', STRENGTH], ['Dumbbell Triceps Kickback', STRENGTH],
    ['EZ-Bar Skullcrusher', STRENGTH], ['Parallel Bar Triceps Dip', STRENGTH], ['Ring Dip', STRENGTH],
    ['Rope Push Down', STRENGTH], ['Smith Machine Close Grip Bench Press', STRENGTH],
    ['Straight Bar Push Down', STRENGTH], ['V-Bar Push Down', STRENGTH]
  ]
}

/** The standard exercises every gym log starts with, grouped the way FitNotes groups them. */
export const GYM_LIBRARY_EXERCISES: readonly LibraryExercise[] = CATEGORY_NAMES.flatMap((category) =>
  EXERCISES[category].map(([name, type]) => ({
    id: libraryExerciseId(name),
    input: { name, categoryId: libraryCategoryId(category), type, weightUnit: 'default', notes: '' }
  })))
