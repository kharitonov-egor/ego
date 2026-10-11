#!/usr/bin/env node
import core from '@ego/core'

const { NO_FOOD_GOAL, isFoodEntryInput, isFoodGoalInput, sumMacros } = core

/**
 * Fills saturated fat, fiber, and sodium on food entries logged before they were tracked. A
 * barcode entry takes its label's numbers, scaled to the calories it was logged with. Everything
 * else, and whatever a label leaves out, goes to the model part by part, with the photo when the
 * entry has one. Numbers an entry already has are kept, so running it again only fills gaps. With
 * no targets for the three yet, it sets sodium to 2,300 mg, saturated fat to 10% of calories, and
 * fiber to 34 g.
 *
 *   EGO_API_URL, EGO_DEVICE_TOKEN   the Worker and a device token from ego-device enroll
 *
 *   node scripts/food-backfill.mjs            print the plan
 *   node scripts/food-backfill.mjs --apply    estimate and save
 *
 * Needs the built core package (npm run typecheck builds it). Each estimate is one OpenRouter call.
 */

const BATCH = 25
const ATTEMPTS = 4
const NUTRIENTS = ['saturatedFat', 'fiber', 'sodium']
const TARGETS = { sodium: 2300, saturatedFatPercent: 10, fiber: 34 }

const apply = process.argv.includes('--apply')
const url = (process.env.EGO_API_URL ?? '').replace(/\/+$/, '')
const token = process.env.EGO_DEVICE_TOKEN ?? ''
if (!url || !token) {
  console.error('Set EGO_API_URL and EGO_DEVICE_TOKEN first.')
  process.exit(1)
}
const auth = { authorization: `Bearer ${token}` }

async function call(path, init = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${url}${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...init.headers } })
    const text = await response.text()
    let payload = null
    try { payload = JSON.parse(text) } catch { payload = null }
    if (response.ok && payload?.ok === true) return payload.data
    const message = payload?.error?.message ?? `HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`
    if (response.status < 500 || attempt >= ATTEMPTS) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
}

async function photoOf(photo) {
  if (!photo) return null
  const response = await fetch(`${url}/v1/food/media/${encodeURIComponent(photo.previewId ?? photo.mediaId)}`, { headers: auth })
  if (!response.ok) return null
  const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return null
  return { base64: Buffer.from(await response.arrayBuffer()).toString('base64'), mimeType }
}

const isMissing = (value) => value === null || value === undefined
const missing = (item) => NUTRIENTS.some((key) => isMissing(item[key]))
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places
const roundNutrient = (key, value) => key === 'sodium' ? round(value, 0) : round(value, 1)

/** Keeps every number the entry already has and fills the rest. */
function filled(own, found) {
  return Object.fromEntries(NUTRIENTS.map((key) => [key, isMissing(own[key]) ? found[key] ?? null : own[key]]))
}

async function fromLabel(entry) {
  if (!entry.barcode) return null
  const { product } = await call(`/v1/food/products/${encodeURIComponent(entry.barcode)}`)
  if (!product) return null
  const factor = product.macros.calories > 0 && entry.calories > 0 ? entry.calories / product.macros.calories : 1
  return Object.fromEntries(NUTRIENTS.map((key) => {
    const value = product.macros[key]
    return [key, isMissing(value) ? null : roundNutrient(key, value * factor)]
  }))
}

/** Estimates every part, then scales the parts' sum to the entry's calories, since an edit can change one without the other. */
async function fromModel(entry) {
  const parts = entry.parts.length > 0
    ? entry.parts
    : [{ name: entry.name, calories: entry.calories, protein: entry.protein, carbs: entry.carbs, fat: entry.fat }]
  const { parts: estimates } = await call('/v1/food/nutrients', {
    method: 'POST',
    body: JSON.stringify({
      name: entry.name, serving: entry.serving, note: entry.note,
      parts: parts.map(({ name, calories, protein, carbs, fat }) => ({ name, calories, protein, carbs, fat })),
      image: await photoOf(entry.photo)
    })
  })
  const nextParts = entry.parts.map((part, index) => ({ ...part, ...filled(part, estimates[index]) }))
  if (entry.parts.length === 0) return { totals: estimates[0], parts: [] }
  const partCalories = nextParts.reduce((sum, part) => sum + part.calories, 0)
  const factor = partCalories > 0 && entry.calories > 0 ? entry.calories / partCalories : 1
  const sum = sumMacros(nextParts)
  const totals = Object.fromEntries(NUTRIENTS.map((key) => [key, sum[key] === null ? null : roundNutrient(key, sum[key] * factor)]))
  return { totals, parts: nextParts }
}

function inputOf(record) {
  const { id, createdAt, updatedAt, revision, ...input } = record
  return input
}

const live = await call('/v1/bootstrap')
const entries = (live.foodEntries ?? []).filter(missing)
const goal = live.foodGoals?.[0] ?? null
const needsTargets = !goal || ['sodium', 'saturatedFatPercent', 'fiber'].every((key) => isMissing(goal[key]))

console.log(`${entries.length} of ${(live.foodEntries ?? []).length} entries are missing saturated fat, fiber, or sodium.`)
for (const entry of entries) console.log(`  ${entry.date}  ${entry.source.padEnd(9)} ${entry.name}${entry.photo ? ' (photo)' : ''}`)
if (needsTargets) console.log(`Targets: sodium ${TARGETS.sodium} mg, saturated fat ${TARGETS.saturatedFatPercent}% of calories, fiber ${TARGETS.fiber} g.`)
if (!apply) {
  console.log('Run again with --apply to estimate and save.')
  process.exit(0)
}

const now = new Date().toISOString()
const operations = []
for (const entry of entries) {
  let next = { ...entry }
  const label = await fromLabel(entry).catch(() => null)
  if (label) next = { ...next, ...filled(next, label) }
  if (missing(next)) {
    const estimate = await fromModel(next)
    next = { ...next, ...filled(next, estimate.totals), parts: estimate.parts }
  }
  const input = inputOf(next)
  if (!isFoodEntryInput(input)) throw new Error(`The numbers for "${entry.name}" did not pass the check`)
  console.log(`  ${entry.name}: saturated fat ${input.saturatedFat ?? '?'} g, fiber ${input.fiber ?? '?'} g, sodium ${input.sodium ?? '?'} mg${label ? ' (label)' : ''}`)
  operations.push({
    operationId: `nutrients-${entry.id}-${entry.revision}`, entityId: entry.id, expectedRevision: entry.revision, createdAt: now,
    command: { entity: 'foodEntry', type: 'update', payload: input }
  })
}
if (needsTargets) {
  const payload = { ...NO_FOOD_GOAL, ...(goal ? inputOf(goal) : {}), ...TARGETS }
  if (!isFoodGoalInput(payload)) throw new Error('The targets did not pass the check')
  operations.push({
    operationId: `nutrient-targets-${goal?.revision ?? 0}`, entityId: 'daily', expectedRevision: goal?.revision ?? null, createdAt: now,
    command: { entity: 'foodGoal', type: goal ? 'update' : 'create', payload }
  })
}

let sent = 0
for (let start = 0; start < operations.length; start += BATCH) {
  const batch = operations.slice(start, start + BATCH)
  const result = await call('/v1/operations', { method: 'POST', body: JSON.stringify({ operations: batch }) })
  sent += result.results.length
  if (result.failed) {
    console.error(`Stopped at ${result.failed.operationId}: ${result.failed.error.message}. ${sent} saved. Run it again to continue.`)
    process.exit(1)
  }
}
console.log(`Done. ${sent} saved.`)
