import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { Glance } from '../../lib/launcher/use-glance'
import { APPS, AskBar, Private, SettingsButton, longDate, statusOf, useOpen, type AppKey } from './shared'

const GROUPS: readonly { title: string; apps: readonly AppKey[] }[] = [
  { title: 'Today', apps: ['tasks', 'habits', 'study'] },
  { title: 'Body', apps: ['gym', 'health'] },
  { title: 'Money', apps: ['finance'] },
  { title: 'Private', apps: ['mood', 'diary'] }
]

function Row({ app, glance, last }: { app: AppKey; glance: Glance; last: boolean }): React.ReactElement {
  const open = useOpen()
  const { label, Icon, href } = APPS[app]
  const status = statusOf(app, glance)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={() => open(href)}
    className="flex-row items-center pl-4 active:bg-[#181818]"
  >
    <View className="h-10 w-10 items-center justify-center rounded-[12px] bg-[#1f1f1f]">
      <Icon color="#fafafa" size={20} />
    </View>
    <View className={`ml-3.5 flex-1 flex-row items-center py-3.5 pr-3 ${last ? '' : 'border-b border-[#1c1c1c]'}`}>
      <View className="flex-1">
        <Text className="text-[17px] font-semibold text-white">{label}</Text>
        <Private personal={status?.personal ?? false} numberOfLines={1} className="mt-0.5 text-[14px] text-surface-500">
          {status?.text ?? ' '}
        </Private>
      </View>
      <ChevronRight color="#4a4a4a" size={20} />
    </View>
  </Pressable>
}

/** Settings-style grouped rows: denser than tiles, and every row says what is waiting inside. */
export function ListLauncher({ glance }: { glance: Glance }): React.ReactElement {
  return <View>
    <View className="flex-row items-start justify-between">
      <View className="flex-1 pt-1">
        <Text accessibilityRole="header" className="text-[34px] font-bold tracking-tight text-white">Ego</Text>
        <Text className="text-[15px] text-surface-500">{longDate(glance.now)}</Text>
      </View>
      <SettingsButton className="-mr-2" />
    </View>
    <AskBar className="mt-5" />
    {GROUPS.map((group) => <View key={group.title} className="mt-6">
      <Text className="mb-2 ml-4 text-[13px] font-semibold uppercase tracking-[1.5px] text-surface-500">{group.title}</Text>
      <View className="overflow-hidden rounded-[22px] border border-[#1c1c1c] bg-[#0f0f0f]">
        {group.apps.map((app, index) => <Row key={app} app={app} glance={glance} last={index === group.apps.length - 1} />)}
      </View>
    </View>)}
  </View>
}
