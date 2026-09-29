import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { PixelRatio, Platform, Text, type TextStyle } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const STORE_KEY = 'ego.blur'
const INK = '#fafafa'

function translucent(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = parseInt(match[1], 16)
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, 0.8)`
}

/** React Native hands the radius to Android as pixels and to iOS as points. */
const RADIUS_SCALE = Platform.OS === 'android' ? PixelRatio.get() : 1

/**
 * Clear ink with a soft shadow where the glyphs were reads as blurred text. The shadow color has
 * to stay translucent: Android gives an opaque shadow the ink's alpha, which is zero here.
 * `radius` is in dp.
 */
export function blurredText(tint: string = INK, radius = 6): TextStyle {
  return {
    color: 'transparent',
    textShadowColor: translucent(tint),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: radius * RADIUS_SCALE
  }
}

interface BlurValue {
  blurred: boolean
  setBlurred: (on: boolean) => void
}

const BlurContext = createContext<BlurValue | null>(null)

/** Demo mode: personal numbers and entries blur until it is switched off in Settings. */
export function BlurProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [blurred, setBlurredState] = useState(false)
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY)
      .then((raw) => { if (active && raw === '1') setBlurredState(true) })
      .catch(() => undefined)
    return () => { active = false }
  }, [])
  const setBlurred = useCallback((on: boolean): void => {
    setBlurredState(on)
    void SecureStore.setItemAsync(STORE_KEY, on ? '1' : '0').catch(() => undefined)
  }, [])
  const value = useMemo(() => ({ blurred, setBlurred }), [blurred, setBlurred])
  return <BlurContext.Provider value={value}>{children}</BlurContext.Provider>
}

export function useBlur(): BlurValue {
  const context = useContext(BlurContext)
  if (!context) throw new Error('useBlur must be used inside BlurProvider')
  return context
}

/** The style for a Text that holds personal data: blurred while Blur is on, nothing otherwise. */
export function useBlurText(): (tint?: string, radius?: number) => TextStyle | undefined {
  const { blurred } = useBlur()
  return useCallback((tint?: string, radius?: number) => blurred ? blurredText(tint, radius) : undefined, [blurred])
}

/** Stands in for an icon that would give the data away, such as a mood's face or a habit's emoji. */
export function BlurBlob({ size, tint = '#a3a3a3' }: { size: number; tint?: string }): React.ReactElement {
  return <Text
    accessible={false}
    importantForAccessibility="no"
    style={[{ fontSize: size, lineHeight: Math.round(size * 1.2) }, blurredText(tint, Math.round(size / 3))]}
  >●</Text>
}

/** An amount or name in the middle of a sentence. It inherits the sentence's type and blurs alone. */
export function BlurSpan({ tint, children }: { tint?: string; children: React.ReactNode }): React.ReactElement {
  const blur = useBlurText()
  return <Text style={blur(tint)}>{children}</Text>
}
