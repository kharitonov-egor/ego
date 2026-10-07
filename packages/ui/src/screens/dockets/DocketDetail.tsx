import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { CloudOff, ExternalLink, Trash2 } from 'lucide-react'
import type { DocketDetail as Detail } from '@ego/api-contracts'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { Switch } from '../../components/ui/switch'
import { Blurred } from '../../lib/blur'
import { pageHref, shortCommit, stamp, versionLabel } from '../../lib/dockets'
import { useLedger } from '../../lib/ledger'
import { CopyButton, DocketGate, DocketMessage, DocketWaiting, VisibilityBadge } from './shared'

const HEAD = 'border-b border-surface-800 pb-2 text-left text-[13px] font-semibold uppercase tracking-wide text-surface-400'
const CELL = 'border-b border-surface-800 py-3 text-[15px]'

function Versions({ docket }: { docket: Detail }): React.ReactElement {
  return <table className="mt-3 w-full border-collapse">
    <thead>
      <tr>
        <th className={HEAD}>Version</th>
        <th className={HEAD}>Commit</th>
        <th className={HEAD}>Ref</th>
        <th className={HEAD}>Published</th>
      </tr>
    </thead>
    <tbody>
      {docket.versions.map((version) => <tr key={version.version}>
        <td className={CELL}>
          <a href={pageHref(version.url)} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4 hover:text-surface-200">
            v{version.version}
          </a>
          {version.version === docket.latestVersion && <span className="ml-2 text-[13px] text-surface-400">latest</span>}
        </td>
        <td className={`${CELL} font-mono text-surface-300`} title={version.commit ?? undefined}>{shortCommit(version.commit)}</td>
        <td className={`${CELL} text-surface-300`}>{version.ref ?? ''}</td>
        <td className={`${CELL} text-surface-300`}>{stamp(version.createdAt)}</td>
      </tr>)}
    </tbody>
  </table>
}

function DocketDetailBody({ id }: { id: string }): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const [docket, setDocket] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.docket(id)
    if (result.ok) {
      setDocket(result.data)
      setError(null)
    } else if (result.error.code === 'NOT_FOUND') {
      setMissing(true)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api, id])

  useEffect(() => {
    void load()
  }, [load])

  const setVisible = async (visible: boolean): Promise<void> => {
    setSaving(true)
    const result = await ledger.api.updateDocket(id, { public: visible })
    setSaving(false)
    if (result.ok) {
      setDocket(result.data)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    const result = await ledger.api.deleteDocket(id)
    setBusy(false)
    setDeleting(false)
    if (result.ok || result.error.code === 'NOT_FOUND') navigate('/dockets')
    else setError(result.error.message)
  }

  let body: React.ReactElement
  if (missing) {
    body = <DocketMessage title="No docket here" detail="It was deleted, or the link is wrong." action="Back to My dockets" onAction={() => navigate('/dockets')} />
  } else if (!docket && error) {
    body = <DocketMessage Icon={CloudOff} title="Could not load this docket" detail={error} action="Try again" onAction={() => void load()} />
  } else if (!docket) {
    body = <DocketWaiting />
  } else {
    const href = pageHref(docket.url)
    body = <ScreenBody width="medium">
      <Blurred><h2 className="text-[30px] font-bold leading-9 tracking-tight">{docket.title}</h2></Blurred>
      {docket.description && <Blurred><p className="mt-3 text-[17px] leading-7 text-surface-400">{docket.description}</p></Blurred>}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <a href={href} target="_blank" rel="noreferrer" className="mr-2 break-all text-[16px] font-medium underline underline-offset-4 hover:text-surface-200">
          {docket.url}
        </a>
        <CopyButton text={docket.url} label="Copy link" />
        <Button variant="outline" size="sm" onClick={() => window.open(href, '_blank', 'noopener')}>
          <ExternalLink size={15} />
          Open
        </Button>
      </div>

      <div className="mt-6 flex items-center gap-4 rounded-2xl border border-surface-800 bg-card p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold">Public</span>
            <VisibilityBadge visible={docket.public} />
          </div>
          <p className="mt-1 text-[14px] leading-5 text-surface-400">
            {docket.public
              ? 'Anyone with the link can open every version.'
              : 'Only browsers signed in to Ego can open it.'}
          </p>
        </div>
        <Switch label="Public" checked={docket.public} disabled={saving} onCheckedChange={(visible) => void setVisible(visible)} />
      </div>

      {error && <p role="alert" className="mt-3 text-[15px] text-destructive">{error}</p>}

      <h3 className="mt-8 text-[20px] font-bold">Versions</h3>
      <p className="mt-1 text-[14px] text-surface-400">
        {versionLabel(docket.versionCount)}{docket.repository ? ` · ${docket.repository}` : ''} · ID {docket.id}
      </p>
      <Versions docket={docket} />

      <div className="mt-10 border-t border-surface-800 pt-6">
        <Button variant="outline" onClick={() => setDeleting(true)} className="text-destructive">
          <Trash2 size={16} />
          Delete docket
        </Button>
      </div>
      <ConfirmDialog
        visible={deleting}
        title="Delete this docket?"
        detail={`Every version goes, and ${docket.url} stops working. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onCancel={() => setDeleting(false)}
        onConfirm={() => void remove()}
      />
    </ScreenBody>
  }

  return <Screen>
    <ScreenHeader title="Docket" back="/dockets" />
    {body}
  </Screen>
}

export default function DocketDetail(): React.ReactElement {
  const { id = '' } = useParams()
  return <DocketGate><DocketDetailBody key={id} id={id} /></DocketGate>
}
