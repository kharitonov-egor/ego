import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { TaskAgentRun } from '@ego/api-contracts'
import { useLedger } from '../ledger-context'

const POLL_MS = 20_000
/** Long enough for a drop to sync up, so the server has queued the card before the read. */
const AFTER_CHANGE_MS = 3_000
const NONE: ReadonlyMap<string, TaskAgentRun> = new Map()

/**
 * Jarvis's runs, by card, while the board shows cards in an agent list. Reads on open, every 20
 * seconds while the app is in front, when it comes back, and shortly after those cards change.
 */
export function useAgentRuns(cardIds: readonly string[]): ReadonlyMap<string, TaskAgentRun> {
  const { api } = useLedger()
  const [runs, setRuns] = useState(NONE)
  const active = cardIds.length > 0
  const key = cardIds.join(',')
  const seen = useRef(key)

  const refresh = useCallback((): void => {
    void api.taskAgentRuns()
      .then((result) => { if (result.ok) setRuns(new Map(result.data.map((run) => [run.cardId, run]))) })
      .catch(() => undefined)
  }, [api])

  useEffect(() => {
    if (!active) return
    refresh()
    const timer = setInterval(() => { if (AppState.currentState === 'active') refresh() }, POLL_MS)
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh() })
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [active, refresh])

  useEffect(() => {
    if (!active || seen.current === key) return
    seen.current = key
    const timer = setTimeout(refresh, AFTER_CHANGE_MS)
    return () => clearTimeout(timer)
  }, [active, key, refresh])

  return runs
}
