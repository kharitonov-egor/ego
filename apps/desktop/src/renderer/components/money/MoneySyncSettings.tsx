import React, { useEffect, useState } from 'react'
import { CloudCog, Database, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { buttonClass, inputClass, panelClass, subtleButtonClass } from './Common'

function LedgerServiceSettings(): React.ReactElement {
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'connected' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void window.api.moneyGetLedgerConfig().then((config) => {
      setUrl(config.url)
      setHasToken(config.hasToken)
    })
  }, [])

  const save = async (): Promise<void> => {
    setState('saving')
    setMessage('')
    const result = await window.api.moneySetLedgerConfig({ url, ...(token ? { token } : {}) })
    if (result.ok) {
      setState('connected')
      setHasToken(true)
      setToken('')
      setMessage('Connected. Money now goes through the Worker.')
      return
    }
    setState('error')
    setMessage(result.message)
  }

  const active = hasToken && url.length > 0
  return <section className={`${panelClass} mb-4 p-4`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-surface-200"><CloudCog size={15} />Ledger service</h3>
        <p className="mt-1 text-xs text-surface-500">While this is set, every money write goes through the Worker with a revision check. Clear the token to fall back to the direct D1 connection.</p>
      </div>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${state === 'connected' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : state === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-400' : active ? 'border-surface-700 text-surface-400' : 'border-surface-700 text-surface-500'}`}>{state === 'connected' ? 'Connected' : state === 'error' ? 'Connection failed' : active ? 'Active' : 'Not in use'}</span>
    </div>
    <label className="mt-4 block text-xs text-surface-400">API address<input className={`${inputClass} mt-1.5`} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://ego-money.workers.dev" /></label>
    <label className="mt-3 block text-xs text-surface-400"><span className="flex items-center gap-1.5"><KeyRound size={11} />Device token</span><input type="password" className={`${inputClass} mt-1.5`} value={token} onChange={(event) => setToken(event.target.value)} placeholder={hasToken ? 'Stored with Windows encryption. Enter a new token to replace it.' : 'From ego-device enroll'} /></label>
    <div className="mt-3 flex items-center gap-2">
      <button className={buttonClass} disabled={state === 'saving' || !url || (!hasToken && !token)} onClick={() => void save()}>{state === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <CloudCog size={14} />}Save and connect</button>
      {message && <span className={`text-xs ${state === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>{message}</span>}
    </div>
  </section>
}

export default function MoneySyncSettings(): React.ReactElement {
  const [accountId, setAccountId] = useState('')
  const [databaseId, setDatabaseId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [hasApiToken, setHasApiToken] = useState(false)
  const [state, setState] = useState<'idle' | 'saving' | 'testing' | 'connected' | 'error'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void window.api.moneyGetSyncStatus().then((status) => {
      setAccountId(status.accountId)
      setDatabaseId(status.databaseId)
      setHasApiToken(status.hasApiToken)
    })
  }, [])

  const save = async (): Promise<void> => {
    setState('saving')
    setMessage('')
    const result = await window.api.moneySetSyncConfig({
      accountId,
      databaseId,
      ...(apiToken ? { apiToken } : {})
    })
    if (result.ok) {
      setState('connected')
      setHasApiToken(true)
      setApiToken('')
      setMessage('Connected. The D1 tables are ready.')
    } else {
      setState('error')
      setMessage(result.message)
    }
  }

  const test = async (): Promise<void> => {
    setState('testing')
    const result = await window.api.moneyTestConnection()
    setState(result.ok ? 'connected' : 'error')
    setMessage(result.ok ? 'Connected to D1' : result.message)
  }

  const working = state === 'saving' || state === 'testing'
  const configured = hasApiToken && accountId && databaseId
  return <><LedgerServiceSettings /><section className={`${panelClass} mb-4 p-4`}>
    <div className="flex items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-medium text-surface-200"><Database size={15} />Cloudflare D1</h3><p className="mt-1 text-xs text-surface-500">Electron calls the D1 HTTPS API directly. Use a token limited to D1 Read and D1 Write.</p></div><span className={`rounded-full border px-2 py-0.5 text-[11px] ${state === 'connected' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : state === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-surface-700 text-surface-500'}`}>{state === 'connected' ? 'Connected' : state === 'error' ? 'Connection failed' : configured ? 'Configured' : 'Needs setup'}</span></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2"><label className="text-xs text-surface-400">Cloudflare account ID<input className={`${inputClass} mt-1.5`} value={accountId} maxLength={32} onChange={(event) => setAccountId(event.target.value)} placeholder="32-character account ID" /></label><label className="text-xs text-surface-400">D1 database ID<input className={`${inputClass} mt-1.5`} value={databaseId} maxLength={36} onChange={(event) => setDatabaseId(event.target.value)} placeholder="Database UUID" /></label></div>
    <label className="mt-3 block text-xs text-surface-400"><span className="flex items-center gap-1.5"><KeyRound size={11} />D1 API token</span><input type="password" className={`${inputClass} mt-1.5`} value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder={hasApiToken ? 'Stored with Windows encryption. Enter a new token to replace it.' : 'Token with D1 Read and D1 Write'} /></label>
    <div className="mt-3 flex items-center gap-2"><button className={buttonClass} disabled={working || !accountId || !databaseId || (!hasApiToken && !apiToken)} onClick={() => void save()}>{working && state === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}Save and connect</button><button className={subtleButtonClass} disabled={working || !configured} onClick={() => void test()}>{working && state === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}Test</button>{message && <span className={`text-xs ${state === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>{message}</span>}</div>
  </section></>
}
