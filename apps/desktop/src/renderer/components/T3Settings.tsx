import React, { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import type { T3Status } from '../../shared/types'
import { Section, SectionNote } from './Section'
import { Button } from './ui/button'
import { inputClass } from './ui/input'
import { Switch } from './ui/switch'

function describe(status: T3Status): string {
  if (status.expired) return 'Pairing expired or revoked. Pair again.'
  if (status.lastError) return status.lastError
  if (!status.watching) return 'Idle'

  const threads = `Watching ${status.threadCount} thread${status.threadCount === 1 ? '' : 's'}`
  if (!status.expiresAt) return threads

  const days = Math.round((status.expiresAt - Date.now()) / 86_400_000)
  return days > 0 ? `${threads} · renew in ${days}d` : threads
}

export default function T3Settings(): React.ReactElement {
  const [status, setStatus] = useState<T3Status | null>(null)
  const [pairingUrl, setPairingUrl] = useState('')
  const [pairing, setPairing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.t3GetStatus().then(setStatus)
    const id = setInterval(() => void window.api.t3GetStatus().then(setStatus), 5000)
    return () => clearInterval(id)
  }, [])

  const pair = async (): Promise<void> => {
    setPairing(true)
    setError(null)
    const result = await window.api.t3Pair(pairingUrl.trim())
    setPairing(false)
    if (!result.ok) {
      setError(result.detail)
      return
    }
    setPairingUrl('')
    setStatus(await window.api.t3GetStatus())
  }

  const unpair = async (): Promise<void> => {
    setStatus(await window.api.t3Unpair())
    setError(null)
  }

  const toggle = async (enabled: boolean): Promise<void> => {
    setStatus(await window.api.t3SetEnabled(enabled))
  }

  return <Section
    Icon={Bell}
    title="T3 Code notifications"
    right={status?.paired ? <Switch label="Notify me about thread activity" checked={status.enabled} onCheckedChange={(enabled) => void toggle(enabled)} /> : undefined}
  >
    <SectionNote>Toasts when a turn finishes, fails, or blocks on your approval.</SectionNote>
    {status?.paired
      ? <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-surface-800 bg-surface-900 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px]">{status.origin}</p>
          <p className="text-[14px] text-muted-foreground">{describe(status)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void unpair()} className="text-destructive">Unpair</Button>
      </div>
      : <div className="mt-4">
        <SectionNote className="mt-0">In T3 Code open Settings, then Connections, and create a pairing link with orchestration:read. Paste it here.</SectionNote>
        <input
          aria-label="T3 Code pairing link"
          value={pairingUrl}
          onChange={(event) => setPairingUrl(event.target.value)}
          placeholder="http://127.0.0.1:3773/pair#token=..."
          className={`${inputClass} mt-3`}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          {error ? <span role="alert" className="text-[14px] text-destructive">{error}</span> : <span />}
          <Button disabled={pairing || !pairingUrl.trim()} onClick={() => void pair()}>
            {pairing ? 'Pairing…' : 'Pair with T3 Code'}
          </Button>
        </div>
      </div>}
  </Section>
}
