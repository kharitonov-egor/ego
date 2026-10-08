import { useEffect, useState } from 'react'
import { localContent } from '@ego/local/content/repository'
import { useLedger } from './ledger'
export function useContent(): Awaited<ReturnType<typeof localContent>> & {
  ledger: ReturnType<typeof useLedger>; error: string | null; loading: boolean
} {
  const ledger = useLedger()
  const [data, setData] = useState<Awaited<ReturnType<typeof localContent>>>({ items: [], collections: [] })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (!ledger.db || !ledger.ready) { setData({ items: [], collections: [] }); setLoading(false); return }
    setLoading(true)
    void localContent(ledger.db).then(next => { if (active) { setData(next); setError(null) } })
      .catch(() => { if (active) setError('Could not load Content. Try syncing again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [ledger.db, ledger.ready, ledger.contentVersion])
  return { ...data, ledger, error, loading }
}
