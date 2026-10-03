import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronRight, HeartPulse, RefreshCw, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { formatSleepMinutes, type HealthUnits, type Readiness, type ReadinessPart } from '@ego/core'
import { formatIso, parseIso } from '@ego/local/dates'
import { useHealth } from '../../lib/health/context'
import { useLedger } from '../../lib/ledger'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { Ring } from '../habits/Ring'
import { Button } from '../ui/button'
import { ConfirmDialog, Sheet } from '../ui/dialog'
import { SegmentedControl } from '../ui/segmented-control'
import { Spinner } from '../ui/spinner'

export function sinceLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`
  return parseIso(iso.slice(0, 10)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function HealthMessage({ Icon = HeartPulse, title, detail, action, onAction, busy = false }: {
  Icon?: LucideIcon
  title: string
  detail: string
  action?: string
  onAction?: () => void
  busy?: boolean
}): React.ReactElement {
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color={color.textMuted} size={30} /></div>
    <h2 className="mt-4 text-[20px] font-semibold">{title}</h2>
    <p className="mt-2 max-w-md text-[16px] leading-6 text-muted-foreground">{detail}</p>
    {action && onAction && <Button size="lg" disabled={busy} onClick={onAction} className="mt-6 w-full max-w-sm">
      {busy && <Spinner color={color.screen} size={18} />}
      {action}
    </Button>}
  </div>
}

/** Stands in for a Health screen until the computer is signed in and Google Health is connected. */
export function HealthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const health = useHealth()
  const navigate = useNavigate()
  if (!ledger.enabled) {
    return <HealthMessage
      title="Sign in to see your health data"
      detail="Sign in once with Google on Home. Ego then reads your Fitbit data from Google Health."
      action="Go to sign in"
      onAction={() => navigate('/')}
    />
  }
  if (ledger.error) return <HealthMessage Icon={TriangleAlert} title="This computer cannot open its database" detail={ledger.error} />
  if (!health.loaded) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>
  if (health.connection?.connected) return <>{children}</>
  if (health.refreshing) {
    return <div className="flex flex-1 flex-col items-center justify-center px-8">
      <Spinner />
      <p className="mt-4 text-center text-[15px] text-muted-foreground">Checking Google Health</p>
    </div>
  }
  if (!health.connection && health.error) {
    return <HealthMessage
      Icon={TriangleAlert}
      title="Waiting for a connection"
      detail={`${health.error.message}. The first download needs the internet. After that, Health opens offline.`}
      action="Try again"
      onAction={() => void health.refresh(false)}
    />
  }
  const ended = health.connection?.lastError
  return <HealthMessage
    title={ended ? 'Connect Google Health again' : 'Connect Google Health'}
    detail={ended
      ? `${ended} Your synced history stays on the server.`
      : 'Ego reads steps, sleep, heart rate, HRV, calories, distance, zone minutes, and weight from your Fitbit through Google Health. The server copies a year of history into D1 and keeps it current every 15 minutes.'}
    action={health.connecting ? 'Opening Google...' : 'Connect Google Health'}
    busy={health.connecting}
    onAction={() => void health.connect()}
  />
}

/** One line under the day picker: how fresh the copy is, and the band's own last sync. */
export function SyncStatus(): React.ReactElement | null {
  const health = useHealth()
  const connection = health.connection
  if (health.error) {
    return <button
      type="button"
      title="Dismisses this message"
      onClick={health.dismissError}
      className="flex w-full items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-left hover:bg-red-500/15"
    >
      <span className="flex-1 text-[14px] leading-5 text-red-300">{health.error.message}</span>
      <X color="#fca5a5" size={16} />
    </button>
  }
  if (connection?.lastError) {
    return <div className="flex items-center gap-2 rounded-2xl bg-attention/10 px-4 py-3">
      <TriangleAlert color={color.attention} size={16} />
      <span className="flex-1 text-[14px] leading-5 text-attention">{connection.lastError}</span>
    </div>
  }
  const parts = [
    health.downloadingHistory && connection?.historyFrom
      ? `Downloading history, back to ${formatIso(connection.historyFrom)}`
      : health.refreshing ? 'Syncing' : `Synced ${sinceLabel(connection?.lastSyncAt ?? null)}`,
    connection?.device
      ? `${connection.device.name}${connection.device.batteryLevel !== null ? ` ${connection.device.batteryLevel}%` : ''}, synced ${sinceLabel(connection.device.lastSyncAt)}`
      : null
  ].filter((part): part is string => part !== null)
  return <div className="flex items-center justify-center gap-2 px-2">
    {health.refreshing ? <Spinner size={14} color={color.textMuted} /> : <RefreshCw color={color.textFaint} size={13} />}
    <span className="text-center text-[13px] text-muted-foreground">{parts.join(' · ')}</span>
  </div>
}

const LEVEL_TEXT: Record<Readiness['level'], { label: string; advice: string }> = {
  high: { label: 'High', advice: 'Recovered. A good day for a hard session.' },
  moderate: { label: 'Moderate', advice: 'About your usual. Train as planned.' },
  low: { label: 'Low', advice: 'Recovery looks short. Keep today light.' }
}

export function readinessLabel(readiness: Readiness): string {
  return LEVEL_TEXT[readiness.level].label
}

export function partLine(part: ReadinessPart): { label: string; value: string; detail: string } {
  if (part.key === 'sleep') {
    const gap = Math.round(part.value - part.baseline)
    return {
      label: 'Sleep',
      value: formatSleepMinutes(part.value),
      detail: gap === 0 ? 'right on 7h 30m' : `${formatSleepMinutes(Math.abs(gap))} ${gap > 0 ? 'over' : 'under'} 7h 30m`
    }
  }
  const unit = part.key === 'hrv' ? 'ms' : 'bpm'
  const gap = Math.round(part.value - part.baseline)
  return {
    label: part.key === 'hrv' ? 'HRV' : 'Resting heart rate',
    value: `${Math.round(part.value)} ${unit}`,
    detail: gap === 0 ? 'same as your 30-day average' : `${Math.abs(gap)} ${gap > 0 ? 'above' : 'below'} your 30-day average`
  }
}

/** On a wide window the inputs sit beside the score instead of under it. */
export function ReadinessCard({ readiness, onPress }: { readiness: Readiness | null; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    title="Opens readiness over time"
    onClick={onPress}
    className="block w-full rounded-3xl border border-border bg-card p-5 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
  >
    <div className="flex items-center">
      <span className="flex-1 text-[15px] font-semibold text-muted-foreground">Readiness</span>
      <span className="text-[13px] text-surface-500">Ego's estimate</span>
      <ChevronRight color={color.textFaint} size={18} />
    </div>
    {readiness
      ? <div className="lg:flex lg:items-center">
        <div className="mt-3 flex items-center lg:w-[45%]">
          <div className="relative flex h-[108px] w-[108px] shrink-0 items-center justify-center">
            <Ring size={108} stroke={8} share={readiness.score / 100} track={color.line} fill={color.text} />
            <span className="text-[40px] font-bold tracking-tight">{readiness.score}</span>
          </div>
          <div className="ml-5 flex-1">
            <p className="text-[22px] font-bold">{LEVEL_TEXT[readiness.level].label}</p>
            <p className="mt-1 text-[14px] leading-5 text-muted-foreground">{LEVEL_TEXT[readiness.level].advice}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-surface-800 pt-3 lg:ml-6 lg:mt-3 lg:flex-1 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          {readiness.parts.map((part) => {
            const line = partLine(part)
            return <div key={part.key} className="flex items-baseline">
              <span className="w-[46%] shrink-0 text-[14px] text-muted-foreground lg:w-[38%]">{line.label}</span>
              <span className="tabular text-[14px] font-semibold">{line.value}</span>
              <span className="ml-2 min-w-0 flex-1 truncate text-right text-[12px] text-surface-500">{line.detail}</span>
            </div>
          })}
        </div>
      </div>
      : <p className="mt-3 text-[15px] leading-6 text-muted-foreground">Ego needs a week of HRV or resting heart rate, plus a reading for this day, to score it.</p>}
  </button>
}

export function MetricTile({ Icon, label, value, unit, detail, progress, onPress }: {
  Icon: LucideIcon
  label: string
  value: string | null
  unit?: string
  detail?: string
  /** Share of a goal, drawn as a ring beside the icon. */
  progress?: number
  onPress: () => void
}): React.ReactElement {
  return <button
    type="button"
    aria-label={`${label}, ${value === null ? 'no data' : `${value}${unit ? ` ${unit}` : ''}`}${detail ? `, ${detail}` : ''}`}
    onClick={onPress}
    className="flex min-h-[120px] min-w-0 flex-col rounded-3xl border border-border bg-card p-4 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
  >
    <div className="flex w-full items-center">
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
        {progress !== undefined && <Ring size={36} stroke={3} share={progress} track={color.line} fill={color.text} />}
        <Icon color={color.textSecondary} size={17} />
      </div>
      <span className="ml-2 min-w-0 flex-1 truncate text-[14px] font-medium text-muted-foreground">{label}</span>
    </div>
    <div className="mt-3 flex min-w-0 items-baseline">
      <span className={cn('truncate text-[26px] font-bold tracking-tight', value === null && 'text-surface-600')}>
        {value ?? 'No data'}
      </span>
      {value !== null && unit && <span className="ml-1 shrink-0 text-[14px] text-muted-foreground">{unit}</span>}
    </div>
    {detail && <span className="mt-0.5 line-clamp-2 text-[13px] leading-[18px] text-surface-400">{detail}</span>}
  </button>
}

const UNIT_OPTIONS = [
  { value: 'imperial', label: 'Miles, pounds' },
  { value: 'metric', label: 'Kilometers, kilograms' }
] as const

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return <div className="flex min-h-12 items-center border-t border-surface-800 py-2">
    <span className="text-[15px] text-muted-foreground">{label}</span>
    <span className="ml-3 line-clamp-2 flex-1 text-right text-[15px]">{value}</span>
  </div>
}

export function HealthSettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement {
  const health = useHealth()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const connection = health.connection
  const missing = connection?.connected
    ? [
      !connection.grants.activity && 'activity',
      !connection.grants.body && 'heart rate and weight',
      !connection.grants.sleep && 'sleep'
    ].filter((item): item is string => typeof item === 'string')
    : []

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    const done = await health.disconnect()
    setBusy(false)
    if (done) {
      setConfirming(false)
      onClose()
    }
  }

  return <>
    <Sheet visible={visible} title="Health settings" onClose={onClose} dismissOnBackdrop>
      <p className="mb-2 text-[15px] font-medium text-surface-200">Units</p>
      <SegmentedControl
        options={UNIT_OPTIONS}
        value={health.units}
        onValueChange={(value: HealthUnits) => health.setUnits(value)}
      />
      <p className="mb-1 mt-6 text-[15px] font-medium text-surface-200">Google Health</p>
      <Row label="Status" value={connection?.connected ? 'Connected' : 'Not connected'} />
      {connection?.accountLabel && <Row label="Account" value={connection.accountLabel} />}
      {connection?.device && <Row
        label={connection.device.name}
        value={`${connection.device.batteryLevel !== null ? `${connection.device.batteryLevel}% battery, ` : ''}synced ${sinceLabel(connection.device.lastSyncAt)}`}
      />}
      <Row label="Server sync" value={`${sinceLabel(connection?.lastSyncAt ?? null)}, every 15 minutes`} />
      {connection?.historyFrom && <Row
        label="History"
        value={`From ${formatIso(connection.historyFrom)}${connection.historyComplete ? '' : ', still downloading'}`}
      />}
      {missing.length > 0 && <p className="mt-3 text-[14px] leading-5 text-attention">
        {`Google did not grant ${missing.join(', ')}. Connect again and tick every box to add ${missing.length === 1 ? 'it' : 'them'}.`}
      </p>}
      <Button variant="outline" size="lg" disabled={health.connecting} onClick={() => void health.connect()} className="mt-5 w-full">
        {connection?.connected ? 'Connect again' : 'Connect Google Health'}
      </Button>
      {connection?.connected && <Button variant="ghost" onClick={() => setConfirming(true)} className="mt-2 w-full text-destructive">
        Disconnect
      </Button>}
    </Sheet>
    <ConfirmDialog
      visible={confirming}
      title="Disconnect Google Health?"
      detail="The server stops syncing and gives up its access. Days already in D1 stay, and connecting again picks up where it left off."
      confirmLabel="Disconnect"
      destructive busy={busy}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void disconnect()}
    />
  </>
}
