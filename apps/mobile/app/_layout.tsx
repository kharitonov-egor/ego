import '../global.css'
import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SettingsProvider } from '../lib/settings'
import { MoneyProvider } from '../lib/money-context'
import { LedgerProvider } from '../lib/ledger-context'
import { PeriodProvider } from '../lib/period-context'
import { ReminderProvider } from '../lib/reminder-context'
import { GymProvider } from '../lib/gym-context'
import { RestTimerProvider } from '../lib/rest-timer'

export default function RootLayout(): React.ReactElement {
  return (
    <SettingsProvider>
      <LedgerProvider>
        <MoneyProvider>
          <GymProvider>
            <RestTimerProvider>
              <PeriodProvider>
                <ReminderProvider>
                  <StatusBar style="light" />
                  <Stack
                    screenOptions={{
                      headerStyle: { backgroundColor: '#0a0a0a' },
                      headerTintColor: '#fafafa',
                      headerTitleStyle: { fontSize: 17, fontWeight: '700' },
                      contentStyle: { backgroundColor: '#0a0a0a' }
                    }}
                  >
                    <Stack.Screen name="index" options={{ headerShown: false }} />
                    <Stack.Screen name="(money)" options={{ headerShown: false }} />
                    <Stack.Screen name="gym" options={{ headerShown: false }} />
                    <Stack.Screen name="health" options={{ title: 'Health', headerTitleAlign: 'center' }} />
                    <Stack.Screen name="(study)" options={{ headerShown: false }} />
                    <Stack.Screen name="capture" options={{ title: 'New Trello card' }} />
                    <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                    <Stack.Screen name="auth" options={{ title: 'Sign in', headerShown: false }} />
                    <Stack.Screen name="transaction-image" options={{ title: 'Money agent' }} />
                  </Stack>
                </ReminderProvider>
              </PeriodProvider>
            </RestTimerProvider>
          </GymProvider>
        </MoneyProvider>
      </LedgerProvider>
    </SettingsProvider>
  )
}
