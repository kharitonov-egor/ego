import React, { useCallback, useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import type { DocketKeyCreated, DocketKeySummary } from '@ego/api-contracts'
import { Screen, ScreenBody } from '../../components/screen'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { stamp } from '../../lib/dockets'
import { useLedger } from '../../lib/ledger'
import { CopyButton, DocketGate, DocketHeader } from './shared'

const HEAD = 'border-b border-surface-800 pb-2 text-left text-[13px] font-semibold uppercase tracking-wide text-surface-400'
const CELL = 'border-b border-surface-800 py-3 text-[15px]'

function installCommand(): string {
  return `npm install -g ${window.location.origin}/cli/docket.tgz`
}

function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return <code className="rounded-md border border-surface-700 bg-surface-900 px-1.5 py-0.5 font-mono text-[0.9em] text-surface-100">{children}</code>
}

function Commands({ lines }: { lines: readonly string[] }): React.ReactElement {
  const text = lines.join('\n')
  return <div className="mt-3 flex items-start gap-3">
    <pre className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-black px-3 py-2.5 font-mono text-[14px] leading-6 text-foreground">{text}</pre>
    <CopyButton text={text} size="default" />
  </div>
}

function NewKey({ created }: { created: DocketKeyCreated }): React.ReactElement {
  return <div className="mt-5 rounded-2xl border border-surface-700 bg-surface-900 p-4">
    <div className="flex items-center gap-2">
      <KeyRound size={16} color="#d4d4d4" />
      <span className="text-[15px] font-semibold">{created.key.name}</span>
    </div>
    <p className="mt-1 text-[14px] text-surface-400">Copy it now. Ego keeps only a hash, so it cannot show this key again.</p>
    <div className="mt-3 flex items-center gap-3">
      <code className="min-w-0 flex-1 select-all break-all rounded-xl bg-black px-3 py-2.5 font-mono text-[14px] text-foreground">{created.token}</code>
      <CopyButton text={created.token} size="default" />
    </div>
    <p className="mt-4 text-[14px] text-surface-400">On a computer without docket yet, paste these two lines into a terminal:</p>
    <Commands lines={[installCommand(), `docket auth login --key ${created.token}`]} />
  </div>
}

function DocketCliBody(): React.ReactElement {
  const ledger = useLedger()
  const [keys, setKeys] = useState<DocketKeySummary[] | null>(null)
  const [created, setCreated] = useState<DocketKeyCreated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [revoking, setRevoking] = useState<DocketKeySummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.docketKeys()
    if (result.ok) {
      setKeys(result.data.keys)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    void load()
  }, [load])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    const result = await ledger.api.createDocketKey(null)
    setGenerating(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setCreated(result.data)
    setError(null)
    await load()
  }

  const revoke = async (): Promise<void> => {
    if (!revoking) return
    setBusy(true)
    const result = await ledger.api.revokeDocketKey(revoking.id)
    setBusy(false)
    if (revoking.id === created?.key.id) setCreated(null)
    setRevoking(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') setError(result.error.message)
    await load()
  }

  return <ScreenBody width="narrow" className="pt-10">
    <h2 className="text-[34px] font-bold tracking-tight">Connect your CLI</h2>
    <p className="mt-3 text-[17px] leading-7 text-surface-400">
      Generate a key, then paste it into the waiting <Code>docket auth login</Code> prompt in your terminal.
    </p>
    <Button size="lg" className="mt-6" disabled={generating} onClick={() => void generate()}>
      {generating ? 'Generating...' : 'Generate a new API key'}
    </Button>
    <p className="mt-3 text-[14px] text-surface-400">Each click makes a fresh key. Keys are shown once.</p>
    {created && <NewKey created={created} />}
    {error && <p role="alert" className="mt-3 text-[15px] text-destructive">{error}</p>}

    <h3 className="mt-10 text-[20px] font-bold">Active keys</h3>
    {keys === null && !error && <p className="mt-3 text-[15px] text-surface-400">Loading...</p>}
    {keys !== null && keys.length === 0 && <p className="mt-3 text-[15px] text-surface-400">No keys yet.</p>}
    {keys !== null && keys.length > 0 && <table className="mt-3 w-full border-collapse">
      <thead>
        <tr>
          <th className={HEAD}>Name</th>
          <th className={HEAD}>Created</th>
          <th className={HEAD}>Last used</th>
          <th className={HEAD}><span className="sr-only">Revoke</span></th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => <tr key={key.id}>
          <td className={CELL}>{key.name}</td>
          <td className={`${CELL} text-surface-300`}>{stamp(key.createdAt)}</td>
          <td className={`${CELL} text-surface-300`}>{key.lastUsedAt ? stamp(key.lastUsedAt) : 'never used'}</td>
          <td className={`${CELL} text-right`}>
            <Button variant="outline" size="sm" onClick={() => setRevoking(key)}>Revoke</Button>
          </td>
        </tr>)}
      </tbody>
    </table>}

    <h3 className="mt-10 text-[20px] font-bold">Install</h3>
    <p className="mt-2 text-[15px] leading-6 text-surface-400">
      On any computer with Node 18 or newer. Run it again to update. Then <Code>docket auth login</Code>, and{' '}
      <Code>docket --help</Code> lists every command.
    </p>
    <Commands lines={[installCommand()]} />
    <p className="mt-3 text-[14px] text-surface-400">Each computer gets its own key, named after the computer when it signs in, so one can be revoked alone.</p>

    <ConfirmDialog
      visible={revoking !== null}
      title={`Revoke ${revoking?.name ?? 'this key'}?`}
      detail="Any CLI using it stops working at once. Dockets it uploaded stay."
      confirmLabel="Revoke"
      destructive
      busy={busy}
      onCancel={() => setRevoking(null)}
      onConfirm={() => void revoke()}
    />
  </ScreenBody>
}

export default function DocketCli(): React.ReactElement {
  return <DocketGate>
    <Screen>
      <DocketHeader />
      <DocketCliBody />
    </Screen>
  </DocketGate>
}
