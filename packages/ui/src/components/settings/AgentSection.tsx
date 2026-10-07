import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Brain, ChevronRight, KeyRound, Plug } from 'lucide-react'
import { AGENT_KEY_NAME_MAX, type AgentKeyCreated, type AgentKeySummary } from '@ego/api-contracts'
import { timeAgo } from '@ego/local/dates'
import { dayLabel, noteCount } from '../../lib/agent'
import { useLedger } from '../../lib/ledger'
import { cn } from '../../lib/utils'
import { Code, CopyField } from '../copy'
import { FieldLabel, Section, SectionNote } from '../Section'
import { Button } from '../ui/button'
import { ConfirmDialog } from '../ui/dialog'
import { inputClass } from '../ui/input'

function usedLabel(key: AgentKeySummary): string {
  return key.lastUsedAt ? `Last used ${timeAgo(key.lastUsedAt, new Date())}` : 'Never used'
}

function NewKey({ created }: { created: AgentKeyCreated }): React.ReactElement {
  return <div className="mt-4 rounded-2xl border border-surface-700 bg-surface-900 p-4">
    <div className="flex items-center gap-2">
      <KeyRound size={16} color="#d4d4d4" />
      <span className="min-w-0 truncate text-[15px] font-semibold">{created.key.name}</span>
    </div>
    <p className="mt-1 text-[14px] text-surface-400">Copy it now. Ego keeps only a hash, so it cannot show this key again.</p>
    <CopyField text={created.token} />
    <p className="mt-5 text-[15px] font-semibold">Add it in claude.ai</p>
    <ol className="mt-2 list-decimal space-y-3 pl-5 text-[14px] leading-6 text-surface-300">
      <li>Open Settings, then Connectors, then Add custom connector.</li>
      <li>
        Paste this URL.
        <CopyField text={created.mcpUrl} className="mt-2" />
      </li>
      <li>
        Under Request headers, add <Code>Authorization</Code> with this value.
        <CopyField text={`Bearer ${created.token}`} className="mt-2" />
      </li>
      <li>Choose No sign in.</li>
    </ol>
  </div>
}

/** Keys for Ego's MCP connector, so Claude can read the data and keep notes from claude.ai or a routine. */
export function AgentSection(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const [keys, setKeys] = useState<AgentKeySummary[] | null>(null)
  const [mcpUrl, setMcpUrl] = useState<string | null>(null)
  const [notes, setNotes] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<AgentKeyCreated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<AgentKeySummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.agentKeys()
    if (result.ok) {
      setKeys(result.data.keys)
      setMcpUrl(result.data.mcpUrl)
      setError(null)
    } else {
      setError(result.error.message)
    }
  }, [ledger.api])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    void ledger.api.agentMemories().then((result) => {
      if (active && result.ok) setNotes(result.data.memories.length)
    })
    return () => { active = false }
  }, [ledger.api])

  const create = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    const result = await ledger.api.createAgentKey(name.trim() || null)
    setCreating(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setCreated(result.data)
    setMcpUrl(result.data.mcpUrl)
    setName('')
    setError(null)
    await load()
  }

  const revoke = async (): Promise<void> => {
    if (!revoking) return
    setBusy(true)
    const result = await ledger.api.revokeAgentKey(revoking.id)
    setBusy(false)
    if (revoking.id === created?.key.id) setCreated(null)
    setRevoking(null)
    if (!result.ok && result.error.code !== 'NOT_FOUND') setError(result.error.message)
    await load()
  }

  return <Section Icon={Plug} title="Connect Claude">
    <SectionNote>Claude can read Ego's data and keep notes about you through this connector. Changes it asks for wait for your Confirm in the Agent chat, unless you trust that kind of change.</SectionNote>

    {mcpUrl && <>
      <FieldLabel>Connector URL</FieldLabel>
      <CopyField text={mcpUrl} className="mt-0" />
    </>}

    <FieldLabel>Keys</FieldLabel>
    {keys === null && !error && <p className="text-[15px] text-muted-foreground">Loading...</p>}
    {keys !== null && keys.length === 0 && <p className="text-[15px] text-muted-foreground">No keys yet.</p>}
    {keys !== null && keys.length > 0 && <div>{keys.map((key) => <div key={key.id} className="flex min-h-16 items-center border-t border-surface-800 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-800"><KeyRound color="#d4d4d4" size={17} /></span>
      <div className="ml-3 min-w-0 flex-1">
        <p className="truncate text-[16px]">{key.name}</p>
        <p className="text-[14px] text-muted-foreground">Created {dayLabel(key.createdAt)} · {usedLabel(key)}</p>
      </div>
      <Button variant="outline" onClick={() => setRevoking(key)}>Revoke</Button>
    </div>)}</div>}

    <form
      className="mt-4 flex gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <input
        aria-label="Key name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={AGENT_KEY_NAME_MAX}
        placeholder="Name, optional"
        className={cn(inputClass, 'min-w-0 flex-1')}
      />
      <Button type="submit" disabled={creating}>{creating ? 'Creating...' : 'New key'}</Button>
    </form>
    <SectionNote className="mt-2">Make one key for each place you connect, so you can revoke one alone.</SectionNote>
    {created && <NewKey created={created} />}
    {error && <p role="alert" className="mt-3 text-[15px] leading-5 text-destructive">{error}</p>}

    <Button variant="outline" size="lg" onClick={() => navigate('/ai/memory', { state: { from: '/settings' } })} className="mt-4 w-full">
      <Brain color="#d4d4d4" size={18} />
      Memory
      {notes !== null && <span className="font-normal text-muted-foreground">{noteCount(notes)}</span>}
      <ChevronRight color="#fafafa" size={18} />
    </Button>

    <ConfirmDialog
      visible={revoking !== null}
      title={`Revoke ${revoking?.name ?? 'this key'}?`}
      detail="Claude loses access through it at once. Notes it saved stay in Memory."
      confirmLabel="Revoke"
      destructive
      busy={busy}
      onCancel={() => setRevoking(null)}
      onConfirm={() => void revoke()}
    />
  </Section>
}
