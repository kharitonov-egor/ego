import React, { useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight, HeartPulse, RefreshCw, TriangleAlert, X, type LucideIcon } from 'lucide-react-native'
import { formatSleepMinutes, type HealthUnits, type Readiness, type ReadinessPart } from '@ego/core'
import { formatIso, parseIso } from '../../lib/dates'
import { useHealth } from '../../lib/health/context'
import { useLedger } from '../../lib/ledger-context'
import { Ring } from '../habits/Ring'
import { BottomSheet, ConfirmDialog } from '../money/Common'
import { color, tabular } from '../money/tokens'
import { Button } from '../ui/button'
import { Card } from '../ui/card'
import { SegmentedControl } from '../ui/segmented-control'
import { Text } from '../ui/text'

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
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <View className="h-16 w-16 items-center justify-center rounded-full bg-surface-900"><Icon color={color.textMuted} size={30} /></View>
    <Text className="mt-4 text-center text-[20px] font-semibold">{title}</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">{detail}</Text>
    {action && onAction && <Button size="lg" disabled={busy} onPress={onAction} className="mt-6 self-stretch">
      {busy && <ActivityIndicator color={color.screen} size="small" />}
      <Text>{action}</Text>
    </Button>}
  </View>
}

/** Stands in for a Health screen until the phone is signed in and Google Health is connected. */
export function HealthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const health = useHealth()
  const router = useRouter()
  if (!ledger.enabled) {
    return <HealthMessage
      title="Sign in to see your health data"
      detail="Sign in once with Google on the start screen. Ego then reads your Fitbit data from Google Health."
      action="Go to sign in"
      onAction={() => router.dismissTo('/')}
    />
  }
  if (ledger.error) return <HealthMessage Icon={TriangleAlert} title="This phone cannot open its database" detail={ledger.error} />
  if (!health.loaded) return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator color={color.text} /></View>
  if (health.connection?.connected) return <>{children}</>
  if (health.refreshing) {
    return <View className="flex-1 items-center justify-center bg-background px-8">
      <ActivityIndicator color={color.text} />
      <Text className="mt-4 text-center text-[15px] text-muted-foreground">Checking Google Health</Text>
    </View>
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
    return <Pressable
      accessibilityRole="button"
      accessibilityHint="Dismisses this message"
      onPress={health.dismissError}
      className="flex-row items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3"
    >
      <Text className="flex-1 text-[14px] leading-5 text-red-300">{health.error.message}</Text>
      <X color="#fca5a5" size={16} />
    </Pressable>
  }
  if (connection?.lastError) {
    return <View className="flex-row items-center gap-2 rounded-2xl bg-attention/10 px-4 py-3">
      <TriangleAlert color={color.attention} size={16} />
      <Text className="flex-1 text-[14px] leading-5 text-attention">{connection.lastError}</Text>
    </View>
  }
  const parts = [
    health.downloadingHistory && connection?.historyFrom
      ? `Downloading history, back to ${formatIso(connection.historyFrom)}`
      : health.refreshing ? 'Syncing' : `Synced ${sinceLabel(connection?.lastSyncAt ?? null)}`,
    connection?.device
      ? `${connection.device.name}${connection.device.batteryLevel !== null ? ` ${connection.device.batteryLevel}%` : ''}, synced ${sinceLabel(connection.device.lastSyncAt)}`
      : null
  ].filter((part): part is string => part !== null)
  return <View className="flex-row items-center justify-center gap-2 px-2">
    {health.refreshing ? <ActivityIndicator size="small" color={color.textMuted} /> : <RefreshCw color={color.textFaint} size={13} />}
    <Text className="text-center text-[13px] text-muted-foreground">{parts.join(' · ')}</Text>
  </View>
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

export function ReadinessCard({ readiness, onPress }: { readiness: Readiness | null; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" accessibilityHint="Opens readiness over time" onPress={onPress}>
    <Card className="p-5 active:bg-surface-900">
      <View className="flex-row items-center">
        <Text className="flex-1 text-[15px] font-semibold text-muted-foreground">Readiness</Text>
        <Text className="text-[13px] text-surface-500">Ego's estimate</Text>
        <ChevronRight color={color.textFaint} size={18} />
      </View>
      {readiness
        ? <View className="mt-3 flex-row items-center">
          <View className="h-[108px] w-[108px] items-center justify-center">
            <Ring size={108} stroke={8} share={readiness.score / 100} track={color.line} fill={color.text} />
            <Text className="text-[40px] font-bold tracking-tight">{readiness.score}</Text>
          </View>
          <View className="ml-5 flex-1">
            <Text className="text-[22px] font-bold">{LEVEL_TEXT[readiness.level].label}</Text>
            <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">{LEVEL_TEXT[readiness.level].advice}</Text>
          </View>
        </View>
        : <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">Ego needs a week of HRV or resting heart rate, plus a reading for this day, to score it.</Text>}
      {readiness && <View className="mt-4 gap-2 border-t border-surface-800 pt-3">
        {readiness.parts.map((part) => {
          const line = partLine(part)
          return <View key={part.key} className="flex-row items-baseline">
            <Text className="w-[46%] text-[14px] text-muted-foreground">{line.label}</Text>
            <Text className="text-[14px] font-semibold" style={tabular}>{line.value}</Text>
            <Text numberOfLines={1} className="ml-2 flex-1 text-right text-[12px] text-surface-500">{line.detail}</Text>
          </View>
        })}
      </View>}
    </Card>
  </Pressable>
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
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${label}, ${value === null ? 'no data' : `${value}${unit ? ` ${unit}` : ''}`}${detail ? `, ${detail}` : ''}`}
    onPress={onPress}
    className="min-h-[120px] flex-1 rounded-3xl border border-border bg-card p-4 active:bg-surface-900"
  >
    <View className="flex-row items-center">
      <View className="h-9 w-9 items-center justify-center">
        {progress !== undefined && <Ring size={36} stroke={3} share={progress} track={color.line} fill={color.text} />}
        <Icon color={color.textSecondary} size={17} />
      </View>
      <Text numberOfLines={1} className="ml-2 flex-1 text-[14px] font-medium text-muted-foreground">{label}</Text>
    </View>
    <View className="mt-3 flex-row items-baseline">
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className={`text-[26px] font-bold tracking-tight ${value === null ? 'text-surface-600' : ''}`}>
        {value ?? 'No data'}
      </Text>
      {value !== null && unit && <Text className="ml-1 text-[14px] text-muted-foreground">{unit}</Text>}
    </View>
    {detail && <Text numberOfLines={2} className="mt-0.5 text-[13px] leading-[18px] text-surface-400">{detail}</Text>}
  </Pressable>
}

const UNIT_OPTIONS = [
  { value: 'imperial', label: 'Miles, pounds' },
  { value: 'metric', label: 'Kilometers, kilograms' }
] as const

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return <View className="min-h-12 flex-row items-center border-t border-surface-800 py-2">
    <Text className="text-[15px] text-muted-foreground">{label}</Text>
    <Text numberOfLines={2} className="ml-3 flex-1 text-right text-[15px]">{value}</Text>
  </View>
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

  return <BottomSheet visible={visible} title="Health settings" onClose={onClose} dismissOnBackdrop>
    <Text className="mb-2 text-[15px] font-medium text-surface-200">Units</Text>
    <SegmentedControl
      options={UNIT_OPTIONS}
      value={health.units}
      onValueChange={(value: HealthUnits) => health.setUnits(value)}
    />
    <Text className="mb-1 mt-6 text-[15px] font-medium text-surface-200">Google Health</Text>
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
    {missing.length > 0 && <Text className="mt-3 text-[14px] leading-5 text-attention">
      {`Google did not grant ${missing.join(', ')}. Connect again and tick every box to add ${missing.length === 1 ? 'it' : 'them'}.`}
    </Text>}
    <Button variant="outline" size="lg" disabled={health.connecting} onPress={() => void health.connect()} className="mt-5">
      <Text>{connection?.connected ? 'Connect again' : 'Connect Google Health'}</Text>
    </Button>
    {connection?.connected && <Button variant="ghost" onPress={() => setConfirming(true)} className="mt-2">
      <Text className="text-destructive">Disconnect</Text>
    </Button>}
    <ConfirmDialog
      visible={confirming}
      title="Disconnect Google Health?"
      detail="The server stops syncing and gives up its access. Days already in D1 stay, and connecting again picks up where it left off."
      confirmLabel="Disconnect"
      destructive busy={busy} hideNavigation={false}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void disconnect()}
    />
  </BottomSheet>
}
