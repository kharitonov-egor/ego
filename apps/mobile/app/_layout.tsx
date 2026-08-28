import '../global.css'
import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SettingsProvider } from '../lib/settings'
import { MoneyProvider } from '../lib/money-context'

export default function RootLayout(): React.ReactElement {
  return (
    <SettingsProvider>
      <MoneyProvider>
        <StatusBar style="light" />
        <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0a0e1a' },
          headerTintColor: '#d8dbe3',
          headerTitleStyle: { fontSize: 16 },
          contentStyle: { backgroundColor: '#0a0e1a' }
        }}
      >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(money)" options={{ headerShown: false }} />
          <Stack.Screen name="capture" options={{ title: 'New Trello card' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          <Stack.Screen name="transaction-image" options={{ title: 'Analyze image' }} />
        </Stack>
      </MoneyProvider>
    </SettingsProvider>
  )
}
