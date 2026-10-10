import React from 'react'
import { Stack } from 'expo-router'
import { color } from '../../components/money/tokens'

export default function TasksLayout(): React.ReactElement {
  return <Stack screenOptions={{
    headerStyle: { backgroundColor: color.screen },
    headerTintColor: color.text,
    headerShadowVisible: false,
    headerTitleStyle: { fontSize: 17, fontWeight: '700' },
    contentStyle: { backgroundColor: color.screen }
  }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="home" options={{ title: '', animation: 'none' }} />
    <Stack.Screen name="board/[id]" options={{ title: '' }} />
    <Stack.Screen name="card/[id]" options={{ title: '' }} />
    <Stack.Screen name="goal/[id]" options={{ title: '' }} />
    <Stack.Screen name="archive/[id]" options={{ title: 'Archived items' }} />
    <Stack.Screen name="activity/[id]" options={{ title: 'Activity' }} />
  </Stack>
}
