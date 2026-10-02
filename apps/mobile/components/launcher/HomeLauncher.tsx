import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { CircleCheckBig, Footprints, SquareKanban, Wallet, type LucideIcon } from 'lucide-react-native'
import type { Glance } from '../../lib/launcher/use-glance'
import { APPS, AskBar, Private, SettingsButton, count, usd, useOpen, type AppKey } from './shared'

const GRID: readonly AppKey[] = ['finance', 'gym', 'health', 'habits', 'tasks', 'study', 'mood', 'diary']

function Chip({ Icon, text, onPress }: { Icon: LucideIcon; text: string; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    onPress={onPress}
    className="h-9 flex-row items-center rounded-full border border-[#262626] px-3 active:bg-[#1a1a1a]"
  >
    <Icon color="#8a8a8a" size={14} strokeWidth={2.25} />
    <Private className="ml-1.5 text-[13px] font-semibold text-[#e5e5e5]" style={{ fontVariant: ['tabular-nums'] }}>{text}</Private>
  </Pressable>
}

function Chips({ glance }: { glance: Glance }): React.ReactElement {
  const open = useOpen()
  const { local, tasks } = glance
  const habits = local?.habits
  const steps = local?.health?.steps
  const due = tasks ? tasks.today + tasks.overdue : null
  return <View className="mt-6 flex-row flex-wrap gap-2">
    {habits && habits.total > 0 && <Chip Icon={CircleCheckBig} text={`${habits.done}/${habits.total}`} onPress={() => open(APPS.habits.href)} />}
    {due !== null && <Chip Icon={SquareKanban} text={due === 0 ? 'Clear' : `${due} due`} onPress={() => open(APPS.tasks.href)} />}
    {local?.money && <Chip Icon={Wallet} text={`${usd(local.money.todayCents)} today`} onPress={() => open(APPS.finance.href)} />}
    {steps != null && <Chip Icon={Footprints} text={count(steps)} onPress={() => open(APPS.health.href)} />}
  </View>
}

function AppIcon({ app }: { app: AppKey }): React.ReactElement {
  const open = useOpen()
  const { label, Icon, href } = APPS[app]
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={() => open(href)}
    className="w-1/4 items-center py-2 active:opacity-60"
  >
    <View className="h-[64px] w-[64px] items-center justify-center rounded-[20px] border border-[#262626] bg-[#141414]">
      <Icon color="#fafafa" size={26} strokeWidth={1.75} />
    </View>
    <Text numberOfLines={1} className="mt-2 text-[13px] font-medium text-[#d4d4d4]">{label}</Text>
  </Pressable>
}

/** A phone home screen: a big date, a few chips, a grid of icons, and AI docked at the bottom. */
export function HomeLauncher({ glance }: { glance: Glance }): React.ReactElement {
  const { now } = glance
  return <View className="flex-1">
    <View className="flex-row items-start">
      <Text className="text-[96px] font-extralight tracking-tighter text-white" style={{ lineHeight: 100, fontVariant: ['tabular-nums'] }}>
        {now.getDate()}
      </Text>
      <View className="ml-3 flex-1 pt-5">
        <Text className="text-[20px] font-semibold text-white">{now.toLocaleDateString('en-US', { weekday: 'long' })}</Text>
        <Text className="text-[20px] text-surface-500">{now.toLocaleDateString('en-US', { month: 'long' })}</Text>
      </View>
      <SettingsButton className="-mr-2" />
    </View>
    <Chips glance={glance} />
    <View className="-mx-1 mt-8 flex-row flex-wrap">
      {GRID.map((app) => <AppIcon key={app} app={app} />)}
    </View>
    <View className="min-h-[24px] flex-1" />
    <AskBar />
  </View>
}
