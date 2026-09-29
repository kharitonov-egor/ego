import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as LocalAuthentication from 'expo-local-authentication'

/**
 * Mood and Diary ask for a fingerprint, or the phone's PIN, each time they open and each time the
 * app comes back from the background. A photo picker, the camera, or another app opening a file
 * also sends Ego to the background, so those trips go through `outsideApp` and do not lock.
 */

let trips = 0
let lastTripEnded = 0
/** Android can report the return a moment after the picker's promise settles. */
const TRIP_GRACE_MS = 1500
/** Shorter visits, like a permission dialog flickering the app state, do not count as leaving. */
const AWAY_THRESHOLD_MS = 1000

export async function outsideApp<T>(work: () => Promise<T>): Promise<T> {
  trips += 1
  try {
    return await work()
  } finally {
    trips -= 1
    lastTripEnded = Date.now()
  }
}

function onTrip(): boolean {
  return trips > 0 || Date.now() - lastTripEnded < TRIP_GRACE_MS
}

export type LockState = 'checking' | 'locked' | 'unlocked'

export interface PrivateLock {
  state: LockState
  /** Why the last attempt did not unlock, in words for the lock screen. */
  message: string | null
  unlock: () => void
}

export function usePrivateLock(label: string): PrivateLock {
  const [state, setState] = useState<LockState>('checking')
  const [message, setMessage] = useState<string | null>(null)
  const prompting = useRef(false)
  const leftAt = useRef<number | null>(null)

  const unlock = useCallback(() => {
    if (prompting.current) return
    prompting.current = true
    setState('checking')
    void (async () => {
      try {
        const level = await LocalAuthentication.getEnrolledLevelAsync()
        if (level === LocalAuthentication.SecurityLevel.NONE) {
          setMessage(null)
          setState('unlocked')
          return
        }
        const result = await outsideApp(() => LocalAuthentication.authenticateAsync({
          promptMessage: `Unlock ${label}`,
          cancelLabel: 'Cancel',
          disableDeviceFallback: false
        }))
        if (result.success) {
          setMessage(null)
          setState('unlocked')
          return
        }
        setMessage(result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel'
          ? null
          : result.error === 'lockout' ? 'Too many tries. Unlock the phone with its PIN, then try again.' : 'That did not match.')
        setState('locked')
      } catch {
        setMessage('This phone could not check your fingerprint.')
        setState('locked')
      } finally {
        prompting.current = false
      }
    })()
  }, [label])

  useEffect(() => {
    unlock()
  }, [unlock])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        leftAt.current = onTrip() ? null : Date.now()
        return
      }
      if (next !== 'active') return
      const away = leftAt.current
      leftAt.current = null
      if (away === null || onTrip() || prompting.current) return
      if (Date.now() - away < AWAY_THRESHOLD_MS) return
      unlock()
    })
    return () => subscription.remove()
  }, [unlock])

  return { state, message, unlock }
}
