import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { CloudCog, Database, ListPlus, ScanLine } from 'lucide-react-native'
import { useRouter } from 'expo-router'
import {
  looksLikeTrelloToken,
  type ListShortcut,
  type TrelloBoardSummary,
  type TrelloListSummary
} from '@ego/core'
import { isLedgerConfigured, useSettings } from '../lib/settings'
import { trelloClientFor } from '../lib/trello'
import { moneyClientFor } from '../lib/money'
import { moneyApiFor } from '../lib/api-client'

const inputClass =
  'rounded-lg border border-surface-700 bg-surface-900/50 px-3 py-2.5 text-[16px] text-surface-100'

export default function Settings(): React.ReactElement {
  const { settings, update } = useSettings()
  const router = useRouter()
  const client = useMemo(() => trelloClientFor(settings), [settings])

  const [boards, setBoards] = useState<TrelloBoardSummary[]>([])
  const [lists, setLists] = useState<TrelloListSummary[]>([])
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [loadingLists, setLoadingLists] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState(settings.cloudflareAccountId)
  const [databaseId, setDatabaseId] = useState(settings.d1DatabaseId)
  const [apiToken, setApiToken] = useState(settings.d1ApiToken)
  const [moneyStatus, setMoneyStatus] = useState<string | null>(null)
  const [savingMoney, setSavingMoney] = useState(false)
  const [apiUrl, setApiUrl] = useState(settings.moneyApiUrl)
  const [deviceToken, setDeviceToken] = useState(settings.moneyDeviceToken)
  const [ledgerStatus, setLedgerStatus] = useState<string | null>(null)
  const [savingLedger, setSavingLedger] = useState(false)

  const credsReady = Boolean(settings.trelloApiKey && settings.trelloToken)

  useEffect(() => {
    setAccountId(settings.cloudflareAccountId)
    setDatabaseId(settings.d1DatabaseId)
    setApiToken(settings.d1ApiToken)
  }, [settings.cloudflareAccountId, settings.d1DatabaseId, settings.d1ApiToken])

  useEffect(() => {
    setApiUrl(settings.moneyApiUrl)
    setDeviceToken(settings.moneyDeviceToken)
  }, [settings.moneyApiUrl, settings.moneyDeviceToken])

  useEffect(() => {
    if (!credsReady) {
      setBoards([])
      return
    }
    let cancelled = false
    setLoadingBoards(true)
    void (async () => {
      const result = await client.listBoards()
      if (cancelled) return
      setLoadingBoards(false)
      if (result.ok && result.data) {
        setBoards(result.data)
        setError(null)
      } else {
        setError(result.detail ?? 'Failed to fetch boards')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [credsReady, settings.trelloApiKey, settings.trelloToken, client])

  useEffect(() => {
    if (!credsReady || !settings.trelloBoardId) {
      setLists([])
      return
    }
    let cancelled = false
    setLoadingLists(true)
    void (async () => {
      const result = await client.listLists(settings.trelloBoardId)
      if (cancelled) return
      setLoadingLists(false)
      if (result.ok && result.data) {
        setLists(result.data)
        setError(null)
      } else {
        setError(result.detail ?? 'Failed to fetch lists')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [credsReady, settings.trelloBoardId, client])

  const toggleShortcut = (list: TrelloListSummary): void => {
    const exists = settings.listShortcuts.some((item) => item.listId === list.id)
    const next: ListShortcut[] = exists
      ? settings.listShortcuts.filter((item) => item.listId !== list.id)
      : [...settings.listShortcuts, { listId: list.id, listName: list.name }]
    void update({ listShortcuts: next })
  }

  const tokenLooksWrong = Boolean(settings.trelloToken) && !looksLikeTrelloToken(settings.trelloToken)

  const saveLedger = async (): Promise<void> => {
    setSavingLedger(true)
    setLedgerStatus(null)
    const next = { moneyApiUrl: apiUrl.trim(), moneyDeviceToken: deviceToken.trim() }
    await update(next)
    const result = await moneyApiFor({ url: next.moneyApiUrl, token: next.moneyDeviceToken }).reference()
    setSavingLedger(false)
    setLedgerStatus(result.ok
      ? `Reached the ledger service with ${result.data.accounts.length} accounts`
      : result.error.message)
  }

  const saveMoney = async (): Promise<void> => {
    setSavingMoney(true)
    setMoneyStatus(null)
    const next = { cloudflareAccountId: accountId.trim(), d1DatabaseId: databaseId.trim(), d1ApiToken: apiToken.trim() }
    const result = await moneyClientFor(next).testConnection()
    if (result.ok) {
      await update(next)
      setMoneyStatus('Connected. The money tables are ready.')
    } else {
      setMoneyStatus(result.message)
    }
    setSavingMoney(false)
  }

  return (
    <ScrollView className="flex-1 bg-surface-950 px-3 pt-3" keyboardShouldPersistTaps="handled">
      <Pressable onPress={() => router.push('/capture')} className="mb-3 flex-row items-center justify-center rounded-xl border border-surface-700 bg-surface-900 px-4 py-2.5">
        <ListPlus color="#91c4ff" size={16} />
        <Text className="ml-2 text-[16px] font-semibold text-surface-100">Add Trello card</Text>
      </Pressable>
      <View className="rounded-xl border border-surface-800 bg-surface-900/50 p-3">
        <View className="flex-row items-center"><Database color="#91c4ff" size={15} /><Text className="ml-1.5 text-[16px] font-bold text-surface-100">Cloudflare D1</Text></View>
        <Text className="mt-1.5 text-[14px] leading-5 text-surface-400">The app reads and writes the budget database directly.</Text>
        <View className="mt-3 gap-2.5"><View><Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Account ID</Text><TextInput value={accountId} onChangeText={setAccountId} autoCapitalize="none" autoCorrect={false} placeholder="32-character account ID" placeholderTextColor="#909099" className={inputClass} /></View><View><Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">D1 database ID</Text><TextInput value={databaseId} onChangeText={setDatabaseId} autoCapitalize="none" autoCorrect={false} placeholder="Database UUID" placeholderTextColor="#909099" className={inputClass} /></View><View><Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">D1 API token</Text><TextInput value={apiToken} onChangeText={setApiToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="D1 Read and D1 Write token" placeholderTextColor="#909099" className={inputClass} /></View></View>
        <Pressable disabled={savingMoney || !accountId || !databaseId || !apiToken} onPress={() => void saveMoney()} className={`mt-3 rounded-lg px-3 py-2.5 ${savingMoney || !accountId || !databaseId || !apiToken ? 'bg-surface-800' : 'bg-accent-600'}`}><Text className={`text-center text-[16px] font-semibold ${savingMoney ? 'text-surface-400' : 'text-white'}`}>{savingMoney ? 'Connecting...' : 'Save and connect'}</Text></Pressable>
        {moneyStatus && <Text className={`mt-2 text-[14px] leading-5 ${moneyStatus.startsWith('Connected') ? 'text-emerald-400' : 'text-red-400'}`}>{moneyStatus}</Text>}
      </View>

      <View className="mt-3 rounded-xl border border-surface-800 bg-surface-900/50 p-3">
        <View className="flex-row items-center"><CloudCog color="#91c4ff" size={15} /><Text className="ml-1.5 text-[16px] font-bold text-surface-100">Ledger service</Text></View>
        <Text className="mt-1.5 text-[14px] leading-5 text-surface-400">The Worker owns the database. This device stores its own copy and delivers changes through a device token, not a Cloudflare account token.</Text>
        <View className="mt-3 gap-2.5">
          <View>
            <Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">API address</Text>
            <TextInput value={apiUrl} onChangeText={setApiUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://ego-money.workers.dev" placeholderTextColor="#909099" className={inputClass} />
          </View>
          <View>
            <Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Device token</Text>
            <TextInput value={deviceToken} onChangeText={setDeviceToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="From ego-device enroll" placeholderTextColor="#909099" className={inputClass} />
          </View>
        </View>
        <Pressable accessibilityRole="button" disabled={savingLedger} onPress={() => void saveLedger()} className={`mt-3 rounded-lg px-3 py-2.5 ${savingLedger ? 'bg-surface-800' : 'bg-accent-600'}`}>
          <Text className={`text-center text-[16px] font-semibold ${savingLedger ? 'text-surface-400' : 'text-white'}`}>{savingLedger ? 'Checking...' : 'Save and check'}</Text>
        </Pressable>
        {ledgerStatus && <Text className={`mt-2 text-[14px] leading-5 ${ledgerStatus.startsWith('Reached') ? 'text-emerald-400' : 'text-red-400'}`}>{ledgerStatus}</Text>}
        <View className="mt-3 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[16px] text-surface-100">Read Activity from this device</Text>
            <Text className="mt-0.5 text-[14px] leading-5 text-surface-400">Activity uses the local database and the outbox. Other money screens keep the direct D1 connection.</Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.moneyStorage === 'local' }}
            accessibilityLabel="Read Activity from this device"
            disabled={!isLedgerConfigured(settings)}
            onPress={() => void update({ moneyStorage: settings.moneyStorage === 'local' ? 'legacy' : 'local' })}
            className={`min-h-11 min-w-11 items-center justify-center rounded-full px-3 ${settings.moneyStorage === 'local' ? 'bg-accent-600' : 'bg-surface-800'}`}
          >
            <Text className={`text-[14px] font-semibold ${settings.moneyStorage === 'local' ? 'text-white' : 'text-surface-400'}`}>{settings.moneyStorage === 'local' ? 'On' : 'Off'}</Text>
          </Pressable>
        </View>
      </View>

      <View className="mt-3 rounded-xl border border-surface-800 bg-surface-900/50 p-3">
        <View className="flex-row items-center"><ScanLine color="#91c4ff" size={15} /><Text className="ml-1.5 text-[16px] font-bold text-surface-100">Money agent</Text></View>
        <Text className="mt-1.5 text-[14px] leading-5 text-surface-400">OpenRouter prepares transactions from messages and receipt images. Ego does not save the images.</Text>
        <View className="mt-3 gap-2.5"><View><Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">OpenRouter API key</Text><TextInput value={settings.openRouterApiKey} onChangeText={(value) => void update({ openRouterApiKey: value.trim() })} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="sk-or-v1-..." placeholderTextColor="#909099" className={inputClass} /></View><View><Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Agent model</Text><TextInput value={settings.receiptModel} onChangeText={(value) => void update({ receiptModel: value.trim() })} autoCapitalize="none" autoCorrect={false} placeholder="openai/gpt-5.6-terra" placeholderTextColor="#909099" className={inputClass} /></View></View>
      </View>

      <View className="mt-5">
      <Text className="text-[16px] font-bold text-surface-100">Add to Trello</Text>
      <Text className="mt-1.5 text-[14px] leading-5 text-surface-400">
        Same key, token, and destination the desktop app uses.
      </Text>

      <View className="mt-3 gap-2.5">
        <View>
          <Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">API key</Text>
          <TextInput
            value={settings.trelloApiKey}
            onChangeText={(value) => void update({ trelloApiKey: value.trim() })}
            placeholder="32-character key"
            placeholderTextColor="#909099"
            autoCapitalize="none"
            autoCorrect={false}
            className={inputClass}
          />
        </View>

        <View>
          <Text className="mb-1 text-[14px] font-semibold uppercase tracking-wide text-surface-400">Token</Text>
          <TextInput
            value={settings.trelloToken}
            onChangeText={(value) => void update({ trelloToken: value.trim() })}
            placeholder="Starts with ATTA"
            placeholderTextColor="#909099"
            autoCapitalize="none"
            autoCorrect={false}
            className={inputClass}
          />
          {tokenLooksWrong && (
            <Text className="mt-1.5 text-[14px] leading-5 text-amber-400">
              Trello tokens start with ATTA. A 64-character hex string is the OAuth secret, which
              will not authenticate.
            </Text>
          )}
        </View>
      </View>

      <View className="mt-4">
        <View className="mb-1.5 flex-row items-center justify-between">
          <Text className="text-[14px] font-semibold uppercase tracking-wide text-surface-400">Board</Text>
          {loadingBoards && <ActivityIndicator size="small" color="#91c4ff" />}
        </View>
        {boards.length === 0 ? (
          <Text className="text-[14px] text-surface-400">
            {credsReady ? 'No boards loaded yet.' : 'Add your key and token first.'}
          </Text>
        ) : (
          <View className="gap-2">
            {boards.map((board) => {
              const active = board.id === settings.trelloBoardId
              return (
                <Pressable
                  key={board.id}
                  onPress={() =>
                    void update({
                      trelloBoardId: board.id,
                      trelloListId: '',
                      listShortcuts: []
                    })
                  }
                  className={`rounded-lg border px-3 py-2 ${
                    active
                      ? 'border-accent-500/40 bg-accent-500/15'
                      : 'border-surface-800 bg-surface-900/50'
                  }`}
                >
                  <Text className={`text-[16px] font-medium ${active ? 'text-accent-400' : 'text-surface-100'}`}>
                    {board.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}
      </View>

      {settings.trelloBoardId && (
        <View className="mt-4">
          <View className="mb-1.5 flex-row items-center justify-between">
            <Text className="text-[14px] font-semibold uppercase tracking-wide text-surface-400">Default list</Text>
            {loadingLists && <ActivityIndicator size="small" color="#91c4ff" />}
          </View>
          <View className="gap-2">
            {lists.map((list) => {
              const active = list.id === settings.trelloListId
              const shortcut = settings.listShortcuts.some((item) => item.listId === list.id)
              return (
                <View key={list.id} className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => void update({ trelloListId: list.id })}
                    className={`flex-1 rounded-lg border px-3 py-2 ${
                      active
                        ? 'border-accent-500/40 bg-accent-500/15'
                        : 'border-surface-800 bg-surface-900/50'
                    }`}
                  >
                    <Text
                      className={`text-[16px] font-medium ${active ? 'text-accent-400' : 'text-surface-100'}`}
                    >
                      {list.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => toggleShortcut(list)}
                    className={`rounded-lg border px-2.5 py-2 ${
                      shortcut
                        ? 'border-accent-500/40 bg-accent-500/15'
                        : 'border-surface-800 bg-surface-900/50'
                    }`}
                  >
                    <Text
                      className={`text-[14px] ${shortcut ? 'text-accent-400' : 'text-surface-400'}`}
                    >
                      Pin
                    </Text>
                  </Pressable>
                </View>
              )
            })}
          </View>
          <Text className="mt-2 text-[14px] leading-5 text-surface-400">
            Pinned lists show as buttons on the capture screen, the phone equivalent of the
            desktop Ctrl+number shortcuts.
          </Text>
        </View>
      )}

      {error && <Text className="mt-3 text-[14px] leading-5 text-red-400">{error}</Text>}

      <View className="h-8" />
      </View>
    </ScrollView>
  )
}
