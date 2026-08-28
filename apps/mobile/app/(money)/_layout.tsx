import React from 'react'
import { Pressable } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import {
  ChartNoAxesCombined, Landmark, ListPlus, PiggyBank, ReceiptText, ScanLine, Settings, Tags
} from 'lucide-react-native'
import { moneyTabBarStyle } from '../../components/money/navigation'

export default function MoneyTabs(): React.ReactElement {
  const router = useRouter()
  return <Tabs screenOptions={{
    headerStyle: { backgroundColor: '#0a0e1a' },
    headerTintColor: '#d8dbe3',
    headerTitleStyle: { fontSize: 17 },
    sceneStyle: { backgroundColor: '#0a0e1a' },
    tabBarStyle: moneyTabBarStyle,
    tabBarActiveTintColor: '#60a5fa',
    tabBarInactiveTintColor: '#636f8f',
    tabBarLabelStyle: { fontSize: 10, paddingBottom: 5 },
    headerLeft: () => <Pressable onPress={() => router.push('/capture')} hitSlop={12} style={{ marginLeft: 16 }}><ListPlus color="#8a93ab" size={21} /></Pressable>,
    headerRight: () => <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={{ marginRight: 16 }}><Settings color="#8a93ab" size={20} /></Pressable>
  }}>
    <Tabs.Screen name="accounts" options={{ title: 'Accounts', tabBarIcon: ({ color, size }) => <Landmark color={color} size={size} /> }} />
    <Tabs.Screen name="categories" options={{ title: 'Categories', tabBarIcon: ({ color, size }) => <Tags color={color} size={size} /> }} />
    <Tabs.Screen name="transactions" options={{ title: 'Transactions', tabBarIcon: ({ color, size }) => <ReceiptText color={color} size={size} /> }} />
    <Tabs.Screen name="purchases" options={{ title: 'Purchases', tabBarIcon: ({ color, size }) => <ScanLine color={color} size={size} /> }} />
    <Tabs.Screen name="budget" options={{ title: 'Budget', tabBarIcon: ({ color, size }) => <PiggyBank color={color} size={size} /> }} />
    <Tabs.Screen name="overview" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <ChartNoAxesCombined color={color} size={size} /> }} />
  </Tabs>
}
