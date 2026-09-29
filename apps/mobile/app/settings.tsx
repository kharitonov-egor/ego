import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, Switch, View } from 'react-native'
import {
  AlarmClock, BellRing, Check, ChevronRight, CircleUserRound, Download, EyeOff, Info, KeyRound, Landmark, ListPlus, LogOut, RefreshCw, Trash2, X,
  type LucideIcon
} from 'lucide-react-native'
import { formatSetDuration } from '@ego/core'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import type { ServiceStatus, SessionInfo } from '@ego/api-contracts'
import type { ListShortcut, TrelloBoardSummary, TrelloListSummary } from '@ego/core'
import { isSignedIn, useSettings, type RetiredCredentials } from '../lib/settings'
import type { EgoApi } from '../lib/api-client'
import {
  canInstallBuilds, installBuild, installedBuildNumber, newerBuild, useInstallState, useLatestBuild
} from '../lib/app-build'
import { dateTimeLabel } from '../lib/diary/format'
import { useBlur, useBlurText } from '../lib/blur'
import { syncLabel, useLedger } from '../lib/ledger-context'
import { clearLegacySnapshot } from '../lib/retired'
import { REST_PRESETS, useRestTimer } from '../lib/rest-timer'
import { SignInPanel, useGoogleSignIn } from '../components/SignInPanel'
import { useReminder } from '../lib/reminder-context'
import { REMINDER_HOURS, hourLabel } from '../lib/reminders'
import { Chips, ConfirmDialog, MoneyIcon, money } from '../components/money/Common'
import { tabular } from '../components/money/tokens'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Text } from '../components/ui/text'

const SERVICES: Array<{ key: keyof ServiceStatus; label: string; secret: string }> = [
  { key: 'assistant', label: 'AI', secret: 'OPENROUTER_API_KEY' },
  { key: 'trello', label: 'Trello', secret: 'TRELLO_API_KEY and TRELLO_TOKEN' },
  { key: 'voice', label: 'Talk to AI voice', secret: 'OPENAI_API_KEY' },
  { key: 'google', label: 'Gmail and Drive', secret: 'Connect from the desktop app' },
  { key: 'canvas', label: 'Canvas calendar', secret: 'CANVAS_CALENDAR_URL' },
  { key: 'googleHealth', label: 'Google Health', secret: 'Connect from the Health app' }
]

const HOUR_VALUES = REMINDER_HOURS.map(String)
const HOUR_LABELS = Object.fromEntries(REMINDER_HOURS.map((hour) => [String(hour), hourLabel(hour)]))
const REST_VALUES = REST_PRESETS.map(String)
const REST_LABELS = Object.fromEntries(REST_PRESETS.map((seconds) => [String(seconds), formatSetDuration(seconds)]))

function retiredLabels(retired: RetiredCredentials): string[] {
  return [
    retired.d1ApiToken || retired.cloudflareAccountId ? 'Cloudflare D1 token' : null,
    retired.openRouterApiKey ? 'OpenRouter key' : null,
    retired.trelloApiKey || retired.trelloToken ? 'Trello key and token' : null
  ].filter((label): label is string => label !== null)
}

function Section({ Icon, title, tone = '#fafafa', right, children }: {
  Icon: LucideIcon
  title: string
  tone?: string
  right?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return <Card className="p-5">
    <View className="flex-row items-center">
      <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-800"><Icon color={tone} size={19} /></View>
      <Text accessibilityRole="header" className="ml-3 flex-1 text-[18px] font-semibold">{title}</Text>
      {right}
    </View>
    {children}
  </Card>
}

function FieldLabel({ children }: { children: string }): React.ReactElement {
  return <Text className="mb-2 mt-4 text-[15px] font-medium text-surface-200">{children}</Text>
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    className={`min-h-12 flex-1 flex-row items-center justify-between rounded-xl border px-4 ${active ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
  >
    <Text numberOfLines={1} className={`flex-1 text-[16px] ${active ? 'font-semibold text-primary-foreground' : 'text-foreground'}`}>{label}</Text>
    {active && <Check color="#0a0a0a" size={18} />}
  </Pressable>
}

function NewBuild({ api }: { api: EgoApi }): React.ReactElement | null {
  const { status, error } = useLatestBuild(api)
  const install = useInstallState()
  const offered = newerBuild(status?.latest ?? null, installedBuildNumber())
  const note = (text: string): React.ReactElement => <Text className="mt-4 text-[15px] leading-5 text-muted-foreground">{text}</Text>
  if (error) return note(`Could not check for a new build. ${error}`)
  if (!status) return null
  if (!status.webhookReady) return note('The Worker hears about new builds once EAS_WEBHOOK_SECRET is set.')
  if (!offered) return note(status.latest ? 'This is the newest preview build.' : 'No preview build reported yet.')
  const downloading = install.step === 'downloading' && install.buildNumber === offered.buildNumber ? install : null
  const failed = install.step === 'failed' && install.buildNumber === offered.buildNumber ? install.message : null
  return <View className="mt-4 rounded-2xl bg-surface-900 p-4">
    <Text className="text-[17px] font-semibold">Build {offered.buildNumber} is ready</Text>
    <Text className="mt-0.5 text-[14px] text-muted-foreground">Version {offered.appVersion}, built {dateTimeLabel(offered.completedAt)}</Text>
    {offered.title && <Text numberOfLines={3} className="mt-2 text-[15px] leading-5 text-surface-200">{offered.title}</Text>}
    <Button size="lg" accessibilityState={{ busy: downloading !== null }} onPress={() => void installBuild(offered)} className="mt-4">
      {downloading ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Download color="#0a0a0a" size={18} />}
      <Text>{downloading
        ? `Downloading${downloading.percent === null ? '...' : ` ${downloading.percent}%`}`
        : `Install build ${offered.buildNumber}`}</Text>
    </Button>
    {failed && <Text className="mt-3 text-[15px] leading-5 text-destructive">{failed}</Text>}
    <Text className="mt-3 text-[14px] leading-5 text-muted-foreground">Android asks you to confirm, then replaces Ego and keeps its data. Tap Open when it finishes.</Text>
  </View>
}

export default function Settings(): React.ReactElement {
  const { settings, update } = useSettings()
  const reminder = useReminder()
  const rest = useRestTimer()
  const privacy = useBlur()
  const blur = useBlurText()
  const google = useGoogleSignIn()
  const ledger = useLedger()
  const balances = new Map(ledger.balances.map((item) => [item.accountId, item.balanceCents]))
  const openAccounts = (ledger.reference?.accounts ?? [])
    .filter((account) => !account.archivedAt)
    .map((account) => ({ ...account, balanceCents: balances.get(account.id) ?? account.openingBalanceCents }))
  const router = useRouter()
  const signedIn = isSignedIn(settings)
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)
  const [boards, setBoards] = useState<TrelloBoardSummary[]>([])
  const [lists, setLists] = useState<TrelloListSummary[]>([])
  const [loadingTrello, setLoadingTrello] = useState(false)
  const [trelloError, setTrelloError] = useState<string | null>(null)
  const commitHash = typeof Constants.expoConfig?.extra?.commitHash === 'string'
    ? Constants.expoConfig.extra.commitHash.slice(0, 8)
    : 'unknown'
  const { api } = ledger
  const trelloAvailable = session?.services.trello === true
  const pendingCount = (ledger.status?.pendingCount ?? 0) + (ledger.status?.conflictCount ?? 0)
  const retired = settings.retired ? retiredLabels(settings.retired) : []

  useEffect(() => {
    if (!signedIn) {
      setSession(null)
      return
    }
    let cancelled = false
    void api.session().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSession(result.data)
        setSessionError(null)
      } else {
        setSessionError(result.error.code === 'AUTH_REQUIRED'
          ? 'The server no longer accepts this device. Sign in again.'
          : result.error.message)
      }
    })
    return () => { cancelled = true }
  }, [api, signedIn])

  useEffect(() => {
    if (!trelloAvailable) return
    let cancelled = false
    setLoadingTrello(true)
    void api.trelloBoards().then((result) => {
      if (cancelled) return
      setLoadingTrello(false)
      if (result.ok) {
        setBoards(result.data)
        setTrelloError(null)
      } else setTrelloError(result.error.message)
    })
    return () => { cancelled = true }
  }, [api, trelloAvailable])

  useEffect(() => {
    if (!trelloAvailable || !settings.trelloBoardId) {
      setLists([])
      return
    }
    let cancelled = false
    void api.trelloLists(settings.trelloBoardId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setLists(result.data)
        setTrelloError(null)
      } else setTrelloError(result.error.message)
    })
    return () => { cancelled = true }
  }, [api, settings.trelloBoardId, trelloAvailable])

  const pinned = useMemo(() => new Set(settings.listShortcuts.map((item) => item.listId)), [settings.listShortcuts])

  const signOut = async (): Promise<void> => {
    setConfirmingSignOut(false)
    await api.signOut()
    await update({ deviceToken: '', account: null })
    setSession(null)
    router.dismissTo('/')
  }

  const removeRetired = async (): Promise<void> => {
    if (settings.retired) await clearLegacySnapshot(settings.retired)
    await update({ retired: null })
  }

  const toggleShortcut = (list: TrelloListSummary): void => {
    const next: ListShortcut[] = pinned.has(list.id)
      ? settings.listShortcuts.filter((item) => item.listId !== list.id)
      : [...settings.listShortcuts, { listId: list.id, listName: list.name }]
    void update({ listShortcuts: next })
  }

  const email = session?.email ?? settings.account?.email ?? null
  const device = session?.deviceName ?? settings.account?.deviceName ?? null

  return (
    <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Section Icon={CircleUserRound} title="Account">
        {signedIn
          ? <>
            <Text className="mt-3 text-[17px]">{email ? `Signed in as ${email}` : 'Connected with a device token'}</Text>
            {device && <Text className="mt-0.5 text-[15px] text-muted-foreground">This device: {device}</Text>}
            {sessionError && <Text className="mt-2 text-[15px] leading-5 text-attention">{sessionError}</Text>}
            <Text className="mt-1 text-[15px] leading-5 text-muted-foreground">This one sign-in covers Finance and Gym.</Text>
            {(sessionError || !email) && <Button size="lg" disabled={google.signingIn} onPress={() => void google.signIn()} className="mt-4">
              <Text>{google.signingIn ? 'Opening Google...' : 'Sign in with Google'}</Text>
            </Button>}
            {google.error && <Text className="mt-3 text-[15px] leading-5 text-destructive">{google.error}</Text>}
            <Button variant="outline" size="lg" onPress={() => setConfirmingSignOut(true)} className="mt-4">
              <LogOut color="#d4d4d4" size={18} />
              <Text>Sign out</Text>
            </Button>
          </>
          : <View className="mt-3"><SignInPanel /></View>}
      </Section>

      <Section Icon={EyeOff} title="Blur personal data" right={<Switch
        accessibilityLabel="Blur personal data"
        value={privacy.blurred}
        onValueChange={privacy.setBlurred}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={privacy.blurred ? '#0a0a0a' : '#d4d4d4'}
        ios_backgroundColor="#404040"
      />}>
        <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">
          {privacy.blurred
            ? 'Amounts in Finance, moods and their notes, habits, and Canvas assignments are blurred. Mood entries can be edited again once this is off.'
            : 'Blurs amounts in Finance, moods and their notes, habits, and Canvas assignments, for showing the app to someone.'}
        </Text>
      </Section>

      <Section
        Icon={BellRing}
        title="Daily reminder"
        right={<Switch
          accessibilityLabel="Daily reminder"
          value={reminder.preference.enabled}
          disabled={!reminder.available}
          onValueChange={(value) => void reminder.setEnabled(value)}
          trackColor={{ false: '#404040', true: '#fafafa' }}
          thumbColor={reminder.preference.enabled ? '#0a0a0a' : '#d4d4d4'}
          ios_backgroundColor="#404040"
        />}
      >
        <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">
          {reminder.available
            ? `A nudge at ${hourLabel(reminder.preference.hour)} on days with nothing logged. It stays quiet once you add anything that day.`
            : 'Comes with the next app build. This build has no notification support yet.'}
        </Text>
        {reminder.blocked && <View className="mt-3 rounded-2xl bg-attention/15 p-4">
          <Text className="text-[15px] leading-5 text-attention">Notifications are off for Ego. Turn them on in system settings, then try again.</Text>
          <Button variant="secondary" size="sm" onPress={() => void Linking.openSettings()} className="mt-3 self-start"><Text>Open system settings</Text></Button>
        </View>}
        {reminder.available && reminder.preference.enabled && <>
          <FieldLabel>Time</FieldLabel>
          <Chips values={HOUR_VALUES} value={String(reminder.preference.hour)} labels={HOUR_LABELS} onChange={(value) => reminder.setHour(Number(value))} />
        </>}
      </Section>

      <Section Icon={AlarmClock} title="Gym rest timer" right={<Switch
        accessibilityLabel="Start the rest timer after each set"
        value={rest.preference.autoStart}
        onValueChange={rest.setAutoStart}
        trackColor={{ false: '#404040', true: '#fafafa' }}
        thumbColor={rest.preference.autoStart ? '#0a0a0a' : '#d4d4d4'}
        ios_backgroundColor="#404040"
      />}>
        <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">
          {rest.preference.autoStart
            ? `Starts a ${formatSetDuration(rest.preference.seconds)} countdown each time you save a new set, and buzzes when it ends.`
            : 'Start the countdown yourself from the alarm clock on an exercise.'}
        </Text>
        <FieldLabel>Length</FieldLabel>
        <Chips values={REST_VALUES} value={String(rest.preference.seconds)} labels={REST_LABELS} onChange={(value) => rest.setSeconds(Number(value))} />
      </Section>

      {signedIn && ledger.reference && <Section Icon={Landmark} title="Accounts">
        <View className="mt-3">{openAccounts.map((account) => <View key={account.id} className="min-h-14 flex-row items-center border-t border-surface-800 py-2">
          <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: account.color }}><MoneyIcon name={account.icon} size={17} /></View>
          <Text numberOfLines={1} className="ml-3 flex-1 text-[16px]">{account.name}</Text>
          <Text className="text-[16px] font-semibold" style={[tabular, blur()]}>{money(account.balanceCents)}</Text>
        </View>)}</View>
        {openAccounts.length === 0 && <Text className="mt-2 text-[15px] text-muted-foreground">No accounts yet.</Text>}
        <Button variant="outline" size="lg" onPress={() => router.push('/(money)/accounts')} className="mt-3">
          <Text>Manage accounts</Text>
          <ChevronRight color="#fafafa" size={18} />
        </Button>
      </Section>}

      {signedIn && <Section Icon={RefreshCw} title="Sync">
        <Text className="mt-3 text-[17px]">{ledger.syncing ? 'Syncing...' : syncLabel(ledger.status)}</Text>
        {ledger.status?.message && ledger.status.state !== 'synced' && <Text className="mt-1 text-[15px] leading-5 text-muted-foreground">{ledger.status.message}</Text>}
        <Text className="mt-1 text-[15px] leading-6 text-muted-foreground">Changes save on this phone first and reach the server when it is reachable.</Text>
        <Button variant="outline" size="lg" disabled={ledger.syncing} onPress={() => void ledger.sync()} className="mt-4"><Text>Sync now</Text></Button>
      </Section>}

      {signedIn && session && <Section Icon={KeyRound} title="Server keys">
        <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">The Worker keeps these as secrets and calls each service for this phone. Add a missing one with npx wrangler secret put.</Text>
        <View className="mt-2">{SERVICES.map((service) => {
          const ready = session.services[service.key]
          return <View key={service.key} className="min-h-14 flex-row items-center border-t border-surface-800 py-2">
            <View className={`h-8 w-8 items-center justify-center rounded-full ${ready ? 'bg-positive/15' : 'bg-surface-800'}`}>
              {ready ? <Check color="#34d399" size={17} /> : <X color="#a3a3a3" size={17} />}
            </View>
            <View className="ml-3 flex-1">
              <Text className="text-[16px]">{service.label}</Text>
              {!ready && <Text className="text-[14px] text-muted-foreground">{service.secret}</Text>}
            </View>
            <Text className={`text-[14px] font-medium ${ready ? 'text-positive' : 'text-surface-500'}`}>{ready ? 'Ready' : 'Not set up'}</Text>
          </View>
        })}</View>
      </Section>}

      {signedIn && trelloAvailable && <Section Icon={ListPlus} title="Trello" right={loadingTrello ? <ActivityIndicator size="small" color="#fafafa" /> : undefined}>
        <FieldLabel>Board</FieldLabel>
        <View className="gap-2">
          {boards.map((board) => <Choice
            key={board.id}
            label={board.name}
            active={board.id === settings.trelloBoardId}
            onPress={() => void update({ trelloBoardId: board.id, trelloListId: '', listShortcuts: [] })}
          />)}
          {!loadingTrello && boards.length === 0 && <Text className="text-[15px] text-muted-foreground">No boards found for this Trello account.</Text>}
        </View>
        {settings.trelloBoardId !== '' && <>
          <FieldLabel>Default list</FieldLabel>
          <View className="gap-2">
            {lists.map((list) => <View key={list.id} className="flex-row items-center gap-2">
              <Choice label={list.name} active={list.id === settings.trelloListId} onPress={() => void update({ trelloListId: list.id })} />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pinned.has(list.id) }}
                accessibilityLabel={`Pin ${list.name} to the capture screen`}
                onPress={() => toggleShortcut(list)}
                className={`min-h-12 min-w-16 items-center justify-center rounded-xl border px-3 ${pinned.has(list.id) ? 'border-primary bg-primary' : 'border-input bg-surface-900 active:bg-surface-800'}`}
              ><Text className={`text-[15px] font-medium ${pinned.has(list.id) ? 'text-primary-foreground' : 'text-muted-foreground'}`}>Pin</Text></Pressable>
            </View>)}
          </View>
          <Text className="mt-3 text-[15px] leading-5 text-muted-foreground">Pinned lists show as buttons on the capture screen.</Text>
        </>}
        {trelloError && <Text className="mt-3 text-[15px] leading-5 text-destructive">{trelloError}</Text>}
        <Button size="lg" disabled={!settings.trelloListId} onPress={() => router.push('/capture')} className="mt-4">
          <Text>{settings.trelloListId ? 'Add Trello card' : 'Choose a default list first'}</Text>
        </Button>
      </Section>}

      {retired.length > 0 && <Section Icon={Trash2} tone="#fbbf24" title="Old keys on this phone">
        <Text className="mt-3 text-[15px] leading-6 text-muted-foreground">{retired.join(', ')}. Ego no longer reads these. Copy any you still need into Worker secrets, then remove them from this phone.</Text>
        <Button variant="outline" size="lg" onPress={() => void removeRetired()} className="mt-4 border-destructive/40">
          <Text className="text-destructive">Remove from this phone</Text>
        </Button>
      </Section>}

      <Section Icon={Info} title="About">
        <View className="mt-4 flex-row items-center justify-between">
          <Text className="text-[15px] text-muted-foreground">Version</Text>
          <Text className="font-mono text-[15px]">{Constants.expoConfig?.version ?? 'unknown'}</Text>
        </View>
        {canInstallBuilds && <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-[15px] text-muted-foreground">Build</Text>
          <Text className="font-mono text-[15px]">{installedBuildNumber() ?? 'unknown'}</Text>
        </View>}
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-[15px] text-muted-foreground">Commit</Text>
          <Text selectable className="font-mono text-[15px]">{commitHash}</Text>
        </View>
        {canInstallBuilds && signedIn && <NewBuild api={api} />}
      </Section>
      <View className="h-6" />

      <ConfirmDialog
        visible={confirmingSignOut}
        title="Sign out of this phone?"
        detail={pendingCount > 0
          ? `${pendingCount} ${pendingCount === 1 ? 'change has' : 'changes have'} not reached the server. They stay on this phone and sync after you sign in again.`
          : 'The server stops accepting this device. Your ledger copy stays on the phone for the next sign-in.'}
        confirmLabel="Sign out"
        destructive
        hideNavigation={false}
        onCancel={() => setConfirmingSignOut(false)}
        onConfirm={() => void signOut()}
      />
    </ScrollView>
  )
}
