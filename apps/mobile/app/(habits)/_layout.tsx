import React from 'react'
import { Tabs, useRouter } from 'expo-router'
import { Ban, CalendarDays, House, LayoutGrid } from 'lucide-react-native'
import { HabitEditorHost } from '../../components/habits/HabitEditor'
import { HabitsHeaderRight } from '../../components/habits/ui'
import { HeaderButton } from '../../components/HeaderButton'
import { useMoneyTabBarStyle } from '../../components/money/navigation'
import { HabitsProvider } from '../../lib/habits/context'

export default function HabitsTabs(): React.ReactElement {
  const router = useRouter()
  const tabBarStyle = useMoneyTabBarStyle()
  return <HabitsProvider>
    <Tabs initialRouteName="home" screenOptions={{
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
      <Tabs.Screen name="home" options={{
        title: 'Habits',
        tabBarLabel: 'Home',
        tabBarIcon: ({ color }) => <House color={color} size={22} />,
        headerRight: () => <HabitsHeaderRight add="build" />
      }} />
      <Tabs.Screen name="progress" options={{
        title: 'Progress',
        tabBarIcon: ({ color }) => <CalendarDays color={color} size={22} />,
        headerRight: () => <HabitsHeaderRight />
      }} />
      <Tabs.Screen name="quit" options={{
        title: 'Quit',
        tabBarIcon: ({ color }) => <Ban color={color} size={22} />,
        headerRight: () => <HabitsHeaderRight add="break" />
      }} />
    </Tabs>
    <HabitEditorHost />
  </HabitsProvider>
}
