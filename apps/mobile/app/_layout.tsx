import '../global.css'
import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SettingsProvider } from '../lib/settings'

export default function RootLayout(): React.ReactElement {
  return (
    <SettingsProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0e1a' },
          headerTintColor: '#d8dbe3',
          headerTitleStyle: { fontSize: 16 },
          contentStyle: { backgroundColor: '#0a0e1a' }
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Ego' }} />
        <Stack.Screen name="capture" options={{ title: 'New Trello card' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </SettingsProvider>
  )
}
