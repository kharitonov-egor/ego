import React from 'react'
import { Pressable, View } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import {
  ArrowLeft, ChartNoAxesCombined, CirclePlus, Landmark, PieChart, ReceiptText, Settings
} from 'lucide-react-native'
import { useMoneyTabBarStyle } from '../../components/money/navigation'
import { SyncButton } from '../../components/money/SyncButton'

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
    <Tabs.Screen name="overview" options={{ title: 'Home', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#fafafa" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <ChartNoAxesCombined color={color} size={22} /> }} />
    <Tabs.Screen name="transactions" options={{ title: 'Activity', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#fafafa" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <ReceiptText color={color} size={22} /> }} />
    <Tabs.Screen name="categories" options={{ title: 'Categories', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#fafafa" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <PieChart color={color} size={22} /> }} />
    <Tabs.Screen name="accounts" options={{ title: 'Accounts', headerLeft: () => <HeaderButton label="Add transaction" onPress={() => router.push({ pathname: '/(money)/transactions', params: { new: 'true' } })}><CirclePlus color="#fafafa" size={22} strokeWidth={2.2} /></HeaderButton>, tabBarIcon: ({ color }) => <Landmark color={color} size={22} /> }} />
    <Tabs.Screen name="budget" options={{ href: null, title: 'Budget', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/overview')}><ArrowLeft color="#d4d4d4" size={21} /></HeaderButton> }} />
    <Tabs.Screen name="transaction" options={{ href: null, title: 'Transaction', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/transactions')}><ArrowLeft color="#d4d4d4" size={21} /></HeaderButton> }} />
    <Tabs.Screen name="purchases" options={{ href: null, title: 'Purchase details', headerLeft: () => <HeaderButton label="Go back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(money)/transactions')}><ArrowLeft color="#d4d4d4" size={21} /></HeaderButton> }} />
  </Tabs>
}
