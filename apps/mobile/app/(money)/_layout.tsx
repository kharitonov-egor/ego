import React from 'react'
import { Pressable } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import {
  ChartNoAxesCombined, CirclePlus, Landmark, PiggyBank, ReceiptText, Settings
} from 'lucide-react-native'
import { moneyTabBarStyle } from '../../components/money/navigation'

export default function MoneyTabs(): React.ReactElement {
  const router = useRouter()
  return <Tabs initialRouteName="overview" screenOptions={{
    headerStyle: { backgroundColor: '#1c1d1f' },
    headerTintColor: '#e6e6e8',
    headerTitleAlign: 'center',
    headerTitleStyle: { fontSize: 24, fontWeight: '700' },
    sceneStyle: { backgroundColor: '#121214' },
    tabBarStyle: moneyTabBarStyle,
    tabBarActiveTintColor: '#91c4ff',
    tabBarInactiveTintColor: '#909099',
    tabBarLabelStyle: { fontSize: 16, fontWeight: '700', paddingBottom: 2 },
    tabBarIconStyle: { marginTop: 1 },
    headerLeft: () => <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add transaction"
      onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}
      hitSlop={12}
      style={{ marginLeft: 18 }}
    ><CirclePlus color="#91c4ff" size={29} strokeWidth={2.2} /></Pressable>,
    headerRight: () => <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open settings"
      onPress={() => router.push('/settings')}
      hitSlop={12}
      style={{ marginRight: 18 }}
    ><Settings color="#b5b5bc" size={27} /></Pressable>
  }}>
    <Tabs.Screen name="overview" options={{ title: 'Home', tabBarIcon: ({ color }) => <ChartNoAxesCombined color={color} size={30} /> }} />
    <Tabs.Screen name="transactions" options={{ title: 'Activity', tabBarIcon: ({ color }) => <ReceiptText color={color} size={30} /> }} />
    <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color }) => <PiggyBank color={color} size={30} /> }} />
    <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color }) => <Landmark color={color} size={30} /> }} />
    <Tabs.Screen name="categories" options={{ href: null, title: 'Categories' }} />
    <Tabs.Screen name="purchases" options={{ href: null, title: 'Purchase details' }} />
  </Tabs>
}
