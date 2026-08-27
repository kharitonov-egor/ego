import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import {
  looksLikeTrelloToken,
  type ListShortcut,
  type TrelloBoardSummary,
  type TrelloListSummary
} from '@ego/core'
import { useSettings } from '../lib/settings'
import { trelloClientFor } from '../lib/trello'

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

  const credsReady = Boolean(settings.trelloApiKey && settings.trelloToken)

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

  return (
    <ScrollView className="flex-1 bg-surface-950 px-5 pt-5" keyboardShouldPersistTaps="handled">
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
    </ScrollView>
  )
}
