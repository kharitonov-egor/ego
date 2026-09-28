import React from 'react'
import { Pressable } from 'react-native'
import { Tabs, useRouter } from 'expo-router'
import { GraduationCap, LayoutGrid, ListChecks, Settings } from 'lucide-react-native'
import { useMoneyTabBarStyle } from '../../components/money/navigation'
import { HeaderButton } from '../../components/HeaderButton'
import { StudyProvider } from '../../lib/study/context'

export default function StudyTabs(): React.ReactElement {
  const router = useRouter()
  const tabBarStyle = useMoneyTabBarStyle()
  return <StudyProvider>
    <Tabs initialRouteName="assignments" screenOptions={{
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
      headerLeft: () => <HeaderButton label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderButton>,
      headerRight: () => <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        onPress={() => router.push('/settings')}
        hitSlop={8}
        style={{ marginRight: 8, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
      ><Settings color="#d4d4d4" size={21} /></Pressable>
    }}>
      <Tabs.Screen name="assignments" options={{ title: 'Assignments', tabBarIcon: ({ color }) => <ListChecks color={color} size={22} /> }} />
      <Tabs.Screen name="courses" options={{ title: 'Courses', tabBarIcon: ({ color }) => <GraduationCap color={color} size={22} /> }} />
    </Tabs>
  </StudyProvider>
}
