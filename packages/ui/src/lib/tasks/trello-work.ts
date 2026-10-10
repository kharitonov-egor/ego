import { useCallback, useEffect, useRef, useState } from 'react'
import { useLedger } from '../ledger'

export interface TrelloWork {
  syncing: boolean
  problem: string | null
  refresh: () => void
}

/** Syncs the Work list with the work Trello board when a board holding it opens, and when asked. */
export function useTrelloWork(active: boolean): TrelloWork {
  const { api, sync } = useLedger()
  const [syncing, setSyncing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const running = useRef(false)

  const refresh = useCallback((): void => {
    if (running.current) return
    running.current = true
    setSyncing(true)
    void (async () => {
      try {
        const result = await api.trelloWorkSync(Intl.DateTimeFormat().resolvedOptions().timeZone)
        setProblem(result.ok ? result.data.problem : result.error.message)
        if (result.ok && result.data.changed) await sync()
      } catch {
        setProblem('Ego could not reach the server')
      } finally {
        running.current = false
        setSyncing(false)
      }
    })()
  }, [api, sync])

  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    if (active) latest.current()
  }, [active])

  return { syncing, problem, refresh }
}
