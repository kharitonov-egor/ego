import React from 'react'
import { Stack } from 'expo-router'
import { color } from '../../components/money/tokens'

export default function GymLayout(): React.ReactElement {
  return <Stack screenOptions={{
    headerStyle: { backgroundColor: color.screen },
    headerTintColor: color.text,
    headerShadowVisible: false,
    headerTitleStyle: { fontSize: 17, fontWeight: '700' },
    contentStyle: { backgroundColor: color.screen }
  }}>
    <Stack.Screen name="index" options={{ title: 'Gym' }} />
    <Stack.Screen name="calendar" options={{ title: 'Calendar' }} />
    <Stack.Screen name="exercises" options={{ title: 'All exercises' }} />
    <Stack.Screen name="exercise-editor" options={{ title: 'Exercise' }} />
    <Stack.Screen name="track" options={{ title: '' }} />
  </Stack>
}
