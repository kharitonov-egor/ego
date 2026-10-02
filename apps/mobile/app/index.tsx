import React, { useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Settings } from 'lucide-react-native'
import appIcon from '../assets/app-icon.png'
import { SignInPanel } from '../components/SignInPanel'
import { BentoLauncher } from '../components/launcher/BentoLauncher'
import { HomeLauncher } from '../components/launcher/HomeLauncher'
import { ListLauncher } from '../components/launcher/ListLauncher'
import { TodayLauncher } from '../components/launcher/TodayLauncher'
import { TypeLauncher } from '../components/launcher/TypeLauncher'
import { APPS, ORDER, type LauncherApp } from '../components/launcher/shared'
import { useGlance, type Glance } from '../lib/launcher/use-glance'
import { isSignedIn, useSettings } from '../lib/settings'
import { cn } from '../lib/utils'

function AppTile({ label, Icon, onPress }: Pick<LauncherApp, 'label' | 'Icon'> & { onPress: () => void }): React.ReactElement {
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
  const apps = ORDER.map((key) => APPS[key])
  const rows = Array.from({ length: Math.ceil(apps.length / 2) }, (_, row) => apps.slice(row * 2, row * 2 + 2))
  return <View className="mt-10 gap-4">
    {rows.map((row) => <View key={row[0].label} className="flex-row gap-4">
      {row.map((app) => <AppTile key={app.label} label={app.label} Icon={app.Icon} onPress={() => onOpen(app.href)} />)}
      {row.length === 1 && <View className="flex-1" />}
    </View>)}
  </View>
}

function Heading(): React.ReactElement {
  return <View className="items-center">
    <Image source={appIcon} accessibilityIgnoresInvertColors className="h-20 w-20 rounded-3xl" />
    <Text accessibilityRole="header" className="mt-3 text-[34px] font-bold tracking-tight text-white">Ego</Text>
  </View>
}

function ClassicLauncher(): React.ReactElement {
  const router = useRouter()
  return <View>
    <View className="h-11 flex-row justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => router.push('/settings')}
        hitSlop={8}
        className="h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
      ><Settings color="#d4d4d4" size={22} /></Pressable>
    </View>
    <Heading />
    <AppGrid onOpen={(href) => router.push(href)} />
  </View>
}

type Design = 'current' | 'today' | 'bento' | 'list' | 'home' | 'type'

const DESIGNS: readonly { key: Design; label: string }[] = [
  { key: 'current', label: 'Current' },
  { key: 'today', label: '1 Today' },
  { key: 'bento', label: '2 Bento' },
  { key: 'list', label: '3 List' },
  { key: 'home', label: '4 Home' },
  { key: 'type', label: '5 Type' }
]

function DesignTabs({ value, onChange }: { value: Design; onChange: (design: Design) => void }): React.ReactElement {
  return <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    className="flex-grow-0"
    contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}
  >
    {DESIGNS.map((design) => {
      const selected = design.key === value
      return <Pressable
        key={design.key}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        onPress={() => onChange(design.key)}
        className={cn('h-8 justify-center rounded-full px-3.5', selected ? 'bg-white' : 'bg-[#161616]')}
      >
        <Text className={cn('text-[13px] font-semibold', selected ? 'text-black' : 'text-[#8a8a8a]')}>{design.label}</Text>
      </Pressable>
    })}
  </ScrollView>
}

function Chosen({ design, glance }: { design: Design; glance: Glance }): React.ReactElement {
  switch (design) {
    case 'current': return <ClassicLauncher />
    case 'today': return <TodayLauncher glance={glance} />
    case 'bento': return <BentoLauncher glance={glance} />
    case 'list': return <ListLauncher glance={glance} />
    case 'home': return <HomeLauncher glance={glance} />
    case 'type': return <TypeLauncher glance={glance} />
  }
}

/**
 * The start screen, and the only place that asks for sign-in. Every app opens from here once the
 * phone holds a device token.
 */
export default function Launcher(): React.ReactElement {
  const insets = useSafeAreaInsets()
  const { settings, loading } = useSettings()
  const glance = useGlance()
  const [design, setDesign] = useState<Design>('today')
  const signedIn = isSignedIn(settings)
  if (loading || !signedIn) {
    return <ScrollView
      className="flex-1 bg-black"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 52, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}
    >
      <Heading />
      {loading
        ? <ActivityIndicator color="#fafafa" className="mt-10" />
        : <View className="mt-10 rounded-3xl border border-border bg-card p-5">
          <Text accessibilityRole="header" className="text-[20px] font-semibold text-white">Sign in</Text>
          <View className="mt-2"><SignInPanel /></View>
        </View>}
    </ScrollView>
  }
  return <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
    <DesignTabs value={design} onChange={setDesign} />
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: 12,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: design === 'current' ? 24 : 20
      }}
    >
      <Chosen design={design} glance={glance} />
    </ScrollView>
  </View>
}
