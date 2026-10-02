import React from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Glance } from '../../lib/launcher/use-glance'
import { APPS, Private, SettingsButton, statusOf, useOpen, type AppKey } from './shared'

const ROWS: readonly AppKey[] = ['ai', 'tasks', 'habits', 'finance', 'gym', 'health', 'study', 'mood', 'diary', 'sheets']

function Row({ app, index, glance }: { app: AppKey; index: number; glance: Glance }): React.ReactElement {
  const open = useOpen()
  const { label, href } = APPS[app]
  const status = statusOf(app, glance)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={() => open(href)}
    className="flex-row items-center border-b border-[#1a1a1a] py-2.5 active:opacity-50"
  >
    <Text className="w-8 text-[12px] font-semibold text-[#4a4a4a]" style={{ fontVariant: ['tabular-nums'] }}>
      {String(index + 1).padStart(2, '0')}
    </Text>
    <Text numberOfLines={1} className="text-[40px] font-bold tracking-tighter text-white" style={{ lineHeight: 48 }}>{label}</Text>
    <View className="ml-3 flex-1 items-end">
      <Private personal={status?.personal ?? false} numberOfLines={1} className="text-[13px] text-surface-500">
        {status?.text ?? ''}
      </Private>
    </View>
  </Pressable>
}

/** No icons and no boxes: big names, numbered, with the news set small on the right. */
export function TypeLauncher({ glance }: { glance: Glance }): React.ReactElement {
  const { now } = glance
  return <View>
    <View className="flex-row items-center justify-between">
      <Text className="text-[13px] font-semibold uppercase tracking-[2px] text-surface-500">
        {now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
      </Text>
      <SettingsButton className="-mr-2" />
    </View>
    <View className="mt-4 border-t border-[#1a1a1a]">
      {ROWS.map((app, index) => <Row key={app} app={app} index={index} glance={glance} />)}
    </View>
  </View>
}
