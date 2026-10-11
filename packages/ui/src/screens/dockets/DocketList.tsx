import React, { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CloudOff, Download, RefreshCw } from 'lucide-react'
import type { DocketSummary } from '@ego/api-contracts'
import {
  DOCKET_ORDERS, DOCKET_ORDER_KEY, docketDate, groupByRepository, isDocketOrder, sortDockets, type DocketOrder
} from '@ego/local/dockets'
import { Screen, ScreenBody } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { inputClass } from '../../components/ui/input'
import { Spinner } from '../../components/ui/spinner'
import { Blurred } from '../../lib/blur'
import { pageHref, stamp, versionLabel } from '../../lib/dockets'
import { useLedger } from '../../lib/ledger'
import { SecureStore } from '../../lib/preferences'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { DocketGate, DocketHeader, DocketMessage, DocketWaiting, VisibilityBadge } from './shared'

const SELECT = cn(inputClass, 'min-h-10 w-auto appearance-auto py-2 pr-2 text-[15px] [color-scheme:dark]')

interface PdfState {
  busy: boolean
  error: string | null
}

function DocketRow({ docket, order, showRepository, pdf, onDownload }: {
  docket: DocketSummary
  order: DocketOrder
  showRepository: boolean
  pdf: PdfState | undefined
  onDownload: () => void
}): React.ReactElement {
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
      {showRepository && <p className="mt-1 text-[14px] text-surface-500">{docket.repository ?? 'No repository'}</p>}
      {pdf?.error && <p role="alert" className="mt-1 text-[14px] text-destructive">{pdf.error}</p>}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
      <div className="flex items-center gap-2 text-[14px] text-surface-400">
        <Link to={`/dockets/${docket.id}`} className="font-semibold text-surface-200 underline underline-offset-4 hover:text-foreground">Details</Link>
        <span title={`Created ${stamp(docket.createdAt)} · Updated ${stamp(docket.updatedAt)}`}>
          · v{docket.latestVersion} · {versionLabel(docket.versionCount)} · {stamp(docketDate(docket, order))}
        </span>
      </div>
      <VisibilityBadge visible={docket.public} />
    </div>
    <IconButton label={pdf?.busy ? 'Making the PDF' : 'Download PDF'} disabled={pdf?.busy} onClick={onDownload} className="-mr-2">
      {pdf?.busy ? <Spinner size={18} /> : <Download color={color.textSecondary} size={19} />}
    </IconButton>
  </div>
}

function DocketListBody(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const [dockets, setDockets] = useState<DocketSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState<DocketOrder | null>(null)
  const [pdfs, setPdfs] = useState<Record<string, PdfState>>({})

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

  useEffect(() => {
    void SecureStore.getItemAsync(DOCKET_ORDER_KEY)
      .then((saved) => setOrder(isDocketOrder(saved) ? saved : 'newest'), () => setOrder('newest'))
  }, [])

  const changeOrder = (next: DocketOrder): void => {
    setOrder(next)
    void SecureStore.setItemAsync(DOCKET_ORDER_KEY, next).catch(() => undefined)
  }

  const download = useCallback(async (docket: DocketSummary): Promise<void> => {
    setPdfs((current) => ({ ...current, [docket.id]: { busy: true, error: null } }))
    let problem: string | null
    try {
      problem = await window.api.docketPdf(docket.id, docket.title)
    } catch {
      problem = 'The PDF did not download'
    }
    setPdfs((current) => ({ ...current, [docket.id]: { busy: false, error: problem } }))
  }, [])

  const refresh = <IconButton label="Refresh" disabled={loading} onClick={() => void load()}>
    <RefreshCw color={color.textSecondary} size={19} className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
  </IconButton>

  const row = (docket: DocketSummary, shown: DocketOrder): React.ReactElement => <DocketRow
    key={docket.id}
    docket={docket}
    order={shown}
    showRepository={shown !== 'project'}
    pdf={pdfs[docket.id]}
    onDownload={() => void download(docket)}
  />

  let body: React.ReactElement
  if (dockets === null && error) {
    body = <DocketMessage Icon={CloudOff} title="Could not load your dockets" detail={error} action="Try again" onAction={() => void load()} />
  } else if (dockets === null || order === null) {
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-[30px] font-bold tracking-tight">My dockets</h2>
        <label className="flex items-center gap-3 text-[14px] font-semibold text-surface-400">
          Sort
          <select value={order} onChange={(change) => { if (isDocketOrder(change.target.value)) changeOrder(change.target.value) }} className={SELECT}>
            {DOCKET_ORDERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="mt-2 text-[15px] text-destructive">{error}</p>}
      {order === 'project'
        ? groupByRepository(sortDockets(dockets, 'updated')).map((group) => <section key={group.repository ?? ''} className="mt-8">
          <h3 className="mb-2 text-[20px] font-bold">{group.repository ?? 'No repository'}</h3>
          {group.dockets.map((docket) => row(docket, order))}
        </section>)
        : <div className="mt-6">{sortDockets(dockets, order).map((docket) => row(docket, order))}</div>}
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
