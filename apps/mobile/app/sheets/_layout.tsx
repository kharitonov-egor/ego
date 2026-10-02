import React from 'react'
import { Stack, useRouter } from 'expo-router'
import { LayoutGrid } from 'lucide-react-native'
import { HeaderButton } from '../../components/HeaderButton'
import { color } from '../../components/money/tokens'

export default function SheetsLayout(): React.ReactElement {
  const router = useRouter()
  return <Stack screenOptions={{
    headerStyle: { backgroundColor: color.screen },
    headerTintColor: color.text,
    headerShadowVisible: false,
    headerTitleStyle: { fontSize: 17, fontWeight: '700' },
    contentStyle: { backgroundColor: color.screen }
  }}>
    <Stack.Screen name="index" options={{
      title: 'Sheets',
      headerTitleAlign: 'center',
      headerLeft: () => <HeaderButton label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color="#fafafa" size={21} /></HeaderButton>
    }} />
    <Stack.Screen name="[id]" options={{ title: '' }} />
    <Stack.Screen name="row/[id]" options={{ title: '' }} />
  </Stack>
}
