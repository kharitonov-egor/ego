import React, { createContext, useContext, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Fingerprint } from 'lucide-react-native'
import { usePrivateLock, type PrivateLock } from '../lib/private-lock'
import { Button } from './ui/button'
import { Text } from './ui/text'

const LockedContext = createContext(false)

/** True while the lock screen covers the page, so open photos and sheets can close themselves. */
export function useLocked(): boolean {
  return useContext(LockedContext)
}

function LockScreen({ label, lock }: { label: string; lock: PrivateLock }): React.ReactElement {
  return <View className="flex-1 items-center justify-center bg-background px-8">
    <Fingerprint color="#a3a3a3" size={44} strokeWidth={1.5} />
    <Text className="mt-4 text-center text-[20px] font-semibold">{label} is locked</Text>
    <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">
      {lock.message ?? 'Use your fingerprint or the phone\'s PIN to open it.'}
    </Text>
    {lock.state === 'checking'
      ? <ActivityIndicator color="#fafafa" className="mt-6" />
      : <Button onPress={lock.unlock} className="mt-6"><Text>Unlock</Text></Button>}
  </View>
}

/**
 * Nothing renders until the first check passes. After that a relock covers the page instead of
 * unmounting it, so a half-typed message and the scroll position survive a trip to another app.
 */
export function PrivateGate({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  const lock = usePrivateLock(label)
  const [opened, setOpened] = useState(false)
  const locked = lock.state !== 'unlocked'
  useEffect(() => {
    if (!locked) setOpened(true)
  }, [locked])
  if (!opened) return <LockScreen label={label} lock={lock} />
  return <LockedContext.Provider value={locked}>
    <View style={{ flex: 1 }}>
      {children}
      {locked && <View style={StyleSheet.absoluteFill}><LockScreen label={label} lock={lock} /></View>}
    </View>
  </LockedContext.Provider>
}
