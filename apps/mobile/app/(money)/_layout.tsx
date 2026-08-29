import React from 'react'
import { Pressable } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import {
  ArrowLeft, ChartNoAxesCombined, CirclePlus, Landmark, PieChart, ReceiptText, Settings
} from 'lucide-react-native'
import { useMoneyTabBarStyle } from '../../components/money/navigation'

function HeaderButton({ label, onPress, children }: {
  label: string
  onPress: () => void
  children: React.ReactNode
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    hitSlop={12}
    style={{ marginLeft: 14 }}
  >{children}</Pressable>
}

export default function MoneyTabs(): React.ReactElement {
  const router = useRouter()
  const tabBarStyle = useMoneyTabBarStyle()
  return <Tabs initialRouteName="overview" screenOptions={{
    headerStyle: { backgroundColor: '#1c1d1f' },
    headerTitleContainerStyle: { paddingVertical: 0 },
    headerTintColor: '#e6e6e8',
    headerTitleAlign: 'center',
    headerTitleStyle: { fontSize: 17, fontWeight: '700' },
    sceneStyle: { backgroundColor: '#121214' },
    tabBarStyle,
    tabBarActiveTintColor: '#91c4ff',
    tabBarInactiveTintColor: '#909099',
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600', paddingBottom: 2 },
    tabBarIconStyle: { marginTop: 1 },
    headerRight: () => <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      onPress={() => router.push('/settings')}
      hitSlop={12}
      style={{ marginRight: 14 }}
    ><Settings color="#b5b5bc" size={20} /></Pressable>
  }}>
    <Tabs.Screen name="overview" options={{ title: 'Home', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#91c4ff" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <ChartNoAxesCombined color={color} size={22} /> }} />
    <Tabs.Screen name="transactions" options={{ title: 'Activity', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#91c4ff" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <ReceiptText color={color} size={22} /> }} />
    <Tabs.Screen name="categories" options={{ title: 'Categories', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#91c4ff" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <PieChart color={color} size={22} /> }} />
    <Tabs.Screen name="accounts" options={{ title: 'Accounts', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#91c4ff" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <Landmark color={color} size={22} /> }} />
    <Tabs.Screen name="budget" options={{ href: null, title: 'Budget' }} />
    <Tabs.Screen name="purchases" options={{ href: null, title: 'Purchase details', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/transactions')}><ArrowLeft color="#b5b5bc" size={21} /></HeaderButton> }} />
  </Tabs>
}
