import React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Dumbbell, Settings, Wallet, type LucideIcon } from 'lucide-react-native'
import appIcon from '../assets/app-icon.png'
import { SignInPanel } from '../components/SignInPanel'
import { isSignedIn, useSettings } from '../lib/settings'

function AppTile({ label, Icon, onPress }: { label: string; Icon: LucideIcon; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    className="min-h-[128px] w-full items-center justify-center rounded-3xl border-2 border-white bg-black active:bg-white/10"
  >
    <Icon color="#ffffff" size={38} strokeWidth={1.75} />
    <Text className="mt-3 text-[22px] font-semibold text-white">{label}</Text>
  </Pressable>
}

/**
 * The start screen, and the only place that asks for sign-in. Finance and Gym both open from here
 * once the phone holds a device token.
 */
export default function Launcher(): React.ReactElement {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { settings, loading } = useSettings()
  const signedIn = isSignedIn(settings)
  return <ScrollView
    className="flex-1 bg-black"
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
  >
    <View className="h-11 flex-row justify-end">
      {signedIn && <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => router.push('/settings')}
        hitSlop={8}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
      ><Settings color="#d4d4d4" size={22} /></Pressable>}
    </View>
    <View className="items-center">
      <Image source={appIcon} accessibilityIgnoresInvertColors className="h-20 w-20 rounded-3xl" />
      <Text accessibilityRole="header" className="mt-3 text-[34px] font-bold tracking-tight text-white">Ego</Text>
    </View>
    {loading
      ? <ActivityIndicator color="#fafafa" className="mt-10" />
      : signedIn
        ? <View className="mt-10 gap-4">
          <AppTile label="Finance" Icon={Wallet} onPress={() => router.push('/(money)/overview')} />
          <AppTile label="Gym" Icon={Dumbbell} onPress={() => router.push('/gym')} />
        </View>
        : <View className="mt-10 rounded-3xl border border-border bg-card p-5">
          <Text accessibilityRole="header" className="text-[20px] font-semibold text-white">Sign in</Text>
          <View className="mt-2"><SignInPanel /></View>
        </View>}
  </ScrollView>
}
