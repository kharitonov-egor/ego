import React from 'react'
import { Stack } from 'expo-router'
import { color } from '../../components/money/tokens'
import { CalendarProvider } from '../../lib/calendar/context'

export default function CalendarLayout(): React.ReactElement {
  return <CalendarProvider>
    <Stack screenOptions={{
      headerStyle: { backgroundColor: color.screen },
      headerTintColor: color.text,
      headerShadowVisible: false,
      headerTitleStyle: { fontSize: 17, fontWeight: '700' },
      contentStyle: { backgroundColor: color.screen }
    }}>
      <Stack.Screen name="index" options={{ title: 'Calendar' }} />
    </Stack>
  </CalendarProvider>
}
