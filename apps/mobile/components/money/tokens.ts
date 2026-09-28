import { AccessibilityInfo, Platform, type TextStyle } from 'react-native'
import { useEffect, useState } from 'react'

/**
 * The money palette for places a class name cannot reach: icons, SVG, navigation options.
 * tailwind.config.js holds the same values. Dark is the canvas these values were chosen against,
 * not an inversion of a light theme.
 */
export const color = {
  screen: '#0a0a0a',
  surface: '#141414',
  surfaceRaised: '#1c1c1c',
  line: '#262626',
  text: '#fafafa',
  textSecondary: '#d4d4d4',
  textMuted: '#a3a3a3',
  textFaint: '#737373',
  accent: '#fafafa',
  accentSurface: 'rgba(250, 250, 250, 0.12)',
  positive: '#34d399',
  /** Money going out. A warmer red than destructive, so a spent amount never reads as a delete button. */
  expense: '#f87171',
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
  kind === 'income' ? color.positive : kind === 'transfer' ? color.textMuted : color.expense

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

/** Bold fintech surfaces: wide radii, one flat panel, no hairline boxes inside boxes. */
export const CARD = 'rounded-3xl border border-border bg-card'
export const CARD_PADDING = 'p-5'
export const HERO_AMOUNT = 'text-[40px] font-bold tracking-tight'
export const SECTION_TITLE = 'text-[20px] font-semibold text-foreground'
