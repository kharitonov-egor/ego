import {
  DEFAULT_DISTANCE_UNIT, DEFAULT_WEIGHT_UNIT, displayWeightUnit, exerciseRecords, fieldsFor, formatDistance,
  formatSetDuration, formatWeight, parseDuration, roundTo, setWeightIn,
  type DistanceUnit, type ExerciseType, type ExerciseWeightUnit, type GymSetInput, type GymSetLike, type SetField,
  type WeightUnit
} from '@ego/core'
import { isoToday, parseIso, shiftIso } from '../dates'

export interface SetPart {
  field: SetField
  value: string
  unit: string
}

export function unitFor(weightUnit: ExerciseWeightUnit): WeightUnit {
  return displayWeightUnit(weightUnit, DEFAULT_WEIGHT_UNIT)
}

/** The columns a set shows, in the unit its exercise displays. */
export function setParts(set: GymSetLike, type: ExerciseType, unit: WeightUnit): SetPart[] {
  return fieldsFor(type).map((field): SetPart => {
    switch (field) {
      case 'weight': return { field, value: formatWeight(setWeightIn(set, unit) ?? 0), unit }
      case 'reps': return { field, value: String(set.reps ?? 0), unit: set.reps === 1 ? 'rep' : 'reps' }
      case 'distance': return { field, value: formatDistance(set.distance ?? 0), unit: set.distanceUnit ?? DEFAULT_DISTANCE_UNIT }
      case 'time': return { field, value: formatSetDuration(set.durationSeconds ?? 0), unit: '' }
    }
  })
}

export function setCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'set' : 'sets'}`
}

/** The date bar: TODAY, YESTERDAY, TOMORROW, or the date, with the year only when it is not this one. */
export function dayBarLabel(iso: string, today: string = isoToday()): string {
  if (iso === today) return 'TODAY'
  if (iso === shiftIso(today, -1)) return 'YESTERDAY'
  if (iso === shiftIso(today, 1)) return 'TOMORROW'
  const date = parseIso(iso)
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' })
  }).toUpperCase()
}

/** History headers read "SUNDAY, SEPTEMBER 27", and "SUNDAY, JUNE 15 2025" for another year. */
export function historyHeader(iso: string, today: string = isoToday()): string {
  const date = parseIso(iso)
  const day = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
  return iso.slice(0, 4) === today.slice(0, 4) ? day : `${day} ${iso.slice(0, 4)}`
}

export interface EntryDraft {
  weight: string
  reps: string
  distance: string
  time: string
}

export const EMPTY_DRAFT: EntryDraft = { weight: '', reps: '', distance: '', time: '' }

export type SetValues = Pick<GymSetInput, 'weight' | 'weightUnit' | 'reps' | 'distance' | 'distanceUnit' | 'durationSeconds'>

/** What the fields show for a set, converted to the exercise's unit. */
export function draftFrom(set: GymSetLike | null, type: ExerciseType, unit: WeightUnit): EntryDraft {
  const fields = fieldsFor(type)
  if (!set) {
    return {
      weight: fields.includes('weight') ? '0.0' : '',
      reps: fields.includes('reps') ? '0' : '',
      distance: fields.includes('distance') ? '0.0' : '',
      time: fields.includes('time') ? '0:00' : ''
    }
  }
  return {
    weight: fields.includes('weight') ? formatWeight(setWeightIn(set, unit) ?? 0) : '',
    reps: fields.includes('reps') ? String(set.reps ?? 0) : '',
    distance: fields.includes('distance') ? formatDistance(set.distance ?? 0) : '',
    time: fields.includes('time') ? formatSetDuration(set.durationSeconds ?? 0) : ''
  }
}

function decimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === '' || normalized === '.') return null
  return Number(normalized)
}

export type DraftResult = { ok: true; values: SetValues } | { ok: false; message: string }

export function valuesFromDraft(
  draft: EntryDraft, type: ExerciseType, unit: WeightUnit, distanceUnit: DistanceUnit
): DraftResult {
  const fields = fieldsFor(type)
  const values: SetValues = {
    weight: null, weightUnit: null, reps: null, distance: null, distanceUnit: null, durationSeconds: null
  }
  if (fields.includes('weight')) {
    const weight = decimal(draft.weight)
    if (weight === null || weight > 10000) return { ok: false, message: 'Enter a weight' }
    values.weight = roundTo(weight, 2)
    values.weightUnit = unit
  }
  if (fields.includes('reps')) {
    const reps = decimal(draft.reps)
    if (reps === null || !Number.isInteger(reps) || reps < 1) return { ok: false, message: 'Enter the reps' }
    values.reps = reps
  }
  if (fields.includes('distance')) {
    const distance = decimal(draft.distance)
    if (distance === null || distance <= 0) return { ok: false, message: 'Enter a distance' }
    values.distance = roundTo(distance, 3)
    values.distanceUnit = distanceUnit
  }
  if (fields.includes('time')) {
    const seconds = parseDuration(draft.time)
    if (seconds === null || seconds <= 0) return { ok: false, message: 'Enter a time, like 1:30' }
    values.durationSeconds = seconds
  }
  return { ok: true, values }
}

export function weightStep(unit: WeightUnit): number {
  return unit === 'kg' ? 2.5 : 5
}

/** One tap of a minus or plus button. Values never go below zero. */
export function stepDraft(draft: EntryDraft, field: SetField, direction: -1 | 1, unit: WeightUnit, distanceUnit: DistanceUnit): EntryDraft {
  switch (field) {
    case 'weight': {
      const next = Math.max(0, (decimal(draft.weight) ?? 0) + direction * weightStep(unit))
      return { ...draft, weight: formatWeight(next) }
    }
    case 'reps': {
      const next = Math.max(0, Math.round(decimal(draft.reps) ?? 0) + direction)
      return { ...draft, reps: String(next) }
    }
    case 'distance': {
      const step = distanceUnit === 'm' ? 100 : 0.1
      const next = Math.max(0, roundTo((decimal(draft.distance) ?? 0) + direction * step, 3))
      return { ...draft, distance: formatDistance(next) }
    }
    case 'time': {
      const next = Math.max(0, (parseDuration(draft.time) ?? 0) + direction * 5)
      return { ...draft, time: formatSetDuration(next) }
    }
  }
}

const CANDIDATE_ID = 'unsaved-set'

/**
 * Whether a set about to be logged would earn the trophy, taking it from an earlier set. The first
 * set of an exercise holds every record by default, so it does not count.
 */
export function beatsRecord(
  history: readonly GymSetLike[],
  candidate: Omit<GymSetLike, 'id' | 'position' | 'createdAt'>,
  type: ExerciseType,
  unit: WeightUnit,
  distanceUnit: DistanceUnit
): boolean {
  if (history.length === 0) return false
  const next: GymSetLike = { ...candidate, id: CANDIDATE_ID, position: Number.MAX_SAFE_INTEGER, createdAt: '9999-12-31T23:59:59.999Z' }
  return exerciseRecords([...history, next], type, unit, distanceUnit).recordSetIds.has(CANDIDATE_ID)
}
