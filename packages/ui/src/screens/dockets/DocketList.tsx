import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CloudOff, RefreshCw } from 'lucide-react'
import type { DocketSummary } from '@ego/api-contracts'
import { Screen, ScreenBody } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { Blurred } from '../../lib/blur'
import { groupByRepository, pageHref, stamp, versionLabel } from '../../lib/dockets'
import { useLedger } from '../../lib/ledger'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { DocketGate, DocketHeader, DocketMessage, DocketWaiting, VisibilityBadge } from './shared'

function DocketRow({ docket }: { docket: DocketSummary }): React.ReactElement {
  return <div className="flex items-start gap-6 border-t border-surface-800 py-4">
    <div className="min-w-0 flex-1">
      <Blurred>
        <a
          href={pageHref(docket.url)}
          target="_blank"
          rel="noreferrer"
          className="text-[18px] font-semibold leading-6 text-foreground underline-offset-4 hover:underline"
        >{docket.title}</a>
      </Blurred>
      {docket.description && <Blurred>
        <p className="mt-1 line-clamp-2 text-[15px] leading-6 text-surface-400">{docket.description}</p>
      </Blurred>}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
      <div className="flex items-center gap-2 text-[14px] text-surface-400">
        <Link to={`/dockets/${docket.id}`} className="font-semibold text-surface-200 underline underline-offset-4 hover:text-foreground">Details</Link>
        <span>· v{docket.latestVersion} · {versionLabel(docket.versionCount)} · {stamp(docket.updatedAt)}</span>
      </div>
      <VisibilityBadge visible={docket.public} />
    </div>
  </div>
}

function DocketListBody(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const [dockets, setDockets] = useState<DocketSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const result = await ledger.api.dockets()
    setLoading(false)
    if (result.ok) {
      setDockets(result.data.dockets)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = <IconButton label="Refresh" disabled={loading} onClick={() => void load()}>
    <RefreshCw color={color.textSecondary} size={19} className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
  </IconButton>

  let body: React.ReactElement
  if (dockets === null && error) {
    body = <DocketMessage Icon={CloudOff} title="Could not load your dockets" detail={error} action="Try again" onAction={() => void load()} />
  } else if (dockets === null) {
    body = <DocketWaiting />
  } else if (dockets.length === 0) {
    body = <DocketMessage
      title="No dockets yet"
      detail="Agents upload them with docket upload plan.html. Connect the CLI first."
      action="Set up the CLI"
      onAction={() => navigate('/dockets/cli')}
    />
  } else {
    body = <ScreenBody width="medium">
      <h2 className="text-[30px] font-bold tracking-tight">My dockets</h2>
      {error && <p role="alert" className="mt-2 text-[15px] text-destructive">{error}</p>}
      {groupByRepository(dockets).map((group) => <section key={group.repository ?? ''} className="mt-8">
        <h3 className="mb-2 text-[20px] font-bold">{group.repository ?? 'No repository'}</h3>
        {group.dockets.map((docket) => <DocketRow key={docket.id} docket={docket} />)}
      </section>)}
    </ScreenBody>
  }

  return <Screen>
    <DocketHeader right={refresh} />
    {body}
  </Screen>
}

export default function DocketList(): React.ReactElement {
  return <DocketGate><DocketListBody /></DocketGate>
}
