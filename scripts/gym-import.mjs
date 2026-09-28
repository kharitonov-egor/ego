#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import core from '@ego/core'

const { GYM_LIBRARY_EXERCISES, parseFitNotesCsv, planFitNotesImport } = core

/**
 * Loads a FitNotes export into the gym log through the Worker, so every record reaches the change
 * log and each phone picks it up on its next sync. Operation IDs come from the data, so running the
 * import again reports duplicates instead of adding anything.
 *
 *   EGO_API_URL, EGO_DEVICE_TOKEN   the Worker and a device token from ego-device enroll
 *
 *   node scripts/gym-import.mjs <FitNotes_Export.csv>             print the plan
 *   node scripts/gym-import.mjs <FitNotes_Export.csv> --apply     send it
 *   --as-exported                                                  skip the cleanup below
 *
 * Needs the built core package: npm run typecheck builds it.
 */

/** Cleanup chosen for my own export: test entries out, one abs category, misfiled exercises moved. */
const CLEANUP = {
  skipExercises: ['Test1', 'Test2'],
  categoryMerges: { 'Пресс': 'Abs' },
  exerciseCategories: {
    'Barbell Bent Over Row': 'Back',
    'Shoulder Press': 'Shoulders',
    'Atlas Press': 'Shoulders',
    'Bicep Curl +': 'Biceps'
  }
}

const BATCH = 25
const ATTEMPTS = 4

const file = process.argv.slice(2).find((value) => !value.startsWith('--'))
const apply = process.argv.includes('--apply')
const asExported = process.argv.includes('--as-exported')

if (!file) {
  console.error('Usage: node scripts/gym-import.mjs <FitNotes_Export.csv> [--apply] [--as-exported]')
  process.exit(1)
}

const parsed = parseFitNotesCsv(readFileSync(file, 'utf8'))
if (parsed.problems.length > 0) {
  console.error(`${parsed.problems.length} lines could not be read:`)
  for (const problem of parsed.problems.slice(0, 20)) console.error(`  ${problem}`)
  process.exit(1)
}
const plan = planFitNotesImport(parsed.rows, asExported ? {} : CLEANUP)
const libraryIds = new Set(GYM_LIBRARY_EXERCISES.map((exercise) => exercise.id))
const usedIds = new Set(plan.sets.map((set) => set.input.exerciseId))
const categoryNames = new Map(plan.categories.map((category) => [category.id, category.input.name]))
const custom = plan.exercises.filter((exercise) => !libraryIds.has(exercise.id))

console.log(`Read ${parsed.rows.length} sets from ${file}${plan.skippedRows > 0 ? `, leaving out ${plan.skippedRows}` : ''}.`)
console.log(`Categories: ${plan.categories.map((category) => category.input.name).join(', ')}`)
console.log(`Exercises: ${plan.exercises.length} (${GYM_LIBRARY_EXERCISES.length} standard, ${custom.length} of yours), ${usedIds.size} with history`)
console.log(`Sets: ${plan.sets.length} across ${plan.workouts.length} workouts, ${plan.workouts[0]?.date ?? '-'} to ${plan.workouts.at(-1)?.date ?? '-'}`)
console.log('\nYour exercises:')
for (const exercise of custom) {
  console.log(`  ${categoryNames.get(exercise.input.categoryId)?.padEnd(10)} ${exercise.input.type.padEnd(14)} ${exercise.input.name}`)
}

const createdAt = new Date().toISOString()
const operation = (operationId, entityId, command) => ({ operationId, entityId, expectedRevision: null, createdAt, command })
const operations = [
  ...plan.categories.map((item) => operation(`import-${item.id}`, item.id, { entity: 'gymCategory', type: 'create', payload: item.input })),
  ...plan.exercises.map((item) => operation(`import-${item.id}`, item.id, { entity: 'gymExercise', type: 'create', payload: item.input })),
  ...plan.sets.map((item) => operation(`import-${item.id}`, item.id, { entity: 'gymSet', type: 'create', payload: item.input })),
  ...plan.workouts.map((item) => operation(`import-w-${item.date}`, item.date, { entity: 'gymWorkout', type: 'save', payload: item }))
]

if (!apply) {
  console.log(`\n${operations.length} operations ready. Add --apply to send them.`)
  process.exit(0)
}

const url = (process.env.EGO_API_URL ?? '').replace(/\/+$/, '')
const token = process.env.EGO_DEVICE_TOKEN ?? ''
if (!url || !token) {
  console.error('Set EGO_API_URL and EGO_DEVICE_TOKEN first.')
  process.exit(1)
}

async function send(batch) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${url}/v1/operations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ operations: batch })
      })
      const body = await response.text()
      let payload = null
      try {
        payload = JSON.parse(body)
      } catch {
        console.error(`\nHTTP ${response.status}, not JSON: ${body.replace(/\s+/g, ' ').slice(0, 300)}`)
      }
      if (response.ok && payload?.ok === true) return payload.data
      if ((payload && response.status < 500) || attempt >= ATTEMPTS) {
        throw new Error(payload?.error?.message ?? `The Worker answered with HTTP ${response.status}`)
      }
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
}

let applied = 0
let duplicates = 0
for (let index = 0; index < operations.length; index += BATCH) {
  const batch = operations.slice(index, index + BATCH)
  const result = await send(batch)
  for (const outcome of result.results) {
    if (outcome.status === 'applied') applied += 1
    else duplicates += 1
  }
  if (result.failed) {
    console.error(`\nStopped at ${result.failed.operationId}: ${result.failed.error.message}`)
    console.error(`${applied} applied, ${duplicates} already there. Fix the cause and run again; finished operations are skipped.`)
    process.exit(1)
  }
  process.stdout.write(`\r${Math.min(index + BATCH, operations.length)} of ${operations.length} operations sent`)
}
console.log(`\nDone. ${applied} applied, ${duplicates} already there.`)
