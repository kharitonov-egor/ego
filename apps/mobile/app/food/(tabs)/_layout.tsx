import React from 'react'
import { Tabs, useRouter } from 'expo-router'
import { LayoutGrid, NotebookPen, Refrigerator } from 'lucide-react-native'
import { HeaderButton } from '../../../components/HeaderButton'
import { useMoneyTabBarStyle } from '../../../components/money/navigation'

export default function FoodTabs(): React.ReactElement {
  const router = useRouter()
  const tabBarStyle = useMoneyTabBarStyle()
  return <Tabs initialRouteName="index" screenOptions={{
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
    headerLeft: () => <HeaderButton label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderButton>
  }}>
    <Tabs.Screen name="index" options={{
      title: 'Food',
      tabBarLabel: 'Log',
      tabBarIcon: ({ color }) => <NotebookPen color={color} size={22} />
    }} />
    <Tabs.Screen name="fridge" options={{
      title: 'Fridge',
      tabBarIcon: ({ color }) => <Refrigerator color={color} size={22} />
    }} />
  </Tabs>
}
