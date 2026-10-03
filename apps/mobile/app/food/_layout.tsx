import React from 'react'
import { Stack } from 'expo-router'
import { color } from '../../components/money/tokens'

export default function FoodLayout(): React.ReactElement {
  return <Stack screenOptions={{
    headerStyle: { backgroundColor: color.screen },
    headerTintColor: color.text,
    headerShadowVisible: false,
    headerTitleStyle: { fontSize: 17, fontWeight: '700' },
    contentStyle: { backgroundColor: color.screen }
  }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
    <Stack.Screen name="entry/[id]" options={{ title: '' }} />
  </Stack>
}
