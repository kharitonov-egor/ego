import React from 'react'
import { Pressable, Text, View, type TextProps } from 'react-native'
import { useRouter, type Href } from 'expo-router'
import {
  ArrowUp, BookOpen, CircleCheckBig, Dumbbell, GraduationCap, HeartPulse, Settings, Smile, Sparkles, SquareKanban, Wallet,
  type LucideIcon
} from 'lucide-react-native'
import { formatSleepMinutes } from '@ego/core'
import { Blurred } from '../../lib/blur'
import { parseIso } from '../../lib/dates'
import type { Glance } from '../../lib/launcher/use-glance'
import { cn } from '../../lib/utils'

export type AppKey = 'ai' | 'finance' | 'gym' | 'health' | 'mood' | 'diary' | 'study' | 'habits' | 'tasks'

export interface LauncherApp {
  key: AppKey
  label: string
  Icon: LucideIcon
  href: Href
}

export const APPS: Record<AppKey, LauncherApp> = {
  ai: { key: 'ai', label: 'AI', Icon: Sparkles, href: '/ai' },
  finance: { key: 'finance', label: 'Finance', Icon: Wallet, href: '/(money)/overview' },
  gym: { key: 'gym', label: 'Gym', Icon: Dumbbell, href: '/gym' },
  health: { key: 'health', label: 'Health', Icon: HeartPulse, href: '/health' },
  mood: { key: 'mood', label: 'Mood', Icon: Smile, href: '/mood' },
  diary: { key: 'diary', label: 'Diary', Icon: BookOpen, href: '/diary' },
  study: { key: 'study', label: 'Study', Icon: GraduationCap, href: '/(study)/assignments' },
  habits: { key: 'habits', label: 'Habits', Icon: CircleCheckBig, href: '/(habits)/home' },
  tasks: { key: 'tasks', label: 'Tasks', Icon: SquareKanban, href: '/tasks' }
}

export const ORDER: readonly AppKey[] = ['ai', 'finance', 'gym', 'health', 'mood', 'diary', 'study', 'habits', 'tasks']

export interface Status {
  text: string
  /** Blur hides it. */
  personal: boolean
}

const WHOLE_USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const COUNT = new Intl.NumberFormat('en-US')

export function usd(cents: number): string {
  return WHOLE_USD.format(Math.round(cents / 100))
}

export function count(value: number): string {
  return COUNT.format(value)
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000)
}

export function dayAgo(date: string, today: string): string {
  const days = daysBetween(date, today)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function timeAgo(at: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function longDate(now: Date): string {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function monthName(now: Date, style: 'long' | 'short' = 'short'): string {
  return now.toLocaleDateString('en-US', { month: style })
}

export function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function statusOf(key: AppKey, glance: Glance): Status | null {
  const { local, tasks, now } = glance
  switch (key) {
    case 'ai':
      return { text: 'Ask anything', personal: false }
    case 'finance':
      return local?.money ? { text: `${usd(local.money.monthCents)} in ${monthName(now)}`, personal: true } : null
    case 'gym': {
      const gym = local?.gym
      if (!gym) return null
      if (gym.setsToday > 0) return { text: `${plural(gym.setsToday, 'set')} today`, personal: true }
      if (gym.lastDate) return { text: `Trained ${dayAgo(gym.lastDate, local.today)}`, personal: true }
      return { text: 'No workouts yet', personal: false }
    }
    case 'health': {
      const health = local?.health
      if (!health) return null
      if (!health.connected) return { text: 'Not connected', personal: false }
      if (health.steps !== null) return { text: plural(health.steps, 'step'), personal: true }
      if (health.sleepMinutes !== null) return { text: `Slept ${formatSleepMinutes(health.sleepMinutes)}`, personal: true }
      return { text: 'Nothing yet today', personal: false }
    }
    case 'mood':
      if (local?.moodLogged == null) return null
      return { text: local.moodLogged ? 'Logged today' : 'Not logged today', personal: false }
    case 'diary':
      if (!local?.diary) return null
      return { text: local.diary.lastAt ? `Wrote ${timeAgo(local.diary.lastAt, now)}` : 'No entries yet', personal: false }
    case 'study': {
      const study = local?.study
      if (!study) return null
      if (study.overdue > 0) return { text: `${count(study.overdue)} overdue`, personal: true }
      if (study.week > 0) return { text: `${count(study.week)} due this week`, personal: true }
      return { text: 'Nothing due', personal: false }
    }
    case 'habits': {
      const habits = local?.habits
      if (!habits) return null
      if (habits.total === 0) return { text: 'Nothing due today', personal: false }
      if (habits.done >= habits.total) return { text: 'All done today', personal: false }
      return { text: `${habits.done} of ${habits.total} today`, personal: true }
    }
    case 'tasks': {
      if (!tasks) return null
      if (tasks.overdue > 0 && tasks.today > 0) return { text: `${tasks.overdue} overdue, ${tasks.today} today`, personal: true }
      if (tasks.overdue > 0) return { text: `${count(tasks.overdue)} overdue`, personal: true }
      if (tasks.today > 0) return { text: `${count(tasks.today)} due today`, personal: true }
      return { text: 'Nothing due today', personal: false }
    }
  }
}

/** A line of personal data that Blur hides. */
export function Private({ personal = true, tint, ...props }: TextProps & { personal?: boolean; tint?: string }): React.ReactElement {
  return <Blurred active={personal} tint={tint}><Text {...props} /></Blurred>
}

export function useOpen(): (href: Href) => void {
  const router = useRouter()
  return (href) => router.push(href)
}

export function SettingsButton({ className }: { className?: string }): React.ReactElement {
  const open = useOpen()
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Open settings"
    onPress={() => open('/settings')}
    hitSlop={8}
    className={cn('h-11 w-11 items-center justify-center rounded-full active:bg-white/10', className)}
  ><Settings color="#a3a3a3" size={22} /></Pressable>
}

export function AskBar({ className }: { className?: string }): React.ReactElement {
  const open = useOpen()
  const { Icon } = APPS.ai
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Ask AI"
    onPress={() => open(APPS.ai.href)}
    className={cn('h-14 flex-row items-center rounded-full border border-[#232323] bg-[#111111] pl-5 pr-2 active:bg-[#1a1a1a]', className)}
  >
    <Icon color="#fafafa" size={18} />
    <Text className="ml-3 flex-1 text-[16px] text-[#7a7a7a]">Ask Ego anything</Text>
    <View className="h-10 w-10 items-center justify-center rounded-full bg-white">
      <ArrowUp color="#000000" size={18} strokeWidth={2.5} />
    </View>
  </Pressable>
}
