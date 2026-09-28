import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CircleAlert } from 'lucide-react-native'
import { apiUrlFor, useSettings } from '../lib/settings'
import { moneyApiFor } from '../lib/api-client'
import { abandonGoogleSignIn, finishGoogleSignIn, signInErrorMessage } from '../lib/sign-in'
import { TOUCH } from '../components/money/tokens'

/** Google sends the browser back to ego://auth, which lands here with a one-time code. */
export default function Auth(): React.ReactElement {
  const params = useLocalSearchParams<{ code?: string; error?: string }>()
  const router = useRouter()
  const { settings, loading, update } = useSettings()
  const [message, setMessage] = useState<string | null>(null)
  const handled = useRef(false)

  const leave = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  useEffect(() => {
    if (loading || handled.current) return
    handled.current = true
    void (async () => {
      if (params.error || !params.code) {
        await abandonGoogleSignIn()
        setMessage(signInErrorMessage(params.error))
        return
      }
      const outcome = await finishGoogleSignIn(params.code)
      if (!outcome.ok) {
        setMessage(outcome.message)
        return
      }
      const replaced = { url: apiUrlFor(settings), token: settings.deviceToken.trim() }
      await update({
        apiUrl: outcome.apiUrl,
        deviceToken: outcome.result.token,
        account: {
          email: outcome.result.email,
          deviceId: outcome.result.deviceId,
          deviceName: outcome.result.deviceName
        }
      })
      if (replaced.token && replaced.token !== outcome.result.token) void moneyApiFor(replaced).signOut()
      leave()
    })()
  }, [loading])

  if (!message) {
    return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
      <ActivityIndicator color="#91c4ff" />
      <Text className="mt-4 text-[16px] text-surface-300">Signing you in</Text>
    </View>
  }

  return <View className="flex-1 items-center justify-center bg-surface-950 px-8">
    <CircleAlert color="#fb7185" size={32} />
    <Text className="mt-4 text-center text-[20px] font-semibold text-surface-100">Not signed in</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{message}</Text>
    <Pressable
      accessibilityRole="button"
      onPress={() => router.replace('/settings')}
      style={{ minHeight: TOUCH }}
      className="mt-6 justify-center rounded-xl bg-accent-600 px-5"
    >
      <Text className="text-[16px] font-semibold text-white">Back to Settings</Text>
    </Pressable>
  </View>
}
