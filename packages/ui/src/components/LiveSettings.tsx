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
import { Section, SectionNote } from './Section'
import { Button } from './ui/button'
import { inputClass } from './ui/input'
import { cn } from '../lib/utils'

const controlClass = `${inputClass} mt-2 disabled:opacity-50`

const fieldClass = 'block text-[15px] font-medium text-surface-200'

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

  return <Section Icon={AudioLines} title="Talk to AI">
    <SectionNote>These choices apply when the next call starts. Your OpenAI key remains on the Ego Worker.</SectionNote>

    <h3 className="mt-5 border-t border-surface-800 pt-4 text-[15px] font-semibold text-surface-200">AI connections and tools</h3>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <ConnectionCard name="Google account" status={google} access="Gmail and Drive, read-only" onConnect={() => void openAuthorization('google')} onRefresh={() => void refreshConnection('google')} onDisconnect={() => void disconnect('google')} />
      <div className="rounded-2xl border border-surface-800 bg-surface-900 p-4">
        <div className="flex items-center justify-between gap-2"><span className="text-[15px] font-medium">Wispr Flow</span><span className="rounded-full border border-surface-700 px-2 py-0.5 text-[12px] text-surface-400">Read-only</span></div>
        <p className="mt-1 text-[14px] text-muted-foreground">{wispr?.connected ? wispr.accountLabel ?? 'Connected' : 'Meetings, notes, attendees, and calendar events'}</p>
        {!wispr?.connected && <input aria-label="Wispr Flow server URL" value={wisprUrl} onChange={(event) => setWisprUrl(event.target.value)} placeholder="https://api.wisprflow.ai/..." className={controlClass} />}
        <div className="mt-3 flex gap-2">
          {wispr?.connected
            ? <><Button variant="outline" size="sm" onClick={() => void refreshConnection('wispr')}>Test connection</Button><Button variant="ghost" size="sm" onClick={() => void disconnect('wispr')} className="text-destructive">Disconnect</Button></>
            : <Button variant="secondary" size="sm" disabled={!wisprUrl.trim()} onClick={() => void openAuthorization('wispr')}>Add Wispr Flow</Button>}
        </div>
      </div>
    </div>
    {connectionError && <p role="alert" className="mt-3 text-[14px] text-destructive">{connectionError}</p>}
    <div className="mt-4 grid gap-2 md:grid-cols-2">
      <ToolSwitch label="Read Gmail" checked={tools.readGmail} disabled={!google?.connected} onChange={(value) => updateTool('readGmail', value)} />
      <ToolSwitch label="Read Google Drive and Docs" checked={tools.readGoogleDrive} disabled={!google?.connected} onChange={(value) => updateTool('readGoogleDrive', value)} />
      <ToolSwitch label="Read Wispr meetings and notes" checked={tools.readWispr} disabled={!wispr?.connected} onChange={(value) => updateTool('readWispr', value)} />
      <ToolSwitch label="Read Ego Money" checked={tools.readEgoMoney} onChange={(value) => updateTool('readEgoMoney', value)} />
      <ToolSwitch label="Record Ego transactions" checked={tools.recordEgoTransactions} detail="Every transaction still needs a button press." onChange={(value) => updateTool('recordEgoTransactions', value)} />
    </div>

    <div className="mt-5 grid grid-cols-1 gap-4 border-t border-surface-800 pt-4 md:grid-cols-2">
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
        <span id="live-token-help" className="mt-1.5 block text-[13px] font-normal leading-5 text-surface-500">Higher limits can give longer answers and cost more.</span>
      </label>

      <label className={`${fieldClass} md:col-span-2`}>Custom speaking instructions
        <textarea aria-label="Custom speaking instructions" maxLength={2000} rows={3} disabled={!loaded} value={preferences.customInstructions} onChange={(event) => update('customInstructions', event.target.value)} placeholder="For example: Explain technical terms in plain English." className={`${controlClass} resize-y`} />
        <span className="mt-1 block text-right text-[12px] font-normal text-surface-500">{preferences.customInstructions.length}/2000</span>
      </label>
    </div>

    <div className="mt-4 flex items-center justify-between gap-4 border-t border-surface-800 pt-4">
      <p className="max-w-md text-[14px] leading-5 text-muted-foreground">Read tools run when enabled. Ego writes always stop for on-screen confirmation. Ask for a card and it goes to the Inbox through the AI.</p>
      <div className="flex shrink-0 items-center gap-3">
        {saved && <span role="status" className="text-[14px] text-positive">Saved for the next call</span>}
        <Button disabled={!loaded} onClick={() => void save()}>
          <Save size={16} /> Save AI settings
        </Button>
      </div>
    </div>
  </Section>
}

function ConnectionCard({ name, status, access, onConnect, onRefresh, onDisconnect }: {
  name: string
  status: ConnectorStatus | null
  access: string
  onConnect: () => void
  onRefresh: () => void
  onDisconnect: () => void
}): React.ReactElement {
  return <div className="rounded-2xl border border-surface-800 bg-surface-900 p-4">
    <div className="flex items-center gap-2 text-[15px] font-medium"><Link2 size={15} />{name}</div>
    <p className="mt-1 text-[14px] text-muted-foreground">{status?.connected ? status.accountLabel ?? 'Connected' : access}</p>
    <div className="mt-3 flex gap-2">
      {status?.connected
        ? <><Button variant="outline" size="sm" onClick={onConnect}>Reconnect</Button><Button variant="ghost" size="sm" onClick={onDisconnect} className="text-destructive"><Unplug size={14} />Disconnect</Button></>
        : <Button variant="secondary" size="sm" onClick={onConnect}>Connect</Button>}
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
  return <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border border-surface-800 px-3.5 py-3', disabled && 'cursor-default opacity-45')}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 accent-white" />
    <span><span className="block text-[15px]">{label}</span>{detail && <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{detail}</span>}</span>
  </label>
}
