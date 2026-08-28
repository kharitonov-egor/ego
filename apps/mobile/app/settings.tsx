import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Database, ScanLine } from 'lucide-react-native'
import {
  looksLikeTrelloToken,
  type ListShortcut,
  type TrelloBoardSummary,
  type TrelloListSummary
} from '@ego/core'
import { useSettings } from '../lib/settings'
import { trelloClientFor } from '../lib/trello'
import { moneyClientFor } from '../lib/money'

const inputClass =
  'rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-3 text-sm text-surface-200'

export default function Settings(): React.ReactElement {
  const { settings, update } = useSettings()
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

  const credsReady = Boolean(settings.trelloApiKey && settings.trelloToken)

  useEffect(() => {
    setAccountId(settings.cloudflareAccountId)
    setDatabaseId(settings.d1DatabaseId)
    setApiToken(settings.d1ApiToken)
  }, [settings.cloudflareAccountId, settings.d1DatabaseId, settings.d1ApiToken])

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
    <ScrollView className="flex-1 bg-surface-950 px-5 pt-5" keyboardShouldPersistTaps="handled">
      <View className="rounded-2xl border border-surface-800 bg-surface-900/50 p-4">
        <View className="flex-row items-center"><Database color="#60a5fa" size={17} /><Text className="ml-2 text-sm font-medium text-surface-200">Cloudflare D1</Text></View>
        <Text className="mt-1 text-xs text-surface-500">The app reads and writes the budget database directly.</Text>
        <View className="mt-4 gap-3"><View><Text className="mb-1.5 text-xs text-surface-400">Account ID</Text><TextInput value={accountId} onChangeText={setAccountId} autoCapitalize="none" autoCorrect={false} placeholder="32-character account ID" placeholderTextColor="#3c4b73" className={inputClass} /></View><View><Text className="mb-1.5 text-xs text-surface-400">D1 database ID</Text><TextInput value={databaseId} onChangeText={setDatabaseId} autoCapitalize="none" autoCorrect={false} placeholder="Database UUID" placeholderTextColor="#3c4b73" className={inputClass} /></View><View><Text className="mb-1.5 text-xs text-surface-400">D1 API token</Text><TextInput value={apiToken} onChangeText={setApiToken} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="D1 Read and D1 Write token" placeholderTextColor="#3c4b73" className={inputClass} /></View></View>
        <Pressable disabled={savingMoney || !accountId || !databaseId || !apiToken} onPress={() => void saveMoney()} className={`mt-4 rounded-xl px-4 py-3 ${savingMoney || !accountId || !databaseId || !apiToken ? 'bg-surface-800' : 'bg-accent-600'}`}><Text className={`text-center text-sm font-semibold ${savingMoney ? 'text-surface-500' : 'text-white'}`}>{savingMoney ? 'Connecting...' : 'Save and connect'}</Text></Pressable>
        {moneyStatus && <Text className={`mt-2 text-xs ${moneyStatus.startsWith('Connected') ? 'text-emerald-400' : 'text-red-400'}`}>{moneyStatus}</Text>}
      </View>

      <View className="mt-4 rounded-2xl border border-surface-800 bg-surface-900/50 p-4">
        <View className="flex-row items-center"><ScanLine color="#60a5fa" size={17} /><Text className="ml-2 text-sm font-medium text-surface-200">Transaction image analysis</Text></View>
        <Text className="mt-1 text-xs text-surface-500">OpenRouter reads one temporary image. Ego does not save it.</Text>
        <View className="mt-4 gap-3"><View><Text className="mb-1.5 text-xs text-surface-400">OpenRouter API key</Text><TextInput value={settings.openRouterApiKey} onChangeText={(value) => void update({ openRouterApiKey: value.trim() })} secureTextEntry autoCapitalize="none" autoCorrect={false} placeholder="sk-or-v1-..." placeholderTextColor="#3c4b73" className={inputClass} /></View><View><Text className="mb-1.5 text-xs text-surface-400">Analysis model</Text><TextInput value={settings.receiptModel} onChangeText={(value) => void update({ receiptModel: value.trim() })} autoCapitalize="none" autoCorrect={false} placeholder="openai/gpt-5.6-terra" placeholderTextColor="#3c4b73" className={inputClass} /></View></View>
      </View>

      <View className="mt-8">
      <Text className="text-sm font-medium text-surface-300">Add to Trello</Text>
      <Text className="mt-1 text-xs text-surface-500">
        Same key, token, and destination the desktop app uses.
      </Text>

      <View className="mt-5 gap-3">
        <View>
          <Text className="mb-1.5 text-xs text-surface-400">API key</Text>
          <TextInput
            value={settings.trelloApiKey}
            onChangeText={(value) => void update({ trelloApiKey: value.trim() })}
            placeholder="32-character key"
            placeholderTextColor="#3c4b73"
            autoCapitalize="none"
            autoCorrect={false}
            className={inputClass}
          />
        </View>

        <View>
          <Text className="mb-1.5 text-xs text-surface-400">Token</Text>
          <TextInput
            value={settings.trelloToken}
            onChangeText={(value) => void update({ trelloToken: value.trim() })}
            placeholder="Starts with ATTA"
            placeholderTextColor="#3c4b73"
            autoCapitalize="none"
            autoCorrect={false}
            className={inputClass}
          />
          {tokenLooksWrong && (
            <Text className="mt-1.5 text-[11px] text-amber-400">
              Trello tokens start with ATTA. A 64-character hex string is the OAuth secret, which
              will not authenticate.
            </Text>
          )}
        </View>
      </View>

      <View className="mt-6">
        <View className="mb-2 flex-row items-center justify-between">
          <Text className="text-xs text-surface-400">Board</Text>
          {loadingBoards && <ActivityIndicator size="small" color="#60a5fa" />}
        </View>
        {boards.length === 0 ? (
          <Text className="text-[11px] text-surface-500">
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
                  className={`rounded-xl border px-4 py-3 ${
                    active
                      ? 'border-accent-500/40 bg-accent-500/15'
                      : 'border-surface-800 bg-surface-900/50'
                  }`}
                >
                  <Text className={`text-sm ${active ? 'text-accent-400' : 'text-surface-200'}`}>
                    {board.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}
      </View>

      {settings.trelloBoardId && (
        <View className="mt-6">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-xs text-surface-400">Default list</Text>
            {loadingLists && <ActivityIndicator size="small" color="#60a5fa" />}
          </View>
          <View className="gap-2">
            {lists.map((list) => {
              const active = list.id === settings.trelloListId
              const shortcut = settings.listShortcuts.some((item) => item.listId === list.id)
              return (
                <View key={list.id} className="flex-row items-center gap-2">
                  <Pressable
                    onPress={() => void update({ trelloListId: list.id })}
                    className={`flex-1 rounded-xl border px-4 py-3 ${
                      active
                        ? 'border-accent-500/40 bg-accent-500/15'
                        : 'border-surface-800 bg-surface-900/50'
                    }`}
                  >
                    <Text
                      className={`text-sm ${active ? 'text-accent-400' : 'text-surface-200'}`}
                    >
                      {list.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => toggleShortcut(list)}
                    className={`rounded-xl border px-3 py-3 ${
                      shortcut
                        ? 'border-accent-500/40 bg-accent-500/15'
                        : 'border-surface-800 bg-surface-900/50'
                    }`}
                  >
                    <Text
                      className={`text-[11px] ${shortcut ? 'text-accent-400' : 'text-surface-500'}`}
                    >
                      Pin
                    </Text>
                  </Pressable>
                </View>
              )
            })}
          </View>
          <Text className="mt-2 text-[11px] text-surface-500">
            Pinned lists show as buttons on the capture screen, the phone equivalent of the
            desktop Ctrl+number shortcuts.
          </Text>
        </View>
      )}

      {error && <Text className="mt-4 text-[11px] text-red-400">{error}</Text>}

      <View className="h-12" />
      </View>
    </ScrollView>
  )
}
