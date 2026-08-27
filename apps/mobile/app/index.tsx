import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { isConfigured, useSettings } from '../lib/settings'

export default function Home(): React.ReactElement {
  const { settings, loading } = useSettings()
  const router = useRouter()
  const ready = isConfigured(settings)

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-surface-950">
        <ActivityIndicator color="#60a5fa" />
      </View>
    )
  }

  return (
    <View className="flex-1 bg-surface-950 px-5 pt-8">
      <View className="items-center">
        <View className="h-20 w-20 items-center justify-center rounded-full border-[6px] border-white">
          <View className="h-6 w-6 rounded-full bg-white" />
        </View>
        <Text className="mt-4 text-xl font-semibold text-surface-100">Ego</Text>
        <Text className="mt-1 text-xs text-surface-500">Capture it now, sort it later</Text>
      </View>

      <View className="mt-12">
        <Pressable
          onPress={() => router.push('/capture')}
          disabled={!ready}
          className={`rounded-2xl px-5 py-5 ${ready ? 'bg-accent-600 active:bg-accent-500' : 'bg-surface-800'}`}
        >
          <Text
            className={`text-center text-base font-semibold ${ready ? 'text-white' : 'text-surface-500'}`}
          >
            Add new Trello card
          </Text>
        </Pressable>

        {!ready && (
          <Text className="mt-3 text-center text-xs text-surface-500">
            Add your Trello key, token, and a list in Settings first.
          </Text>
        )}
      </View>

      <View className="mt-auto mb-8">
        <Link href="/settings" asChild>
          <Pressable className="rounded-xl border border-surface-800 bg-surface-900/50 px-4 py-3 active:bg-surface-800">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-surface-200">Settings</Text>
              <Text
                className={`text-[11px] ${ready ? 'text-emerald-400' : 'text-surface-500'}`}
              >
                {ready ? 'Ready' : 'Needs setup'}
              </Text>
            </View>
          </Pressable>
        </Link>
      </View>
    </View>
  )
}
