import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import {
  Check, CircleUserRound, Info, KeyRound, ListPlus, LogOut, RefreshCw, Server, Trash2, X
} from 'lucide-react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import type { ServiceStatus, SessionInfo } from '@ego/api-contracts'
import type { ListShortcut, TrelloBoardSummary, TrelloListSummary } from '@ego/core'
import { apiUrlFor, isSignedIn, useSettings, type RetiredCredentials } from '../lib/settings'
import { syncLabel, useLedger } from '../lib/ledger-context'
import { normalizeApiUrl } from '../lib/api-client'
import { beginGoogleSignIn } from '../lib/sign-in'
import { clearLegacySnapshot } from '../lib/retired'
import { ConfirmDialog } from '../components/money/Common'
import { TOUCH } from '../components/money/tokens'

const CARD = 'mt-3 rounded-2xl border border-surface-800 bg-surface-900/60 p-4'
const inputClass = 'min-h-11 rounded-lg border border-surface-700 bg-surface-950 px-3 py-2.5 text-[16px] text-surface-100'

const SERVICES: Array<{ key: keyof ServiceStatus; label: string; secret: string }> = [
  { key: 'moneyAgent', label: 'Money agent', secret: 'OPENROUTER_API_KEY' },
  { key: 'trello', label: 'Trello', secret: 'TRELLO_API_KEY and TRELLO_TOKEN' },
  { key: 'voice', label: 'Talk to AI voice', secret: 'OPENAI_API_KEY' },
  { key: 'google', label: 'Gmail and Drive', secret: 'Connect from the desktop app' }
]

function retiredLabels(retired: RetiredCredentials): string[] {
  return [
    retired.d1ApiToken || retired.cloudflareAccountId ? 'Cloudflare D1 token' : null,
    retired.openRouterApiKey ? 'OpenRouter key' : null,
    retired.trelloApiKey || retired.trelloToken ? 'Trello key and token' : null
  ].filter((label): label is string => label !== null)
}

function Heading({ icon, title }: { icon: React.ReactNode; title: string }): React.ReactElement {
  return <View className="flex-row items-center">{icon}<Text className="ml-2 text-[16px] font-bold text-surface-100">{title}</Text></View>
}

function Choice({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={{ minHeight: TOUCH }}
    className={`flex-1 justify-center rounded-lg border px-3 ${active ? 'border-accent-500/40 bg-accent-500/15' : 'border-surface-800 bg-surface-950'}`}
  ><Text className={`text-[16px] font-medium ${active ? 'text-accent-400' : 'text-surface-100'}`}>{label}</Text></Pressable>
}

export default function Settings(): React.ReactElement {
  const { settings, update } = useSettings()
  const ledger = useLedger()
  const router = useRouter()
  const signedIn = isSignedIn(settings)
  const buildApiUrl = apiUrlFor({ apiUrl: '' })
  const [serverDraft, setServerDraft] = useState(apiUrlFor(settings))
  const [editingServer, setEditingServer] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [enteringToken, setEnteringToken] = useState(false)
  const [tokenDraft, setTokenDraft] = useState('')
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
    setServerDraft(apiUrlFor(settings))
  }, [settings])

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

  const signIn = async (): Promise<void> => {
    const server = normalizeApiUrl(serverDraft)
    if (!/^https:\/\//.test(server)) {
      setSignInError('Enter the Worker address, starting with https://')
      setEditingServer(true)
      return
    }
    setSigningIn(true)
    setSignInError(null)
    if (server !== apiUrlFor(settings)) await update({ apiUrl: server })
    const problem = await beginGoogleSignIn(server)
    setSigningIn(false)
    if (problem) setSignInError(problem)
  }

  const useDeviceToken = async (): Promise<void> => {
    const server = normalizeApiUrl(serverDraft)
    if (!/^https:\/\//.test(server) || tokenDraft.trim().length < 32) {
      setSignInError('Enter the Worker address and the full token from ego-device enroll.')
      setEditingServer(true)
      return
    }
    setSignInError(null)
    await update({ apiUrl: server, deviceToken: tokenDraft.trim(), account: null })
    setTokenDraft('')
    setEnteringToken(false)
  }

  const signOut = async (): Promise<void> => {
    setConfirmingSignOut(false)
    await api.signOut()
    await update({ deviceToken: '', account: null })
    setSession(null)
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
    <ScrollView className="flex-1 bg-surface-950 px-4" keyboardShouldPersistTaps="handled">
      <View className={CARD}>
        <Heading icon={<CircleUserRound color="#fafafa" size={17} />} title="Account" />
        {signedIn
          ? <>
            <Text className="mt-2 text-[16px] text-surface-100">{email ? `Signed in as ${email}` : 'Connected with a device token'}</Text>
            {device && <Text className="mt-0.5 text-[14px] text-surface-400">This device: {device}</Text>}
            {sessionError && <Text className="mt-2 text-[14px] leading-5 text-amber-300">{sessionError}</Text>}
            {(sessionError || !email) && <Pressable accessibilityRole="button" disabled={signingIn} onPress={() => void signIn()} style={{ minHeight: TOUCH }} className="mt-3 flex-row items-center justify-center rounded-xl bg-primary px-4">
              <Text className="text-[16px] font-semibold text-primary-foreground">{signingIn ? 'Opening Google...' : 'Sign in with Google'}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" onPress={() => setConfirmingSignOut(true)} style={{ minHeight: TOUCH }} className="mt-3 flex-row items-center justify-center rounded-xl border border-surface-700 px-4">
              <LogOut color="#d4d4d4" size={16} />
              <Text className="ml-2 text-[16px] font-semibold text-surface-200">Sign out</Text>
            </Pressable>
          </>
          : <>
            <Text className="mt-2 text-[14px] leading-5 text-surface-400">Sign in with the Google account your Ego server allows. The server holds every API key, so there is nothing else to paste here.</Text>
            {buildApiUrl && !editingServer
              ? <Pressable accessibilityRole="button" accessibilityHint="Change the server address" onPress={() => setEditingServer(true)} style={{ minHeight: TOUCH }} className="mt-3 flex-row items-center">
                <Server color="#a3a3a3" size={14} />
                <Text numberOfLines={1} className="ml-2 flex-1 font-mono text-[14px] text-surface-400">{serverDraft}</Text>
                <Text className="text-[14px] font-semibold text-accent-400">Change</Text>
              </Pressable>
              : <View className="mt-3">
                <Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Server address</Text>
                <TextInput value={serverDraft} onChangeText={setServerDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://ego-money.example.workers.dev" placeholderTextColor="#737373" className={inputClass} />
              </View>}
            <Pressable accessibilityRole="button" disabled={signingIn} onPress={() => void signIn()} style={{ minHeight: TOUCH }} className={`mt-3 flex-row items-center justify-center rounded-xl px-4 ${signingIn ? 'bg-surface-800' : 'bg-primary'}`}>
              {signingIn && <ActivityIndicator color="#fff" size="small" />}
              <Text className={`text-[16px] font-semibold ${signingIn ? 'ml-2 text-surface-300' : 'text-primary-foreground'}`}>{signingIn ? 'Opening Google...' : 'Sign in with Google'}</Text>
            </Pressable>
            {enteringToken
              ? <View className="mt-3">
                <Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Device token</Text>
                <TextInput value={tokenDraft} onChangeText={setTokenDraft} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="From ego-device enroll" placeholderTextColor="#737373" className={inputClass} />
                <Pressable accessibilityRole="button" onPress={() => void useDeviceToken()} style={{ minHeight: TOUCH }} className="mt-2 items-center justify-center rounded-xl border border-surface-700 px-4">
                  <Text className="text-[16px] font-semibold text-surface-200">Connect with this token</Text>
                </Pressable>
              </View>
              : <Pressable accessibilityRole="button" onPress={() => setEnteringToken(true)} style={{ minHeight: TOUCH }} className="mt-1 items-center justify-center">
                <Text className="text-[14px] text-surface-400">Use a device token instead</Text>
              </Pressable>}
          </>}
        {signInError && <Text className="mt-2 text-[14px] leading-5 text-red-400">{signInError}</Text>}
      </View>

      {signedIn && <View className={CARD}>
        <Heading icon={<RefreshCw color="#fafafa" size={16} />} title="Sync" />
        <Text className="mt-2 text-[16px] text-surface-100">{ledger.syncing ? 'Syncing...' : syncLabel(ledger.status)}</Text>
        {ledger.status?.message && ledger.status.state !== 'synced' && <Text className="mt-1 text-[14px] leading-5 text-surface-400">{ledger.status.message}</Text>}
        <Text className="mt-1 text-[14px] leading-5 text-surface-400">Changes save on this phone first and reach the server when it is reachable.</Text>
        <Pressable accessibilityRole="button" disabled={ledger.syncing} onPress={() => void ledger.sync()} style={{ minHeight: TOUCH }} className="mt-3 items-center justify-center rounded-xl border border-surface-700 px-4">
          <Text className="text-[16px] font-semibold text-surface-200">Sync now</Text>
        </Pressable>
      </View>}

      {signedIn && session && <View className={CARD}>
        <Heading icon={<KeyRound color="#fafafa" size={16} />} title="Server keys" />
        <Text className="mt-2 text-[14px] leading-5 text-surface-400">The Worker keeps these as secrets and calls each service for this phone. Add a missing one with npx wrangler secret put.</Text>
        {SERVICES.map((service) => {
          const ready = session.services[service.key]
          return <View key={service.key} style={{ minHeight: TOUCH }} className="mt-1 flex-row items-center border-t border-surface-800 pt-2">
            {ready ? <Check color="#34d399" size={16} /> : <X color="#a3a3a3" size={16} />}
            <View className="ml-2.5 flex-1">
              <Text className="text-[16px] text-surface-100">{service.label}</Text>
              {!ready && <Text className="text-[14px] text-surface-400">{service.secret}</Text>}
            </View>
            <Text className={`text-[14px] ${ready ? 'text-emerald-400' : 'text-surface-500'}`}>{ready ? 'Ready' : 'Not set up'}</Text>
          </View>
        })}
      </View>}

      {signedIn && trelloAvailable && <View className={CARD}>
        <View className="flex-row items-center justify-between">
          <Heading icon={<ListPlus color="#fafafa" size={16} />} title="Trello" />
          {loadingTrello && <ActivityIndicator size="small" color="#fafafa" />}
        </View>
        <Text className="mt-3 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Board</Text>
        <View className="mt-1.5 gap-2">
          {boards.map((board) => <Choice
            key={board.id}
            label={board.name}
            active={board.id === settings.trelloBoardId}
            onPress={() => void update({ trelloBoardId: board.id, trelloListId: '', listShortcuts: [] })}
          />)}
          {!loadingTrello && boards.length === 0 && <Text className="text-[14px] text-surface-400">No boards found for this Trello account.</Text>}
        </View>
        {settings.trelloBoardId !== '' && <>
          <Text className="mt-4 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Default list</Text>
          <View className="mt-1.5 gap-2">
            {lists.map((list) => <View key={list.id} className="flex-row items-center gap-2">
              <Choice label={list.name} active={list.id === settings.trelloListId} onPress={() => void update({ trelloListId: list.id })} />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: pinned.has(list.id) }}
                accessibilityLabel={`Pin ${list.name} to the capture screen`}
                onPress={() => toggleShortcut(list)}
                style={{ minHeight: TOUCH, minWidth: 64 }}
                className={`items-center justify-center rounded-lg border px-3 ${pinned.has(list.id) ? 'border-accent-500/40 bg-accent-500/15' : 'border-surface-800 bg-surface-950'}`}
              ><Text className={`text-[14px] ${pinned.has(list.id) ? 'text-accent-400' : 'text-surface-400'}`}>Pin</Text></Pressable>
            </View>)}
          </View>
          <Text className="mt-2 text-[14px] leading-5 text-surface-400">Pinned lists show as buttons on the capture screen.</Text>
        </>}
        {trelloError && <Text className="mt-2 text-[14px] leading-5 text-red-400">{trelloError}</Text>}
        <Pressable accessibilityRole="button" disabled={!settings.trelloListId} onPress={() => router.push('/capture')} style={{ minHeight: TOUCH }} className={`mt-4 items-center justify-center rounded-xl px-4 ${settings.trelloListId ? 'bg-primary' : 'bg-surface-800'}`}>
          <Text className={`text-[16px] font-semibold ${settings.trelloListId ? 'text-primary-foreground' : 'text-surface-400'}`}>{settings.trelloListId ? 'Add Trello card' : 'Choose a default list first'}</Text>
        </Pressable>
      </View>}

      {retired.length > 0 && <View className={CARD}>
        <Heading icon={<Trash2 color="#fbbf24" size={16} />} title="Old keys on this phone" />
        <Text className="mt-2 text-[14px] leading-5 text-surface-400">{retired.join(', ')}. Ego no longer reads these. Copy any you still need into Worker secrets, then remove them from this phone.</Text>
        <Pressable accessibilityRole="button" onPress={() => void removeRetired()} style={{ minHeight: TOUCH }} className="mt-3 items-center justify-center rounded-xl border border-destructive/40 px-4">
          <Text className="text-[16px] font-semibold text-destructive">Remove from this phone</Text>
        </Pressable>
      </View>}

      <View className={CARD}>
        <Heading icon={<Info color="#fafafa" size={16} />} title="About" />
        <View className="mt-3 flex-row items-center justify-between">
          <Text className="text-[14px] text-surface-400">Version</Text>
          <Text className="font-mono text-[14px] text-surface-200">{Constants.expoConfig?.version ?? 'unknown'}</Text>
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-[14px] text-surface-400">Commit</Text>
          <Text selectable className="font-mono text-[14px] text-surface-200">{commitHash}</Text>
        </View>
      </View>
      <View className="h-10" />

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
