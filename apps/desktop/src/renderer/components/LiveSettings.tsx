import React, { useEffect, useRef, useState } from 'react'
import { AudioLines, Link2, Save, Unplug } from 'lucide-react'
import {
  DEFAULT_LIVE_TOOL_PREFERENCES,
  DEFAULT_LIVE_PREFERENCES,
  LIVE_VOICES,
  resolvedLiveToolPreferences,
  type LiveAnswerDetail,
  type LivePreferences,
  type LiveReasoningEffort,
  type LiveVoice,
  type LiveWebSearch,
  type LiveToolPreferences
} from '@ego/core'
import type { ConnectorStatus } from '@ego/api-contracts'

const controlClass =
  'mt-1.5 w-full rounded-lg border border-surface-700 bg-surface-800/50 px-3 py-2 ' +
  'text-sm text-surface-200 outline-none transition-colors hover:border-surface-600 ' +
  'focus:border-accent-500 focus:ring-1 focus:ring-accent-500/30'

const fieldClass = 'text-xs text-surface-400'

export default function LiveSettings(): React.ReactElement {
  const [preferences, setPreferences] = useState<LivePreferences>(DEFAULT_LIVE_PREFERENCES)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [google, setGoogle] = useState<ConnectorStatus | null>(null)
  const [wispr, setWispr] = useState<ConnectorStatus | null>(null)
  const [wisprUrl, setWisprUrl] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.getLivePreferences().then((value) => {
      if (cancelled) return
      setPreferences(value)
      setLoaded(true)
    })
    if (window.api.connectorGetStatus) {
      void window.api.connectorGetStatus('google').then((result) => {
        if (!cancelled && result.ok) setGoogle(result.data)
      })
      void window.api.connectorGetStatus('wispr').then((result) => {
        if (!cancelled && result.ok) setWispr(result.data)
      })
    }
    return () => {
      cancelled = true
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    }
  }, [])

  const update = <K extends keyof LivePreferences>(key: K, value: LivePreferences[K]): void => {
    setPreferences((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  const save = async (): Promise<void> => {
    const next = await window.api.setLivePreferences(preferences)
    setPreferences(next)
    setSaved(true)
  }

  const updateTool = (key: keyof LiveToolPreferences, value: boolean): void => {
    setPreferences((current) => ({
      ...current,
      tools: { ...DEFAULT_LIVE_TOOL_PREFERENCES, ...resolvedLiveToolPreferences(current), [key]: value }
    }))
    setSaved(false)
  }

  const openAuthorization = async (provider: 'google' | 'wispr'): Promise<void> => {
    setConnectionError('')
    const result = provider === 'google'
      ? await window.api.connectorStartGoogle()
      : await window.api.connectorStartWispr(wisprUrl.trim())
    if (!result.ok) {
      setConnectionError(result.message)
      return
    }
    await window.api.openExternalUrl(result.data.authorizationUrl)
    const expiresAt = new Date(result.data.expiresAt).getTime()
    const poll = async (): Promise<void> => {
      const status = await window.api.connectorGetStatus(provider)
      if (status.ok && status.data.connected) {
        if (provider === 'google') setGoogle(status.data)
        else setWispr(status.data)
        pollTimer.current = null
        return
      }
      if (Date.now() < expiresAt) pollTimer.current = window.setTimeout(() => void poll(), 2000)
    }
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    pollTimer.current = window.setTimeout(() => void poll(), 2000)
  }

  const refreshConnection = async (provider: 'google' | 'wispr'): Promise<void> => {
    const result = await window.api.connectorGetStatus(provider)
    if (!result.ok) {
      setConnectionError(result.message)
      return
    }
    if (provider === 'google') setGoogle(result.data)
    else setWispr(result.data)
  }

  const disconnect = async (provider: 'google' | 'wispr'): Promise<void> => {
    const result = await window.api.connectorDisconnect(provider)
    if (!result.ok) {
      setConnectionError(result.message)
      return
    }
    await refreshConnection(provider)
  }

  const tools = resolvedLiveToolPreferences(preferences)

  return <section className="mb-4 rounded-lg border border-surface-800 bg-surface-900/50 p-4" aria-labelledby="talk-to-ai-settings-heading">
    <div className="mb-1 flex items-center gap-2 text-surface-300">
      <AudioLines size={14} />
      <h3 id="talk-to-ai-settings-heading" className="text-sm font-medium">Talk to AI</h3>
    </div>
    <p className="mb-4 text-xs leading-5 text-surface-500">
      These choices apply when the next call starts. Your OpenAI key remains on the Ego Worker.
    </p>

    <div className="mb-4 border-t border-surface-800 pt-4">
      <h4 className="text-xs font-semibold text-surface-300">AI connections and tools</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ConnectionCard name="Google account" status={google} access="Gmail and Drive, read-only" onConnect={() => void openAuthorization('google')} onRefresh={() => void refreshConnection('google')} onDisconnect={() => void disconnect('google')} />
        <div className="rounded-lg border border-surface-800 bg-surface-950/40 p-3">
          <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-surface-200">Wispr Flow</span><span className="rounded-full border border-surface-700 px-2 py-0.5 text-[10px] text-surface-400">Read-only</span></div>
          <p className="mt-1 text-[11px] text-surface-500">{wispr?.connected ? wispr.accountLabel ?? 'Connected' : 'Meetings, notes, attendees, and calendar events'}</p>
          {!wispr?.connected && <input aria-label="Wispr Flow server URL" value={wisprUrl} onChange={(event) => setWisprUrl(event.target.value)} placeholder="https://api.wisprflow.ai/..." className={`${controlClass} mt-2`} />}
          <div className="mt-3 flex gap-2">
            {wispr?.connected ? <><button type="button" onClick={() => void refreshConnection('wispr')} className="rounded-md border border-surface-700 px-2.5 py-1.5 text-[11px] text-surface-300">Test connection</button><button type="button" onClick={() => void disconnect('wispr')} className="rounded-md px-2.5 py-1.5 text-[11px] text-red-300">Disconnect</button></> : <button type="button" disabled={!wisprUrl.trim()} onClick={() => void openAuthorization('wispr')} className="rounded-md bg-surface-700 px-2.5 py-1.5 text-[11px] text-surface-100 disabled:opacity-40">Add Wispr Flow</button>}
          </div>
        </div>
      </div>
      {connectionError && <p role="alert" className="mt-2 text-[11px] text-red-300">{connectionError}</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <ToolSwitch label="Read Gmail" checked={tools.readGmail} disabled={!google?.connected} onChange={(value) => updateTool('readGmail', value)} />
        <ToolSwitch label="Read Google Drive and Docs" checked={tools.readGoogleDrive} disabled={!google?.connected} onChange={(value) => updateTool('readGoogleDrive', value)} />
        <ToolSwitch label="Read Wispr meetings and notes" checked={tools.readWispr} disabled={!wispr?.connected} onChange={(value) => updateTool('readWispr', value)} />
        <ToolSwitch label="Read Ego Money" checked={tools.readEgoMoney} onChange={(value) => updateTool('readEgoMoney', value)} />
        <ToolSwitch label="Record Ego transactions" checked={tools.recordEgoTransactions} detail="Every transaction still needs a button press." onChange={(value) => updateTool('recordEgoTransactions', value)} />
        <ToolSwitch label="Create Trello cards" checked={tools.createTrelloCards} detail="Every card still needs a button press." onChange={(value) => updateTool('createTrelloCards', value)} />
      </div>
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className={fieldClass}>Voice
        <select aria-label="AI voice" disabled={!loaded} value={preferences.voice} onChange={(event) => update('voice', event.target.value as LiveVoice)} className={controlClass}>
          {LIVE_VOICES.map((voice) => <option key={voice} value={voice}>{voice[0].toUpperCase() + voice.slice(1)}</option>)}
        </select>
      </label>

      <label className={fieldClass}>Answer detail
        <select disabled={!loaded} value={preferences.answerDetail} onChange={(event) => update('answerDetail', event.target.value as LiveAnswerDetail)} className={controlClass}>
          <option value="low">Short</option>
          <option value="medium">Balanced</option>
          <option value="high">Thorough</option>
        </select>
      </label>

      <label className={fieldClass}>Reasoning depth
        <select disabled={!loaded} value={preferences.reasoningEffort} onChange={(event) => update('reasoningEffort', event.target.value as LiveReasoningEffort)} className={controlClass}>
          <option value="low">Fast</option>
          <option value="medium">Balanced</option>
          <option value="high">Deep</option>
          <option value="xhigh">Deepest</option>
        </select>
      </label>

      <label className={fieldClass}>Web search
        <select disabled={!loaded} value={preferences.webSearch} onChange={(event) => update('webSearch', event.target.value as LiveWebSearch)} className={controlClass}>
          <option value="auto">When needed</option>
          <option value="required">Every delegated answer</option>
          <option value="none">Off</option>
        </select>
      </label>

      <label className={fieldClass}>Maximum delegated response tokens
        <input aria-describedby="live-token-help" type="number" min={16} max={4096} step={16} disabled={!loaded} value={preferences.maxOutputTokens} onChange={(event) => update('maxOutputTokens', Math.max(16, Math.min(4096, Math.round(Number(event.target.value) || 16))))} className={controlClass} />
        <span id="live-token-help" className="mt-1 block text-[10px] leading-4 text-surface-500">Higher limits can give longer answers and cost more.</span>
      </label>

      <label className={`${fieldClass} sm:col-span-2`}>Custom speaking instructions
        <textarea aria-label="Custom speaking instructions" maxLength={2000} rows={3} disabled={!loaded} value={preferences.customInstructions} onChange={(event) => update('customInstructions', event.target.value)} placeholder="For example: Explain technical terms in plain English." className={`${controlClass} resize-y`} />
        <span className="mt-1 block text-right text-[10px] text-surface-500">{preferences.customInstructions.length}/2000</span>
      </label>
    </div>

    <div className="mt-3 flex items-center justify-between gap-4 border-t border-surface-800 pt-3">
      <p className="max-w-lg text-[11px] leading-4 text-surface-500">Read tools run when enabled. Ego and Trello writes always stop for on-screen confirmation.</p>
      <div className="flex shrink-0 items-center gap-3">
        {saved && <span role="status" className="text-[11px] text-emerald-400">Saved for the next call</span>}
        <button type="button" disabled={!loaded} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-xs font-medium text-white hover:bg-accent-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:opacity-40">
          <Save size={13} /> Save AI settings
        </button>
      </div>
    </div>
  </section>
}

function ConnectionCard({ name, status, access, onConnect, onRefresh, onDisconnect }: {
  name: string
  status: ConnectorStatus | null
  access: string
  onConnect: () => void
  onRefresh: () => void
  onDisconnect: () => void
}): React.ReactElement {
  return <div className="rounded-lg border border-surface-800 bg-surface-950/40 p-3">
    <div className="flex items-center gap-2 text-xs font-medium text-surface-200"><Link2 size={12} />{name}</div>
    <p className="mt-1 text-[11px] text-surface-500">{status?.connected ? status.accountLabel ?? 'Connected' : access}</p>
    <div className="mt-3 flex gap-2">
      {status?.connected ? <><button type="button" onClick={onConnect} className="rounded-md border border-surface-700 px-2.5 py-1.5 text-[11px] text-surface-300">Reconnect</button><button type="button" onClick={onDisconnect} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] text-red-300"><Unplug size={11} />Disconnect</button></> : <button type="button" onClick={onConnect} className="rounded-md bg-surface-700 px-2.5 py-1.5 text-[11px] text-surface-100">Connect</button>}
      <button type="button" onClick={onRefresh} className="sr-only">Refresh {name}</button>
    </div>
  </div>
}

function ToolSwitch({ label, checked, disabled = false, detail, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  detail?: string
  onChange: (value: boolean) => void
}): React.ReactElement {
  return <label className={`flex items-start gap-2 rounded-lg border border-surface-800 px-3 py-2.5 ${disabled ? 'opacity-45' : ''}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" />
    <span><span className="block text-xs text-surface-200">{label}</span>{detail && <span className="mt-0.5 block text-[10px] leading-4 text-surface-500">{detail}</span>}</span>
  </label>
}
