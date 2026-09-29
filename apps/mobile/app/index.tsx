import React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  BookOpen, CircleCheckBig, Dumbbell, GraduationCap, HeartPulse, Settings, Smile, Sparkles, Wallet, type LucideIcon
} from 'lucide-react-native'
import appIcon from '../assets/app-icon.png'
import { SignInPanel } from '../components/SignInPanel'
import { isSignedIn, useSettings } from '../lib/settings'

interface App {
  label: string
  Icon: LucideIcon
  href: Href
}

const APPS: readonly App[] = [
  { label: 'AI', Icon: Sparkles, href: '/ai' },
  { label: 'Finance', Icon: Wallet, href: '/(money)/overview' },
  { label: 'Gym', Icon: Dumbbell, href: '/gym' },
  { label: 'Health', Icon: HeartPulse, href: '/health' },
  { label: 'Mood', Icon: Smile, href: '/mood' },
  { label: 'Diary', Icon: BookOpen, href: '/diary' },
  { label: 'Study', Icon: GraduationCap, href: '/(study)/assignments' },
  { label: 'Habits', Icon: CircleCheckBig, href: '/(habits)/home' }
]

function AppTile({ label, Icon, onPress }: { label: string; Icon: LucideIcon; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    className="min-h-[136px] flex-1 items-center justify-center rounded-3xl border-2 border-white bg-black px-2 active:bg-white/10"
  >
    <Icon color="#ffffff" size={36} strokeWidth={1.75} />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="mt-3 text-[20px] font-semibold text-white">{label}</Text>
  </Pressable>
}

/** Two tiles a row. An odd last tile keeps its half width, so the grid stays even. */
function AppGrid({ onOpen }: { onOpen: (href: Href) => void }): React.ReactElement {
  const rows = Array.from({ length: Math.ceil(APPS.length / 2) }, (_, row) => APPS.slice(row * 2, row * 2 + 2))
  return <View className="mt-10 gap-4">
    {rows.map((row) => <View key={row[0].label} className="flex-row gap-4">
      {row.map((app) => <AppTile key={app.label} label={app.label} Icon={app.Icon} onPress={() => onOpen(app.href)} />)}
      {row.length === 1 && <View className="flex-1" />}
    </View>)}
  </View>
}

/**
 * The start screen, and the only place that asks for sign-in. Every app opens from here once the
 * phone holds a device token.
 */
export default function Launcher(): React.ReactElement {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { settings, loading } = useSettings()
  const signedIn = isSignedIn(settings)
  return <ScrollView
    className="flex-1 bg-black"
    keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}
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
        ? <AppGrid onOpen={(href) => router.push(href)} />
        : <View className="mt-10 rounded-3xl border border-border bg-card p-5">
          <Text accessibilityRole="header" className="text-[20px] font-semibold text-white">Sign in</Text>
          <View className="mt-2"><SignInPanel /></View>
        </View>}
  </ScrollView>
}
