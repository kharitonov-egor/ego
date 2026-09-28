import React from 'react'
import { Pressable, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import {
  ArrowLeft, ChartNoAxesCombined, CirclePlus, LayoutGrid, PieChart, PiggyBank, ReceiptText, Settings
} from 'lucide-react-native'
import { useMoneyTabBarStyle } from '../../components/money/navigation'
import { SyncButton } from '../../components/money/SyncButton'
import { HeaderButton } from '../../components/HeaderButton'

export default function MoneyTabs(): React.ReactElement {
  const router = useRouter()
  const tabBarStyle = useMoneyTabBarStyle()
  const financeLeft = (): React.ReactElement => <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    <HeaderButton label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderButton>
    <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#fafafa" size={22} strokeWidth={2.2} /></HeaderButton>
  </View>
  return <Tabs initialRouteName="overview" screenOptions={{
    headerStyle: { backgroundColor: '#0a0a0a' },
    headerTitleContainerStyle: { paddingVertical: 0 },
    headerTintColor: '#fafafa',
    headerShadowVisible: false,
    headerTitleAlign: 'center',
    headerTitleStyle: { fontSize: 17, fontWeight: '700' },
    sceneStyle: { backgroundColor: '#0a0a0a' },
    tabBarStyle,
    tabBarActiveTintColor: '#fafafa',
    tabBarInactiveTintColor: '#737373',
    tabBarLabelStyle: { fontSize: 14, fontWeight: '600', paddingBottom: 2 },
    tabBarIconStyle: { marginTop: 1 },
    headerRight: () => <View style={{ marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <SyncButton />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => router.push('/settings')}
        hitSlop={8}
        style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
      ><Settings color="#d4d4d4" size={21} /></Pressable>
    </View>
  }}>
    <Tabs.Screen name="overview" options={{ title: 'Home', headerLeft: financeLeft, tabBarIcon: ({ color }) => <ChartNoAxesCombined color={color} size={22} /> }} />
    <Tabs.Screen name="transactions" options={{ title: 'Activity', headerLeft: financeLeft, tabBarIcon: ({ color }) => <ReceiptText color={color} size={22} /> }} />
    <Tabs.Screen name="categories" options={{ title: 'Categories', headerLeft: financeLeft, tabBarIcon: ({ color }) => <PieChart color={color} size={22} /> }} />
    <Tabs.Screen name="budget" options={{ title: 'Budget', headerLeft: financeLeft, tabBarIcon: ({ color }) => <PiggyBank color={color} size={22} /> }} />
    <Tabs.Screen name="accounts" options={{ href: null, title: 'Accounts', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/overview')}><ArrowLeft color="#d4d4d4" size={21} /></HeaderButton> }} />
    <Tabs.Screen name="transaction" options={{ href: null, title: 'Transaction', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/transactions')}><ArrowLeft color="#d4d4d4" size={21} /></HeaderButton> }} />
    <Tabs.Screen name="purchases" options={{ href: null, title: 'Purchase details', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/transactions')}><ArrowLeft color="#d4d4d4" size={21} /></HeaderButton> }} />
  </Tabs>
}
