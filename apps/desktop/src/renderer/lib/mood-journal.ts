import { useCallback, useEffect, useState } from 'react'
import type { MoodRecord } from '@ego/api-contracts'
import { isMoodInput, type MoodInput } from '@ego/core'
import { localMoodRevision, localMoods } from '@ego/local/repositories/moods'
import { deleteMood, saveMood } from '@ego/local/sync/commands'
import { useLedger } from './ledger'

export interface MoodJournal {
  /** Signed in, so entries live in the synced local database. */
  enabled: boolean
  /** Null until the local database has been read. */
  entries: MoodRecord[] | null
  busy: boolean
  error: string | null
  dismissError: () => void
  save: (input: MoodInput) => Promise<boolean>
  clear: (date: string) => Promise<boolean>
}

/**
 * Mood entries share the ledger's database and outbox, so a saved day is on disk before this
 * resolves and reaches D1 on the next sync, exactly like a transaction.
 */
export function useMoodJournal(): MoodJournal {
  const { db, ready, healthVersion, write, writing, enabled } = useLedger()
  const [entries, setEntries] = useState<MoodRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!db || !ready) {
      setEntries(null)
      return
    }
    let active = true
    void localMoods(db)
      .then((rows) => { if (active) setEntries(rows) })
      .catch(() => { if (active) setError('This computer could not read its mood entries') })
    return () => { active = false }
  }, [db, ready, healthVersion])

  const save = useCallback(async (input: MoodInput): Promise<boolean> => {
    if (!isMoodInput(input)) {
      setError('Pick a mood for this day')
      return false
    }
    const saved = await write(async (database, now) => {
      await saveMood(database, input, await localMoodRevision(database, input.date), now)
    }, 'health')
    setError(saved ? null : 'This computer could not save that entry')
    return saved
  }, [write])

  const clear = useCallback(async (date: string): Promise<boolean> => {
    const saved = await write(async (database, now) => {
      const revision = await localMoodRevision(database, date)
      if (revision !== null) await deleteMood(database, date, revision, now)
    }, 'health')
    setError(saved ? null : 'This computer could not clear that day')
    return saved
  }, [write])

  return {
    enabled,
    entries,
    busy: writing,
    error,
    dismissError: () => setError(null),
    save,
    clear
  }
}
