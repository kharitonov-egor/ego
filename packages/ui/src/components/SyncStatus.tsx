import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { CloudAlert, CloudCheck, CloudOff, CloudUpload } from 'lucide-react'
import { syncLabel, useLedger } from '../lib/ledger'
import { cn } from '../lib/utils'
import { ConflictsSheet } from './ConflictEntries'
import { Spinner } from './ui/spinner'

/**
 * The whole sync story in one icon, with the details in its tooltip. A click syncs, or opens what
 * is blocking the sync: the changes that need a decision, or Settings when the computer has to sign
 * in again.
 */
export function SyncStatus({ className }: { className?: string }): React.ReactElement | null {
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
  const label = ledger.syncing ? 'Syncing...' : syncLabel(ledger.status)
  const hint = attention ? 'Click to review what needs a decision.'
    : paused ? 'Click to open Settings.'
      : 'Click to sync.'
  return <>
    <button
      type="button"
      aria-label={label}
      title={ledger.syncing ? label : `${label}. ${hint}`}
      disabled={ledger.syncing}
      onClick={onClick}
      className={cn('disabled:hover:bg-transparent', className)}
    >
      <span className="relative flex">
        {icon}
        {conflicts > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-attention ring-2 ring-background" />}
      </span>
    </button>
    <ConflictsSheet visible={reviewing} onClose={() => setReviewing(false)} />
  </>
}
