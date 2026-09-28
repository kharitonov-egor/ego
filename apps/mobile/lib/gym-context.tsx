import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  GYM_LIBRARY_CATEGORIES, GYM_LIBRARY_EXERCISES,
  type GymCategoryInput, type GymExerciseInput, type GymSetInput
} from '@ego/core'
import { isoToday } from './dates'
import type { LocalDatabase } from './database/types'
import { useLedger, type LocalWrite } from './ledger-context'
import {
  gymCategories, gymDay, gymExercises, gymRevision, gymWorkout, nextSetPosition,
  type GymCategoryView, type GymExerciseView
} from './repositories/gym'
import {
  createGymCategory, createGymExercise, createGymSet, deleteGymCategory, deleteGymExercise, deleteGymSet,
  newId, saveGymWorkout, updateGymCategory, updateGymExercise, updateGymSet
} from './sync/commands'

export interface Arrangement {
  exerciseOrder: string[]
  supersets: string[][]
}

interface GymContextValue {
  /** The local copy holds a complete download. */
  ready: boolean
  /** Bumps when the gym log changes, so a screen knows to query again. */
  version: number
  db: LocalDatabase | null
  writing: boolean
  /** The day the log, the track screen, and the calendar are looking at. */
  date: string
  setDate: (date: string) => void
  categories: GymCategoryView[]
  exercises: GymExerciseView[]
  error: string | null
  dismissError: () => void
  logSet: (input: Omit<GymSetInput, 'position'>) => Promise<boolean>
  updateSet: (id: string, input: GymSetInput) => Promise<boolean>
  deleteSets: (ids: string[]) => Promise<boolean>
  saveExercise: (id: string | null, input: GymExerciseInput) => Promise<string | null>
  deleteExercise: (id: string) => Promise<boolean>
  saveCategory: (id: string | null, input: GymCategoryInput) => Promise<string | null>
  deleteCategory: (id: string) => Promise<boolean>
  /** Reorders a day or changes its supersets, starting from the order the log shows now. */
  arrange: (date: string, change: (current: Arrangement) => Arrangement) => Promise<boolean>
  addLibrary: () => Promise<boolean>
}

const GymContext = createContext<GymContextValue | null>(null)

class RejectedWrite extends Error {}

async function revisionOf(
  db: LocalDatabase, table: 'gym_categories' | 'gym_exercises' | 'gym_sets', id: string, label: string
): Promise<number> {
  const revision = await gymRevision(db, table, id)
  if (revision === null) throw new RejectedWrite(`${label} was deleted on another device.`)
  return revision
}

export function GymProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const { db, gymVersion, write } = ledger
  const ready = ledger.current
  const [date, setDate] = useState(isoToday)
  const [categories, setCategories] = useState<GymCategoryView[]>([])
  const [exercises, setExercises] = useState<GymExerciseView[]>([])
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    if (!db || !ready) {
      setCategories([])
      setExercises([])
      return
    }
    generation.current += 1
    const started = generation.current
    void Promise.all([gymCategories(db), gymExercises(db)]).then(([nextCategories, nextExercises]) => {
      if (started !== generation.current) return
      setCategories(nextCategories)
      setExercises(nextExercises)
    }).catch((failure: unknown) => {
      if (started === generation.current) setError(failure instanceof Error ? failure.message : 'This phone could not read the gym log')
    })
  }, [db, ready, gymVersion])

  const run = useCallback(async (work: LocalWrite): Promise<boolean> => {
    let rejected: string | null = null
    const saved = await write(async (database, now) => {
      try {
        await work(database, now)
      } catch (failure: unknown) {
        if (failure instanceof RejectedWrite) rejected = failure.message
        throw failure
      }
    }, 'gym')
    if (!saved) setError(rejected ?? 'This phone could not save that change. Try again.')
    else setError(null)
    return saved
  }, [write])

  const logSet = useCallback((input: Omit<GymSetInput, 'position'>) => run(async (database, now) => {
    const position = await nextSetPosition(database, input.exerciseId, input.date)
    await createGymSet(database, { ...input, position }, now)
  }), [run])

  const updateSet = useCallback((id: string, input: GymSetInput) => run(async (database, now) => {
    await updateGymSet(database, id, await revisionOf(database, 'gym_sets', id, 'That set'), input, now)
  }), [run])

  const deleteSets = useCallback((ids: string[]) => run((database, now) => database.transaction(async (tx) => {
    for (const id of ids) {
      const revision = await gymRevision(tx, 'gym_sets', id)
      if (revision !== null) await deleteGymSet(tx, id, revision, now)
    }
  })), [run])

  const saveExercise = useCallback(async (id: string | null, input: GymExerciseInput): Promise<string | null> => {
    const target = id ?? newId()
    const saved = await run(async (database, now) => {
      if (id) await updateGymExercise(database, id, await revisionOf(database, 'gym_exercises', id, 'That exercise'), input, now)
      else await createGymExercise(database, input, now, target)
    })
    return saved ? target : null
  }, [run])

  const deleteExercise = useCallback((id: string) => run(async (database, now) => {
    await deleteGymExercise(database, id, await revisionOf(database, 'gym_exercises', id, 'That exercise'), now)
  }), [run])

  const saveCategory = useCallback(async (id: string | null, input: GymCategoryInput): Promise<string | null> => {
    const target = id ?? newId()
    const saved = await run(async (database, now) => {
      if (id) await updateGymCategory(database, id, await revisionOf(database, 'gym_categories', id, 'That category'), input, now)
      else await createGymCategory(database, input, now, target)
    })
    return saved ? target : null
  }, [run])

  const deleteCategory = useCallback((id: string) => run(async (database, now) => {
    const used = await database.all<{ total: number }>(
      'SELECT COUNT(*) AS total FROM gym_exercises WHERE category_id = ? AND deleted_at IS NULL', [id])
    if ((used[0]?.total ?? 0) > 0) throw new RejectedWrite('Move or delete the exercises in this category first.')
    await deleteGymCategory(database, id, await revisionOf(database, 'gym_categories', id, 'That category'), now)
  }), [run])

  const arrange = useCallback((day: string, change: (current: Arrangement) => Arrangement) => run(async (database, now) => {
    const [shown, stored] = await Promise.all([gymDay(database, day), gymWorkout(database, day)])
    const next = change({ exerciseOrder: shown.exercises.map((item) => item.exercise.id), supersets: shown.supersets })
    await saveGymWorkout(database, {
      date: day, exerciseOrder: next.exerciseOrder, supersets: next.supersets, notes: stored?.notes ?? ''
    }, stored?.revision ?? null, now)
  }), [run])

  const addLibrary = useCallback(() => run((database, now) => database.transaction(async (tx) => {
    const existing = new Set((await tx.all<{ id: string }>('SELECT id FROM gym_categories UNION SELECT id FROM gym_exercises')).map((row) => row.id))
    for (const category of GYM_LIBRARY_CATEGORIES) {
      if (!existing.has(category.id)) await createGymCategory(tx, category.input, now, category.id)
    }
    for (const exercise of GYM_LIBRARY_EXERCISES) {
      if (!existing.has(exercise.id)) await createGymExercise(tx, exercise.input, now, exercise.id)
    }
  })), [run])

  const value = useMemo<GymContextValue>(() => ({
    ready,
    version: gymVersion,
    db,
    writing: ledger.writing,
    date,
    setDate,
    categories,
    exercises,
    error,
    dismissError: () => setError(null),
    logSet,
    updateSet,
    deleteSets,
    saveExercise,
    deleteExercise,
    saveCategory,
    deleteCategory,
    arrange,
    addLibrary
  }), [addLibrary, arrange, categories, date, db, deleteCategory, deleteExercise, deleteSets, error, exercises,
    gymVersion, ledger.writing, logSet, ready, saveCategory, saveExercise, updateSet])

  return <GymContext.Provider value={value}>{children}</GymContext.Provider>
}

export function useGym(): GymContextValue {
  const context = useContext(GymContext)
  if (!context) throw new Error('useGym must be used inside GymProvider')
  return context
}

/** Runs a query against the local copy again whenever the gym log changes. */
export function useGymQuery<T>(query: (db: LocalDatabase) => Promise<T>, deps: React.DependencyList): T | null {
  const { db, ready, version } = useGym()
  const [result, setResult] = useState<T | null>(null)
  useEffect(() => {
    if (!db || !ready) {
      setResult(null)
      return
    }
    let active = true
    void query(db).then((next) => { if (active) setResult(next) }).catch(() => undefined)
    return () => { active = false }
  }, [db, ready, version, ...deps])
  return result
}
