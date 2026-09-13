import { AccessibilityInfo, Platform, type TextStyle } from 'react-native'
import { useEffect, useState } from 'react'

/**
 * The money palette, written once. Dark is the canvas these values were chosen against, not an
 * inversion of a light theme.
 */
export const color = {
  screen: '#121214',
  surface: '#1c1d1f',
  surfaceRaised: '#232426',
  line: '#2a2b2e',
  text: '#e6e6e8',
  textSecondary: '#b5b5bc',
  textMuted: '#8a8a92',
  accent: '#91c4ff',
  accentSurface: 'rgba(145, 196, 255, 0.16)',
  positive: '#34d399',
  /** Red belongs to destructive actions and failures, not to ordinary spending. */
  destructive: '#fb7185',
  attention: '#fbbf24'
} as const

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const

export const type = {
  meta: 14,
  body: 16,
  screen: 20,
  amount: 32
} as const

/** 48 clears both the 44pt and the 48dp minimum, so one number covers both platforms. */
export const TOUCH = 48
export const ROW_MIN_HEIGHT = 64

/** Amounts line up column by column only with tabular figures. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] }

export const amountColor = (kind: 'income' | 'expense' | 'transfer'): string =>
  kind === 'income' ? color.positive : kind === 'transfer' ? color.accent : color.text

export const amountSign = (kind: 'income' | 'expense' | 'transfer'): string =>
  kind === 'income' ? '+' : kind === 'expense' ? '-' : ''

/**
 * Respects the system setting, so a sheet appears without sliding for anyone who asked for
 * less motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  return reduced
}

export const sheetAnimation = (reduced: boolean): 'none' | 'slide' =>
  reduced ? 'none' : 'slide'

/** Android renders semibold as 600; iOS wants the numeric weight for the same stroke. */
export const semibold: TextStyle = Platform.select({
  ios: { fontWeight: '600' },
  default: { fontWeight: '600' }
}) as TextStyle
