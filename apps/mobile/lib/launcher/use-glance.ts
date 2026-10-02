import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useLedger } from '../ledger-context'
import { localDay } from '../tasks/board'
import { useTasks } from '../tasks/context'
import { localGlance, tasksGlance, type LocalGlance, type TasksGlance } from './summary'

export interface Glance {
  now: Date
  /** Null until the local copy has been read. */
  local: LocalGlance | null
  tasks: TasksGlance | null
}

/**
 * The start screen stays mounted under every app, so it reads again each time it comes back into
 * view. Health and Study refresh their caches without bumping a ledger version.
 */
export function useGlance(): Glance {
  const { db, ready, version, gymVersion, healthVersion, habitsVersion, diaryVersion } = useLedger()
  const { data, now } = useTasks()
  const [local, setLocal] = useState<LocalGlance | null>(null)
  const [focuses, setFocuses] = useState(0)
  const today = localDay(now)

  useFocusEffect(useCallback(() => {
    setFocuses((count) => count + 1)
  }, []))

  useEffect(() => {
    if (!db || !ready) {
      setLocal(null)
      return
    }
    let active = true
    void localGlance(db, today, new Date()).then((next) => { if (active) setLocal(next) })
    return () => { active = false }
  }, [db, ready, today, focuses, version, gymVersion, healthVersion, habitsVersion, diaryVersion])

  const tasks = useMemo(() => data ? tasksGlance(data, now) : null, [data, now])
  return { now, local, tasks }
}
