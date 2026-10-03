/** Black canvas, graphite bubbles, white ink. Nothing in the diary uses a hue except a failure. */
export const ink = {
  screen: '#0a0a0a',
  bubble: '#1c1c1c',
  bubbleEdge: '#2a2a2a',
  flash: '#3a3a3a',
  tile: '#262626',
  text: '#fafafa',
  secondary: '#d4d4d4',
  meta: '#a3a3a3',
  faint: '#737373',
  line: '#333333',
  scrim: 'rgba(0, 0, 0, 0.55)',
  failed: '#fb7185'
} as const

/** Bubbles keep to the right of the column, Telegram's Saved Messages on a wide screen. Media fill this width. */
export const BUBBLE_WIDTH = 440
/** A text-only bubble grows with its text up to here. */
export const TEXT_MAX_WIDTH = 560
export const MEDIA_MAX_HEIGHT = 380
export const MEDIA_MIN_HEIGHT = 140
