import '../global.css'
import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SettingsProvider } from '../lib/settings'
import { MoneyProvider } from '../lib/money-context'
import { PeriodProvider } from '../lib/period-context'

export default function RootLayout(): React.ReactElement {
  return (
    <SettingsProvider>
      <MoneyProvider>
        <PeriodProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: '#1c1d1f' },
              headerTintColor: '#e6e6e8',
              headerTitleStyle: { fontSize: 17, fontWeight: '700' },
              contentStyle: { backgroundColor: '#121214' }
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(money)" options={{ headerShown: false }} />
            <Stack.Screen name="capture" options={{ title: 'New Trello card' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
            <Stack.Screen name="transaction-image" options={{ title: 'Money agent' }} />
          </Stack>
        </PeriodProvider>
      </MoneyProvider>
    </SettingsProvider>
  )
}
