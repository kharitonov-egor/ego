import React, { useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, View } from 'react-native'
import { Undo2 } from 'lucide-react-native'
import { SAVE_DELAY_MS } from '@ego/core'
import { color } from '../money/tokens'
import { Text } from './text'

export { SAVE_DELAY_MS }

/**
 * Runs the bar down over `SAVE_DELAY_MS` from when `runKey` appears or the card stops being paused,
 * then calls `onElapsed` if there is one. A pause throws the time away, so coming back from an
 * edit gives the full delay again. Without `onElapsed` the card only shows time that something
 * else is keeping.
 */
export function useSaveCountdown(runKey: string, paused: boolean, onElapsed?: () => void): Animated.Value {
  const progress = useRef(new Animated.Value(1)).current
  const elapsed = useRef(onElapsed)
  elapsed.current = onElapsed
  useEffect(() => {
    progress.setValue(1)
    if (paused) return
    const animation = Animated.timing(progress, {
      toValue: 0, duration: SAVE_DELAY_MS, easing: Easing.linear, useNativeDriver: true
    })
    animation.start()
    const timer = setTimeout(() => elapsed.current?.(), SAVE_DELAY_MS)
    return () => {
      clearTimeout(timer)
      animation.stop()
    }
  }, [paused, progress, runKey])
  return progress
}

export function CountdownBar({ progress }: { progress: Animated.Value }): React.ReactElement {
  return <View className="h-1 overflow-hidden rounded-full bg-surface-800">
    <Animated.View style={{ height: '100%', backgroundColor: color.text, transformOrigin: 'left', transform: [{ scaleX: progress }] }} />
  </View>
}

/**
 * The top of every card that saves itself: what is about to happen, the bar running down, and
 * the only way to stop it.
 */
export function SaveCountdown({ runKey, paused, label, onElapsed, onUndo }: {
  runKey: string
  paused: boolean
  label: string
  onElapsed?: () => void
  onUndo: () => void
}): React.ReactElement {
  const progress = useSaveCountdown(runKey, paused, onElapsed)
  return <View>
    <View className="flex-row items-center">
      <Text accessibilityLiveRegion="polite" className="flex-1 text-[14px] font-medium text-muted-foreground">
        {paused ? 'Waiting for your edit' : label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo"
        accessibilityHint="Stops this before it saves"
        onPress={onUndo}
        hitSlop={8}
        className="min-h-11 flex-row items-center gap-1.5 rounded-full border border-surface-700 px-4 active:bg-surface-800"
      >
        <Undo2 color={color.textSecondary} size={16} />
        <Text className="text-[15px] font-semibold">Undo</Text>
      </Pressable>
    </View>
    <View className="mt-3"><CountdownBar progress={progress} /></View>
  </View>
}
