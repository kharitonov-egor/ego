import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bot, Brain, Check, ChevronDown, ChevronRight, Target, X } from 'lucide-react'
import type { AgentSettingsView } from '@ego/api-contracts'
import { AGENT_ROUTINE_PROMPT, type AgentDevices, type AgentSettings } from '@ego/core'
import { timeAgo } from '@ego/local/dates'
import { fireMessage, trustOptions, withTrust } from '../../lib/agent'
import { useLedger } from '../../lib/ledger'
import { isWeb } from '../../lib/platform'
import { cn } from '../../lib/utils'
import { Code, CopyField } from '../copy'
import { ExternalLink } from '../ExternalLink'
import { Section, SectionNote } from '../Section'
import { Button } from '../ui/button'
import { inputClass } from '../ui/input'
import { Switch } from '../ui/switch'
import { BrowserNotifications } from './BrowserNotifications'

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/
const ROUTINES_URL = 'https://claude.ai/code/routines'
const TRUST = trustOptions()
const DEVICES: ReadonlyArray<{ key: keyof AgentDevices; label: string }> = [
  { key: 'phone', label: 'Phone' }, { key: 'desktop', label: 'Desktop' }, { key: 'web', label: 'Web' }
]

function Heading({ children }: { children: React.ReactNode }): React.ReactElement {
  return <h3 className="mb-1 mt-6 text-[13px] font-semibold uppercase tracking-wide text-surface-400">{children}</h3>
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): React.ReactElement {
  return <div className="flex min-h-12 items-center justify-between gap-3 border-t border-surface-800 py-2">
    <span className="text-[16px]">{label}</span>
    <Switch label={label} checked={checked} onCheckedChange={onChange} />
  </div>
}

/** A whole number that saves when the field loses focus, so typing 12 does not save 1 first. */
function NumberSetting({ before, after, value, min, max, onCommit }: {
  before: string
  after: string
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}): React.ReactElement {
  const [text, setText] = useState(String(value))
  const [hint, setHint] = useState(false)
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const next = Number(text)
    if (text.trim() !== '' && Number.isInteger(next) && next >= min && next <= max) {
      setHint(false)
      if (next !== value) onCommit(next)
    } else {
      setHint(true)
      setText(String(value))
    }
  }
  return <div className="border-t border-surface-800 py-2">
    <label className="flex min-h-12 flex-wrap items-center gap-3 text-[16px]">
      {before}
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        className={cn(inputClass, 'w-24')}
      />
      {after}
    </label>
    {hint && <p className="text-[14px] text-attention">Use a whole number from {min} to {max}.</p>}
  </div>
}

function SetupSteps(): React.ReactElement {
  return <ol className="mt-3 list-decimal space-y-3 pl-5 text-[14px] leading-6 text-surface-300">
    <li>
      Open <ExternalLink href={ROUTINES_URL} className="font-semibold text-surface-100 underline underline-offset-4 hover:text-foreground">claude.ai/code/routines</ExternalLink> and
      click New routine.
    </li>
    <li>
      Paste this prompt.
      <CopyField text={AGENT_ROUTINE_PROMPT} className="mt-2" />
    </li>
    <li>Pick Claude Sonnet 5.5, the repository <Code>kharitonov-egor/ego</Code>, and keep every connector, Ego included.</li>
    <li>Add a Schedule trigger, hourly at 7 minutes past, and an API trigger. Copy its URL and generate a token.</li>
    <li>
      From <Code>apps/api</Code>, run these and paste the URL and then the token when asked.
      <CopyField text="npx wrangler secret put AGENT_ROUTINE_URL" className="mt-2" />
      <CopyField text="npx wrangler secret put AGENT_ROUTINE_TOKEN" className="mt-2" />
    </li>
  </ol>
}

/** The background agent: its Claude Code routine, when it may notify, and what it may change without asking. */
export function AgentSettingsSection(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const web = isWeb()
  const [view, setView] = useState<AgentSettingsView | null>(null)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [goalCount, setGoalCount] = useState<number | null>(null)
  const [waking, setWaking] = useState(false)
  const [woke, setWoke] = useState<{ text: string; good: boolean } | null>(null)
  const [showSteps, setShowSteps] = useState(false)
  /** What the server last accepted, to fall back to when it rejects a change. */
  const saved = useRef<AgentSettings | null>(null)
  const latest = useRef<AgentSettings | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const saveSeq = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const result = await ledger.api.agentSettings()
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    setView(result.data)
    if (saveSeq.current === 0 || latest.current === null) {
      saved.current = result.data.settings
      latest.current = result.data.settings
      setSettings(result.data.settings)
    }
    setError(null)
  }, [ledger.api])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let active = true
    void ledger.api.agentGoals().then((result) => {
      if (active && result.ok) setGoalCount(result.data.goals.length)
    })
    return () => { active = false }
  }, [ledger.api])

  /** Saves run one at a time, each with the whole settings object, so the last change always wins. */
  const change = (update: (current: AgentSettings) => AgentSettings): void => {
    const base = latest.current
    if (!base) return
    const next = update(base)
    latest.current = next
    setSettings(next)
    setError(null)
    const seq = (saveSeq.current += 1)
    queue.current = queue.current.then(async () => {
      const result = await ledger.api.saveAgentSettings(next)
      if (result.ok) saved.current = result.data.settings
      if (seq !== saveSeq.current) return
      if (result.ok) {
        latest.current = result.data.settings
        setSettings(result.data.settings)
        setView(result.data)
      } else {
        setError(result.error.message)
        latest.current = saved.current
        setSettings(saved.current)
      }
    })
  }

  const wake = async (): Promise<void> => {
    if (waking) return
    setWaking(true)
    setWoke(null)
    const result = await ledger.api.fireAgentRoutine()
    setWaking(false)
    setWoke(result.ok ? { text: fireMessage(result.data), good: result.data.fired } : { text: result.error.message, good: false })
    void load()
  }

  const routine = view?.routine ?? null
  const setClock = (key: 'quietStart' | 'quietEnd') => (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value
    if (CLOCK.test(value)) change((current) => ({ ...current, [key]: value }))
  }

  return <Section Icon={Bot} title="Agent">
    <SectionNote>A Claude Code routine on your Claude plan works on your goals in the background and posts in the Agent chat.</SectionNote>
    {!view && !error && <p className="mt-3 text-[15px] text-muted-foreground">Loading...</p>}
    {error && <p role="alert" className="mt-3 text-[15px] leading-5 text-destructive">{error}</p>}

    {routine && <>
      <Heading>Routine</Heading>
      <div className="flex min-h-14 items-center py-2">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', routine.configured ? 'bg-positive/15' : 'bg-surface-800')}>
          {routine.configured ? <Check color="#34d399" size={17} /> : <X color="#a3a3a3" size={17} />}
        </div>
        <div className="ml-3 min-w-0 flex-1">
          <p className="text-[16px]">{routine.configured ? 'Connected' : 'Not set up'}</p>
          <p className="text-[14px] text-muted-foreground">{routine.lastFiredAt ? `Last woken ${timeAgo(routine.lastFiredAt, new Date())}` : 'Never woken'}</p>
        </div>
      </div>
      {routine.lastError && <p className="text-[15px] leading-5 text-attention">{routine.lastError}</p>}
      <Button variant="outline" size="lg" disabled={waking} onClick={() => void wake()} className="mt-3 w-full">
        {waking ? 'Waking...' : 'Wake the agent now'}
      </Button>
      {woke && <p role="status" className={cn('mt-2 text-[15px] leading-5', woke.good ? 'text-positive' : 'text-destructive')}>{woke.text}</p>}
      {routine.configured
        ? <>
          <button
            type="button"
            aria-expanded={showSteps}
            onClick={() => setShowSteps((shown) => !shown)}
            className="mt-3 flex items-center gap-1.5 text-[15px] font-semibold text-surface-200 hover:text-foreground"
          >
            {showSteps ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            How to set it up
          </button>
          {showSteps && <SetupSteps />}
        </>
        : <>
          <p className="mt-4 text-[15px] font-semibold">Set it up</p>
          <SetupSteps />
        </>}
    </>}

    {settings && view && <>
      <Heading>Notifications</Heading>
      <div className="flex min-h-12 flex-wrap items-center gap-3 py-2 text-[16px]">
        Quiet from
        <input type="time" aria-label="Quiet hours start" value={settings.quietStart} onChange={setClock('quietStart')} className={cn(inputClass, 'w-36 [color-scheme:dark]')} />
        until
        <input type="time" aria-label="Quiet hours end" value={settings.quietEnd} onChange={setClock('quietEnd')} className={cn(inputClass, 'w-36 [color-scheme:dark]')} />
      </div>
      <SectionNote className="mb-2">Notifications wait for quiet hours to end. Times are in {view.timeZone}.</SectionNote>
      <NumberSetting
        before="At most"
        after="a day"
        value={settings.dailyCap}
        min={0}
        max={100}
        onCommit={(dailyCap) => change((current) => ({ ...current, dailyCap }))}
      />
      {DEVICES.map((device) => <SwitchRow
        key={device.key}
        label={device.label}
        checked={settings.devices[device.key]}
        onChange={(on) => change((current) => ({ ...current, devices: { ...current.devices, [device.key]: on } }))}
      />)}
      {!web && <SectionNote className="mb-2 mt-1">On Windows, Ego shows notifications from the tray.</SectionNote>}
      <NumberSetting
        before="Proposals expire after"
        after="days"
        value={settings.proposalDays}
        min={1}
        max={60}
        onCommit={(proposalDays) => change((current) => ({ ...current, proposalDays }))}
      />

      {web && <>
        <Heading>Notifications in this browser</Heading>
        <BrowserNotifications webOff={!settings.devices.web} />
      </>}

      <Heading>Changes it can make without asking</Heading>
      <SectionNote className="mb-2">Everything else waits in the Agent chat for you to confirm.</SectionNote>
      {TRUST.map((tool) => <SwitchRow
        key={tool.name}
        label={tool.label}
        checked={settings.trusted.includes(tool.name)}
        onChange={(on) => change((current) => ({ ...current, trusted: withTrust(current.trusted, tool.name, on) }))}
      />)}
    </>}

    <div className="mt-5 flex flex-col gap-3">
      <Button variant="outline" size="lg" onClick={() => navigate('/ai/goals', { state: { from: '/settings' } })} className="w-full">
        <Target color="#d4d4d4" size={18} />
        Goals
        {goalCount !== null && <span className="font-normal text-muted-foreground">{goalCount === 1 ? '1 goal' : `${goalCount} goals`}</span>}
        <ChevronRight color="#fafafa" size={18} />
      </Button>
      <Button variant="outline" size="lg" onClick={() => navigate('/ai/memory', { state: { from: '/settings' } })} className="w-full">
        <Brain color="#d4d4d4" size={18} />
        Memory
        <ChevronRight color="#fafafa" size={18} />
      </Button>
    </div>
  </Section>
}
