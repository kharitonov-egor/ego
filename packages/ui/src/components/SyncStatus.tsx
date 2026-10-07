import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { CloudAlert, CloudCheck, CloudOff, CloudUpload } from 'lucide-react'
import { syncLabel, useLedger } from '../lib/ledger'
import { ConflictsSheet } from './ConflictEntries'
import { Spinner } from './ui/spinner'

/**
 * The whole sync story in one row. A click syncs, or opens what is blocking the sync: the
 * changes that need a decision, or Settings when the computer has to sign in again.
 */
export function SyncStatus(): React.ReactElement | null {
  const ledger = useLedger()
  const navigate = useNavigate()
  const [reviewing, setReviewing] = useState(false)
  if (!ledger.enabled) return null
  const state = ledger.status?.state
  const conflicts = ledger.conflicts.length
  const attention = conflicts > 0 || state === 'attention'
  const paused = state === 'paused'
  const onClick = (): void => {
    if (attention) setReviewing(true)
    else if (paused) navigate('/settings')
    else void ledger.sync()
  }
  const icon = ledger.syncing ? <Spinner size={17} color="#d4d4d4" />
    : attention || paused ? <CloudAlert color="#fbbf24" size={18} />
      : state === 'offline' ? <CloudOff color="#737373" size={18} />
        : (ledger.status?.pendingCount ?? 0) > 0 ? <CloudUpload color="#d4d4d4" size={18} />
          : <CloudCheck color="#d4d4d4" size={18} />
  return <>
    <button
      type="button"
      title={attention ? 'Opens the changes that need a decision' : paused ? 'Opens Settings to sign in' : 'Syncs with the server'}
      disabled={ledger.syncing}
      onClick={onClick}
      className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[14px] text-surface-400 transition-colors hover:bg-surface-900 hover:text-surface-200 disabled:hover:bg-transparent"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{ledger.syncing ? 'Syncing...' : syncLabel(ledger.status)}</span>
      {conflicts > 0 && <span className="rounded-full bg-attention px-1.5 text-[11px] font-bold text-background">{conflicts}</span>}
    </button>
    <ConflictsSheet visible={reviewing} onClose={() => setReviewing(false)} />
  </>
}
