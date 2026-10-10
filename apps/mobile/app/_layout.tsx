import '../global.css'
import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SettingsProvider } from '../lib/settings'
import { BlurProvider } from '../lib/blur'
import { MoneyProvider } from '../lib/money-context'
import { LedgerProvider } from '../lib/ledger-context'
import { PeriodProvider } from '../lib/period-context'
import { ReminderProvider } from '../lib/reminder-context'
import { GymProvider } from '../lib/gym-context'
import { RestTimerProvider } from '../lib/rest-timer'
import { TasksProvider } from '../lib/tasks/context'
import { TaskNotificationsProvider } from '../lib/tasks/notifications'
import { SheetsProvider } from '../lib/sheets/context'
import { FoodProvider } from '../lib/food/context'
import { KeyboardViewport } from '../components/ui/keyboard'

function Screens(): React.ReactElement {
  return <KeyboardViewport style={{ backgroundColor: '#0a0a0a' }}>
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
      <Stack.Screen name="health" options={{ headerShown: false }} />
      <Stack.Screen name="mood" options={{ title: 'Mood', headerTitleAlign: 'center' }} />
      <Stack.Screen name="diary" options={{ title: 'Diary', headerTitleAlign: 'center' }} />
      <Stack.Screen name="(study)" options={{ headerShown: false }} />
      <Stack.Screen name="(habits)" options={{ headerShown: false }} />
      <Stack.Screen name="tasks" options={{ headerShown: false }} />
      <Stack.Screen name="sheets" options={{ headerShown: false }} />
      <Stack.Screen name="food" options={{ headerShown: false }} />
      <Stack.Screen name="calendar" options={{ headerShown: false }} />
      <Stack.Screen name="content" options={{ title: 'Content' }} />
      <Stack.Screen name="capture" options={{ title: 'New card in Inbox' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="auth" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="ai" options={{ title: 'AI', headerTitleAlign: 'center' }} />
    </Stack>
  </KeyboardViewport>
}

export default function RootLayout(): React.ReactElement {
  return (
    <SettingsProvider>
      <BlurProvider>
        <LedgerProvider>
          <MoneyProvider>
            <GymProvider>
              <RestTimerProvider>
                <PeriodProvider>
                  <ReminderProvider>
                    <TasksProvider>
                      <TaskNotificationsProvider>
                        <SheetsProvider>
                          <FoodProvider>
                            <Screens />
                          </FoodProvider>
                        </SheetsProvider>
                      </TaskNotificationsProvider>
                    </TasksProvider>
                  </ReminderProvider>
                </PeriodProvider>
              </RestTimerProvider>
            </GymProvider>
          </MoneyProvider>
        </LedgerProvider>
      </BlurProvider>
    </SettingsProvider>
  )
}
