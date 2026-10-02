import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Ring } from '../habits/Ring'
import type { Glance } from '../../lib/launcher/use-glance'
import { APPS, ORDER, Private, SettingsButton, greeting, longDate, statusOf, usd, useOpen, type AppKey } from './shared'

function Stat({ value, label, onPress }: { value: string; label: string; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="flex-1 justify-center py-1 active:opacity-60">
    <Private className="text-[26px] font-bold tracking-tight text-white" style={{ fontVariant: ['tabular-nums'] }}>{value}</Private>
    <Text className="mt-0.5 text-[13px] text-surface-500">{label}</Text>
  </Pressable>
}

function TodayCard({ glance }: { glance: Glance }): React.ReactElement {
  const open = useOpen()
  const habits = glance.local?.habits
  const tasks = glance.tasks
  const money = glance.local?.money
  const due = tasks ? tasks.today + tasks.overdue : null
  return <View className="mt-7 flex-row items-center rounded-[28px] border border-[#1f1f1f] bg-[#101010] p-5">
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open habits"
      onPress={() => open(APPS.habits.href)}
      className="h-[92px] w-[92px] items-center justify-center active:opacity-60"
    >
      <Ring size={92} stroke={7} share={habits && habits.total > 0 ? habits.done / habits.total : 0} track="#222222" fill="#fafafa" />
      <Private className="text-[22px] font-bold text-white" style={{ fontVariant: ['tabular-nums'] }}>
        {habits ? `${habits.done}/${habits.total}` : '–'}
      </Private>
      <Text className="text-[11px] font-medium uppercase tracking-wider text-surface-500">habits</Text>
    </Pressable>
    <View className="ml-5 flex-1 gap-3 border-l border-[#1f1f1f] pl-5">
      <Stat
        value={due === null ? '–' : String(due)}
        label={tasks && tasks.overdue > 0 ? `tasks due, ${tasks.overdue} overdue` : 'tasks due today'}
        onPress={() => open(APPS.tasks.href)}
      />
      <Stat value={money ? usd(money.todayCents) : '–'} label="spent today" onPress={() => open(APPS.finance.href)} />
    </View>
  </View>
}

function Tile({ app, glance }: { app: AppKey; glance: Glance }): React.ReactElement {
  const open = useOpen()
  const { label, Icon, href } = APPS[app]
  const status = statusOf(app, glance)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={() => open(href)}
    className="h-[118px] flex-1 justify-between rounded-[24px] border border-[#1f1f1f] bg-[#101010] p-3.5 active:bg-[#1a1a1a]"
  >
    <View className="h-9 w-9 items-center justify-center rounded-full bg-[#1f1f1f]">
      <Icon color="#fafafa" size={18} strokeWidth={2} />
    </View>
    <View>
      <Text numberOfLines={1} className="text-[16px] font-semibold text-white">{label}</Text>
      <Private personal={status?.personal ?? false} numberOfLines={1} className="mt-0.5 text-[12px] text-surface-500">
        {status?.text ?? ' '}
      </Private>
    </View>
  </Pressable>
}

/** A greeting, today's three numbers, then every app three to a row with one line of news each. */
export function TodayLauncher({ glance }: { glance: Glance }): React.ReactElement {
  const rows = Array.from({ length: Math.ceil(ORDER.length / 3) }, (_, row) => ORDER.slice(row * 3, row * 3 + 3))
  return <View>
    <View className="flex-row items-start justify-between">
      <View className="flex-1 pt-1">
        <Text className="text-[13px] font-semibold uppercase tracking-[1.5px] text-surface-500">{longDate(glance.now)}</Text>
        <Text accessibilityRole="header" className="mt-1.5 text-[34px] font-bold tracking-tight text-white">{greeting(glance.now)}</Text>
      </View>
      <SettingsButton className="-mr-2" />
    </View>
    <TodayCard glance={glance} />
    <Text className="mb-3 mt-8 text-[13px] font-semibold uppercase tracking-[1.5px] text-surface-500">Apps</Text>
    <View className="gap-2.5">
      {rows.map((row) => <View key={row[0]} className="flex-row gap-2.5">
        {row.map((app) => <Tile key={app} app={app} glance={glance} />)}
        {Array.from({ length: 3 - row.length }, (_, index) => <View key={index} className="flex-1" />)}
      </View>)}
    </View>
  </View>
}
