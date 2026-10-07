import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlarmClock, BellRing, Check, ChevronRight, CircleUserRound, Command, EyeOff, Info, KeyRound, Landmark, LogOut, Power, RefreshCw, ScanLine, X
} from 'lucide-react'
import type { ServiceStatus, SessionInfo } from '@ego/api-contracts'
import { formatSetDuration } from '@ego/core'
import { REMINDER_HOURS, hourLabel } from '@ego/local/reminders'
import HotkeyInput from '../components/HotkeyInput'
import LiveSettings from '../components/LiveSettings'
import { Chips, MoneyIcon, money } from '../components/common'
import { Screen, ScreenBody, ScreenHeader } from '../components/screen'
import { FieldLabel, Section, SectionNote } from '../components/Section'
import { AgentSection } from '../components/settings/AgentSection'
import { AgentSettingsSection } from '../components/settings/AgentSettingsSection'
import { DevicesSection } from '../components/settings/DevicesSection'
import { QuickAddSettings } from '../components/settings/QuickAddSettings'
import { SignInPanel, useGoogleSignIn } from '../components/SignInPanel'
import { Button } from '../components/ui/button'
import { ConfirmDialog } from '../components/ui/dialog'
import { inputClass } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { Blurred, useBlur } from '../lib/blur'
import { REST_PRESETS, useRestTimer } from '../lib/gym/rest-timer'
import { syncLabel, useLedger } from '../lib/ledger'
import { isWeb } from '../lib/platform'
import { useReminder } from '../lib/reminder'
import { cn } from '../lib/utils'

const SERVICES: Array<{ key: keyof ServiceStatus; label: string; secret: string }> = [
  { key: 'assistant', label: 'AI', secret: 'OPENROUTER_API_KEY' },
  { key: 'trello', label: 'Trello', secret: 'TRELLO_API_KEY and TRELLO_TOKEN' },
  { key: 'voice', label: 'Talk to AI voice', secret: 'OPENAI_API_KEY' },
  { key: 'google', label: 'Gmail and Drive', secret: 'Connect under Talk to AI below' },
  { key: 'canvas', label: 'Canvas calendar', secret: 'CANVAS_CALENDAR_URL' },
  { key: 'googleHealth', label: 'Google Health', secret: 'Connect from the Health app' }
]

function useSession(): { session: SessionInfo | null; error: string | null } {
  const ledger = useLedger()
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!ledger.enabled) {
      setSession(null)
      return
    }
    let cancelled = false
    void ledger.api.session().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSession(result.data)
        setError(null)
      } else {
        setError(result.error.code === 'AUTH_REQUIRED'
          ? 'The server no longer accepts this computer. Sign in again.'
          : result.error.message)
      }
    })
    return () => { cancelled = true }
  }, [ledger.api, ledger.enabled, ledger.apiUrl, ledger.account?.deviceId, ledger.account?.email])
  return { session, error }
}

function AccountSection({ session, sessionError }: { session: SessionInfo | null; sessionError: string | null }): React.ReactElement {
  const ledger = useLedger()
  const google = useGoogleSignIn()
  const navigate = useNavigate()
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const pendingCount = (ledger.status?.pendingCount ?? 0) + (ledger.status?.conflictCount ?? 0)
  const email = session?.email ?? ledger.account?.email ?? null
  const device = session?.deviceName ?? ledger.account?.deviceName ?? null
  const web = isWeb()
  const unsent = `${pendingCount} ${pendingCount === 1 ? 'change has' : 'changes have'} not reached the server.`

  const signOut = async (): Promise<void> => {
    setConfirmingSignOut(false)
    await window.api.signOut()
    navigate('/')
  }

  return <Section Icon={CircleUserRound} title="Account">
    {ledger.enabled
      ? <>
        <p className="mt-3 text-[17px]">{email ? `Signed in as ${email}` : 'Connected with a device token'}</p>
        {device && <p className="mt-0.5 text-[15px] text-muted-foreground">{web ? 'This browser' : 'This computer'}: {device}</p>}
        {sessionError && <p className="mt-2 text-[15px] leading-5 text-attention">{sessionError}</p>}
        <SectionNote className="mt-1">This one sign-in covers every app.</SectionNote>
        {(sessionError || !email) && <Button size="lg" disabled={google.signingIn} onClick={() => void google.signIn()} className="mt-4 w-full">
          {google.signingIn ? 'Opening Google...' : 'Sign in with Google'}
        </Button>}
        {google.waiting && !web && <SectionNote>Finish in the browser. Ego comes back to the front when Google is done.</SectionNote>}
        {google.error && <p className="mt-3 text-[15px] leading-5 text-destructive">{google.error}</p>}
        <Button variant="outline" size="lg" onClick={() => setConfirmingSignOut(true)} className="mt-4 w-full">
          <LogOut color="#d4d4d4" size={18} />
          Sign out
        </Button>
      </>
      : <div className="mt-3"><SignInPanel /></div>}
    <ConfirmDialog
      visible={confirmingSignOut}
      title={web ? 'Sign out of this browser?' : 'Sign out of this computer?'}
      detail={web
        ? `The server stops accepting this browser and Ego erases its copy here.${pendingCount > 0 ? ` ${unsent} They are lost.` : ''}`
        : pendingCount > 0
          ? `${unsent} They stay on this computer and sync after you sign in again.`
          : 'The server stops accepting this computer. Your ledger copy stays here for the next sign-in.'}
      confirmLabel="Sign out"
      destructive
      onCancel={() => setConfirmingSignOut(false)}
      onConfirm={() => void signOut()}
    />
  </Section>
}

function BlurSection(): React.ReactElement {
  const privacy = useBlur()
  return <Section Icon={EyeOff} title="Blur personal data" right={<Switch label="Blur personal data" checked={privacy.blurred} onCheckedChange={privacy.setBlurred} />}>
    <SectionNote>
      {privacy.blurred
        ? 'Personal numbers and entries are blurred. Ctrl+Shift+B turns it off.'
        : 'Blurs personal numbers and entries, for showing the app to someone. Ctrl+Shift+B turns it on from any screen.'}
    </SectionNote>
  </Section>
}

const HOUR_VALUES = REMINDER_HOURS.map(String)
const HOUR_LABELS = Object.fromEntries(REMINDER_HOURS.map((hour) => [String(hour), hourLabel(hour)]))

function ReminderSection(): React.ReactElement {
  const reminder = useReminder()
  return <Section Icon={BellRing} title="Daily reminder" right={<Switch label="Daily reminder" checked={reminder.preference.enabled} onCheckedChange={reminder.setEnabled} />}>
    <SectionNote>
      A nudge at {hourLabel(reminder.preference.hour)} on days with nothing logged. It stays quiet once you add anything that day.
    </SectionNote>
    {reminder.preference.enabled && <>
      <FieldLabel>Time</FieldLabel>
      <Chips values={HOUR_VALUES} value={String(reminder.preference.hour)} labels={HOUR_LABELS} onChange={(value) => reminder.setHour(Number(value))} />
    </>}
  </Section>
}

function AccountsSection(): React.ReactElement {
  const ledger = useLedger()
  const navigate = useNavigate()
  const balances = new Map(ledger.balances.map((item) => [item.accountId, item.balanceCents]))
  const openAccounts = (ledger.reference?.accounts ?? [])
    .filter((account) => !account.archivedAt)
    .map((account) => ({ ...account, balanceCents: balances.get(account.id) ?? account.openingBalanceCents }))
  return <Section Icon={Landmark} title="Accounts">
    <div className="mt-3">{openAccounts.map((account) => <div key={account.id} className="flex min-h-14 items-center border-t border-surface-800 py-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} size={17} /></span>
      <span className="ml-3 flex-1 truncate text-[16px]">{account.name}</span>
      <Blurred><span className="text-[16px] font-semibold tabular">{money(account.balanceCents)}</span></Blurred>
    </div>)}</div>
    {openAccounts.length === 0 && <p className="mt-2 text-[15px] text-muted-foreground">No accounts yet.</p>}
    <Button variant="outline" size="lg" onClick={() => navigate('/money/accounts', { state: { from: '/settings' } })} className="mt-3 w-full">
      Manage accounts
      <ChevronRight color="#fafafa" size={18} />
    </Button>
  </Section>
}

const REST_VALUES = REST_PRESETS.map(String)
const REST_LABELS = Object.fromEntries(REST_PRESETS.map((seconds) => [String(seconds), formatSetDuration(seconds)]))

function RestTimerSection(): React.ReactElement {
  const rest = useRestTimer()
  return <Section Icon={AlarmClock} title="Gym rest timer" right={<Switch label="Start the rest timer after each set" checked={rest.preference.autoStart} onCheckedChange={rest.setAutoStart} />}>
    <SectionNote>
      {rest.preference.autoStart
        ? `Starts a ${formatSetDuration(rest.preference.seconds)} countdown each time you save a new set, and beeps when it ends.`
        : 'Start the countdown yourself from the alarm clock on an exercise.'}
    </SectionNote>
    <FieldLabel>Length</FieldLabel>
    <Chips values={REST_VALUES} value={String(rest.preference.seconds)} labels={REST_LABELS} onChange={(value) => rest.setSeconds(Number(value))} />
  </Section>
}

function SyncSection(): React.ReactElement {
  const ledger = useLedger()
  return <Section Icon={RefreshCw} title="Sync">
    <p className="mt-3 text-[17px]">{ledger.syncing ? 'Syncing...' : syncLabel(ledger.status)}</p>
    {ledger.status?.message && ledger.status.state !== 'synced' && <p className="mt-1 text-[15px] leading-5 text-muted-foreground">{ledger.status.message}</p>}
    {(ledger.error ?? ledger.syncError) && <p className="mt-1 text-[15px] leading-5 text-destructive">{ledger.error ?? ledger.syncError}</p>}
    <SectionNote className="mt-1">Changes save on this computer first and reach the server when it is reachable.</SectionNote>
    <Button variant="outline" size="lg" disabled={ledger.syncing} onClick={() => void ledger.sync()} className="mt-4 w-full">Sync now</Button>
  </Section>
}

function ServerKeysSection({ session }: { session: SessionInfo }): React.ReactElement {
  return <Section Icon={KeyRound} title="Server keys">
    <SectionNote>The Worker keeps these as secrets and calls each service for this computer. Add a missing one with npx wrangler secret put.</SectionNote>
    <div className="mt-2">{SERVICES.map((service) => {
      const ready = session.services[service.key]
      return <div key={service.key} className="flex min-h-14 items-center border-t border-surface-800 py-2">
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-full', ready ? 'bg-positive/15' : 'bg-surface-800')}>
          {ready ? <Check color="#34d399" size={17} /> : <X color="#a3a3a3" size={17} />}
        </div>
        <div className="ml-3 flex-1">
          <p className="text-[16px]">{service.label}</p>
          {!ready && <p className="text-[14px] text-muted-foreground">{service.secret}</p>}
        </div>
        <span className={cn('text-[14px] font-medium', ready ? 'text-positive' : 'text-surface-500')}>{ready ? 'Ready' : 'Not set up'}</span>
      </div>
    })}</div>
  </Section>
}

function QuickToolsSection(): React.ReactElement {
  const [hotkey, setHotkey] = useState('')
  useEffect(() => {
    void window.api.getToolPaletteHotkey().then(setHotkey)
  }, [])
  const change = async (next: string): Promise<void> => {
    setHotkey(next)
    await window.api.setToolPaletteHotkey(next)
  }
  return <Section Icon={Command} title="Quick tools">
    <SectionNote>Open Claude, read text from an image, or save online media from one chooser.</SectionNote>
    <FieldLabel>Global hotkey</FieldLabel>
    <HotkeyInput value={hotkey} onChange={(next) => void change(next)} />
  </Section>
}

function StartupSection(): React.ReactElement {
  const [autoStart, setAutoStart] = useState(false)
  useEffect(() => {
    void window.api.getAutoStart().then(setAutoStart)
  }, [])
  const toggle = async (next: boolean): Promise<void> => {
    await window.api.setAutoStart(next)
    setAutoStart(next)
  }
  return <Section Icon={Power} title="Start with Windows" right={<Switch label="Start with Windows" checked={autoStart} onCheckedChange={(next) => void toggle(next)} />}>
    <SectionNote>Ego waits in the tray, so the hotkeys work before you open it.</SectionNote>
  </Section>
}

function ReceiptSection(): React.ReactElement {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('openai/gpt-5.6-terra')
  const [hasApiKey, setHasApiKey] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void window.api.getTransactionImageSettings().then((settings) => {
      setHasApiKey(settings.hasApiKey)
      setModel(settings.model)
    })
  }, [])
  const save = async (): Promise<void> => {
    const next = await window.api.setTransactionImageSettings({ apiKey: apiKey.trim() || undefined, model: model.trim() })
    setHasApiKey(next.hasApiKey)
    setModel(next.model)
    setApiKey('')
    setSaved(true)
  }
  return <Section Icon={ScanLine} title="Receipt photos">
    <SectionNote>Finance reads a pasted or dropped receipt with OpenRouter. It sees one temporary image, and Ego does not save it.</SectionNote>
    <FieldLabel htmlFor="openrouter-key">OpenRouter API key</FieldLabel>
    <input id="openrouter-key" type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setSaved(false) }} placeholder={hasApiKey ? 'Saved key' : 'sk-or-v1-...'} className={inputClass} />
    <FieldLabel htmlFor="openrouter-model">Model</FieldLabel>
    <input id="openrouter-model" value={model} onChange={(event) => { setModel(event.target.value); setSaved(false) }} placeholder="openai/gpt-5.6-terra" className={inputClass} />
    <div className="mt-4 flex items-center justify-between gap-3">
      <span className={cn('text-[14px]', saved ? 'text-positive' : hasApiKey ? 'text-surface-400' : 'text-attention')}>
        {saved ? 'Saved' : hasApiKey ? 'API key saved' : 'API key needed'}
      </span>
      <Button disabled={!model.trim() || (!hasApiKey && !apiKey.trim())} onClick={() => void save()}>Save</Button>
    </div>
  </Section>
}

function AboutSection(): React.ReactElement {
  return <Section Icon={Info} title="About">
    <div className="mt-4 flex items-center justify-between">
      <span className="text-[15px] text-muted-foreground">Version</span>
      <span className="font-mono text-[15px]">{__EGO_VERSION__}</span>
    </div>
    <div className="mt-2 flex items-center justify-between">
      <span className="text-[15px] text-muted-foreground">Commit</span>
      <span className="select-text font-mono text-[15px]">{__EGO_COMMIT__}</span>
    </div>
  </Section>
}

export default function Settings(): React.ReactElement {
  const ledger = useLedger()
  const { session, error } = useSession()
  const web = isWeb()
  return <Screen>
    <ScreenHeader title="Settings" />
    <ScreenBody className="flex flex-col gap-3 pb-10">
      <AccountSection session={session} sessionError={error} />
      <BlurSection />
      {!web && <ReminderSection />}
      <RestTimerSection />
      {ledger.enabled && ledger.reference && <AccountsSection />}
      {ledger.enabled && <SyncSection />}
      {ledger.enabled && <AgentSection />}
      {ledger.enabled && <AgentSettingsSection />}
      {ledger.enabled && <DevicesSection />}
      {ledger.enabled && session && <ServerKeysSection session={session} />}
      <QuickAddSettings />
      {!web && <QuickToolsSection />}
      {!web && <StartupSection />}
      <LiveSettings />
      {!web && <ReceiptSection />}
      <AboutSection />
    </ScreenBody>
  </Screen>
}
