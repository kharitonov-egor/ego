import React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { KeyboardScrollView } from '../components/ui/keyboard'
import { useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Bookmark, BookOpen, CalendarDays, CircleCheckBig, Dumbbell, GraduationCap, HeartPulse, Settings, Sheet, Smile, Sparkles, SquareKanban,
  UtensilsCrossed, Wallet,
  type LucideIcon
} from 'lucide-react-native'
import { eventColorOf } from '@ego/core'
import { clockLabel, localDayOf } from '@ego/local/calendar/layout'
import { isoToday, shiftIso } from '@ego/local/dates'
import appIcon from '../assets/app-icon.png'
import { SignInPanel } from '../components/SignInPanel'
import { Blurred } from '../lib/blur'
import { useNextEvent } from '../lib/calendar/next'
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
  { label: 'Habits', Icon: CircleCheckBig, href: '/(habits)/home' },
  { label: 'Tasks', Icon: SquareKanban, href: '/tasks' },
  { label: 'Sheets', Icon: Sheet, href: '/sheets' },
  { label: 'Food', Icon: UtensilsCrossed, href: '/food' },
  { label: 'Content', Icon: Bookmark, href: '/content' },
  { label: 'Calendar', Icon: CalendarDays, href: '/calendar' }
]

function AppTile({ app, onPress }: { app: App; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={app.label}
    onPress={onPress}
    className="flex-1 items-center justify-center rounded-3xl border-2 border-white bg-black px-2 active:bg-white/10"
  >
    <app.Icon color="#ffffff" size={30} strokeWidth={1.75} />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} className="mt-2 text-[18px] font-semibold text-white">{app.label}</Text>
  </Pressable>
}

/**
 * Two tiles a row. The rows share the height left under the heading, so every app fits on one
 * screen; a short phone scrolls once a row reaches its minimum. An odd last tile keeps its half width.
 */
function AppGrid({ onOpen }: { onOpen: (href: Href) => void }): React.ReactElement {
  const rows = Array.from({ length: Math.ceil(APPS.length / 2) }, (_, row) => APPS.slice(row * 2, row * 2 + 2))
  return <View className="mt-5 flex-1 gap-3">
    {rows.map((row) => <View key={row[0].label} className="flex-1 flex-row gap-3" style={{ minHeight: 76, maxHeight: 136 }}>
      {row.map((app) => <AppTile key={app.label} app={app} onPress={() => onOpen(app.href)} />)}
      {row.length === 1 && <View className="flex-1" />}
    </View>)}
  </View>
}

function dayWord(start: string): string {
  const day = localDayOf(start)
  if (day === isoToday()) return 'Today'
  if (day === shiftIso(isoToday(), 1)) return 'Tomorrow'
  return new Date(start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The next thing on the calendar, between the heading and the tiles. */
function NextEvent({ onOpen }: { onOpen: () => void }): React.ReactElement | null {
  const next = useNextEvent()
  if (!next) return null
  const { event, calendar } = next
  const when = Date.parse(event.start) <= Date.now() ? `Now, until ${clockLabel(event.end)}` : `${dayWord(event.start)}, ${clockLabel(event.start)}`
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Next event, ${when}`}
    onPress={onOpen}
    className="mt-4 flex-row items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900 py-2.5 pl-3 pr-4 active:bg-surface-800"
  >
    <View className="h-9 w-1.5 rounded-full" style={{ backgroundColor: eventColorOf(event.colorId, calendar.color) }} />
    <View className="flex-1">
      <Text className="text-[13px] font-semibold text-surface-400">{when}</Text>
      <Blurred><Text numberOfLines={1} className="text-[16px] font-semibold text-white">{event.title || '(No title)'}</Text></Blurred>
    </View>
  </Pressable>
}

function Heading({ size }: { size: 'large' | 'small' }): React.ReactElement {
  const large = size === 'large'
  return <View className="items-center">
    <Image source={appIcon} accessibilityIgnoresInvertColors className={large ? 'h-20 w-20 rounded-3xl' : 'h-14 w-14 rounded-2xl'} />
    <Text accessibilityRole="header" className={`${large ? 'mt-3 text-[34px]' : 'mt-2 text-[28px]'} font-bold tracking-tight text-white`}>Ego</Text>
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
  if (loading || !isSignedIn(settings)) {
    return <KeyboardScrollView
      className="flex-1 bg-black"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingTop: insets.top + 52, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}
    >
      <Heading size="large" />
      {loading
        ? <ActivityIndicator color="#fafafa" className="mt-10" />
        : <View className="mt-10 rounded-3xl border border-border bg-card p-5">
          <Text accessibilityRole="header" className="text-[20px] font-semibold text-white">Sign in</Text>
          <View className="mt-2"><SignInPanel /></View>
        </View>}
    </KeyboardScrollView>
  }
  return <ScrollView
    className="flex-1 bg-black"
    contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingHorizontal: 20 }}
  >
    <View>
      <Heading size="small" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => router.push('/settings')}
        hitSlop={8}
        className="absolute right-0 top-0 h-11 w-11 items-center justify-center rounded-full active:bg-white/10"
      ><Settings color="#d4d4d4" size={22} /></Pressable>
    </View>
    <NextEvent onOpen={() => router.push('/calendar')} />
    <AppGrid onOpen={(href) => router.push(href)} />
  </ScrollView>
}
