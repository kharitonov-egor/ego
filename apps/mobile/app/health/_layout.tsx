import React from 'react'
import { Stack } from 'expo-router'
import { color } from '../../components/money/tokens'
import { HealthProvider } from '../../lib/health/context'

export default function HealthLayout(): React.ReactElement {
  return <HealthProvider>
    <Stack screenOptions={{
      headerStyle: { backgroundColor: color.screen },
      headerTintColor: color.text,
      headerShadowVisible: false,
      headerTitleAlign: 'center',
      headerTitleStyle: { fontSize: 17, fontWeight: '700' },
      contentStyle: { backgroundColor: color.screen }
    }}>
      <Stack.Screen name="index" options={{ title: 'Health' }} />
      <Stack.Screen name="[metric]" options={{ title: '' }} />
    </Stack>
  </HealthProvider>
}
