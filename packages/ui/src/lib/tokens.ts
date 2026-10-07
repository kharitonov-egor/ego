/**
 * The phone's palette for places a class name cannot reach: icons, SVG, inline styles.
 * tailwind.config.js holds the same values.
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

export const amountColor = (kind: 'income' | 'expense' | 'transfer'): string =>
  kind === 'income' ? color.positive : kind === 'transfer' ? color.textMuted : color.expense

export const amountSign = (kind: 'income' | 'expense' | 'transfer'): string =>
  kind === 'income' ? '+' : kind === 'expense' ? '-' : ''

/** Bold fintech surfaces: wide radii, one flat panel, no hairline boxes inside boxes. */
export const CARD = 'rounded-3xl border border-border bg-card'
export const CARD_PADDING = 'p-5'
export const HERO_AMOUNT = 'text-[40px] font-bold tracking-tight'
export const SECTION_TITLE = 'text-[20px] font-semibold text-foreground'
