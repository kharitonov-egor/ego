import React, { useEffect, useState } from 'react'
import type { ContentKey } from '@ego/api-contracts'
import { useLedger } from '../../lib/ledger'
import { Sheet } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
export function ExtensionSettings({ onClose }: { onClose: () => void }): React.ReactElement {
  const ledger = useLedger()
  const [keys, setKeys] = useState<ContentKey[]>([])
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async (): Promise<void> => { const result = await ledger.api.contentKeys(); if (result.ok) setKeys(result.data.keys); else setError(result.error.message) }
  useEffect(() => { void load() }, [ledger.api])
  return <Sheet visible title="Chrome extension" onClose={onClose}><div className="space-y-5 text-sm">
    <p className="leading-6 text-surface-400">Load the ego-content extension in Chrome, generate a key here, then paste it into the extension's connection screen.</p>
    <label className="block text-surface-400">Server URL<input readOnly value={ledger.apiUrl} className="mt-2 w-full rounded-lg bg-black p-3 text-white" /></label>
    <Button disabled={busy} onClick={() => { setBusy(true); setError(''); void ledger.api.createContentKey().then(async result => { if (result.ok) { setToken(result.data.token); await load() } else setError(result.error.message) }).finally(() => setBusy(false)) }}>Generate extension key</Button>
    {token && <label className="block text-surface-400">Copy this key now. Ego cannot show it again.<textarea readOnly rows={3} value={token} onFocus={event => event.target.select()} className="mt-2 w-full break-all rounded-lg bg-black p-3 font-mono text-white" /></label>}
    {error && <p role="alert">{error}</p>}
    <div className="space-y-3">{keys.map(key => <div key={key.id} className="flex items-center justify-between gap-3 border-t border-surface-800 pt-3"><div>{key.name}<p className="mt-1 text-xs text-surface-500">{new Date(key.createdAt).toLocaleString()}</p></div><Button disabled={busy} variant="secondary" onClick={() => { setBusy(true); void ledger.api.revokeContentKey(key.id).then(async result => { if (result.ok) { setToken(''); await load() } else setError(result.error.message) }).finally(() => setBusy(false)) }}>Revoke</Button></div>)}</div>
  </div></Sheet>
}
