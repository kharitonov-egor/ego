import React from 'react'
import { Image, Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Dumbbell, Wallet, type LucideIcon } from 'lucide-react-native'
import appIcon from '../assets/app-icon.png'

function AppTile({ label, Icon, onPress }: { label: string; Icon: LucideIcon; onPress?: () => void }): React.ReactElement {
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

/** The start screen. Each tile opens one app; Gym is a placeholder with nothing behind it yet. */
export default function Launcher(): React.ReactElement {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  return <ScrollView
    className="flex-1 bg-black"
    contentContainerStyle={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24, paddingHorizontal: 16 }}
  >
    <View className="items-center">
      <Image source={appIcon} accessibilityIgnoresInvertColors className="h-20 w-20 rounded-3xl" />
      <Text accessibilityRole="header" className="mt-3 text-[34px] font-bold tracking-tight text-white">Ego</Text>
    </View>
    <View className="mt-10 gap-4">
      <AppTile label="Finance" Icon={Wallet} onPress={() => router.push('/(money)/overview')} />
      <AppTile label="Gym" Icon={Dumbbell} />
    </View>
  </ScrollView>
}
