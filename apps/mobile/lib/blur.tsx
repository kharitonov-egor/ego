import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  PixelRatio, Platform, Text,
  type LayoutChangeEvent, type LayoutRectangle, type NativeSyntheticEvent, type TextLayoutEventData, type TextProps,
  type TextStyle
} from 'react-native'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import * as SecureStore from 'expo-secure-store'

const STORE_KEY = 'ego.blur'
const INK = '#fafafa'

/** React Native on Android reads a zero color as unset and paints the default black, so the ink keeps one step of alpha. */
const CLEAR_INK = 'rgba(0, 0, 0, 0.004)'
/** React Native hands the shadow radius to Android as pixels and to iOS as points. */
const RADIUS_SCALE = Platform.OS === 'android' ? PixelRatio.get() : 1
/** Roboto's capital T is 0.711 of the font size, which recovers the size a Text drew at after shrinking to fit. */
const CAP_HEIGHT_RATIO = 0.711

type TextLine = TextLayoutEventData['lines'][number]

function translucent(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = parseInt(match[1], 16)
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

/**
 * Clear ink with a soft shadow where the glyphs were. Android gives an opaque shadow the ink's
 * alpha, so the shadow color stays translucent. `radius` is in dp.
 */
function glow(tint: string, radius: number, alpha: number): TextStyle {
  return {
    color: CLEAR_INK,
    textShadowColor: translucent(tint, alpha),
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

/**
 * One line of the hidden text, drawn again as a glow in a box wider and taller than the line.
 * Android clips a Text's drawing to its own box, so a glow drawn in the original box ends in a
 * hard edge; the margin here lets it fade out.
 */
function SmudgeLine({ frame, line, tint }: { frame: LayoutRectangle; line: TextLine; tint: string }): React.ReactElement | null {
  const text = line.text.trim()
  if (!text) return null
  const fontSize = line.capHeight > 0 ? line.capHeight / CAP_HEIGHT_RATIO : line.height / 1.3
  const radius = fontSize * 0.4
  const bleed = Math.ceil(radius * 1.8)
  const height = line.height + bleed * 2
  return <Text
    accessible={false}
    importantForAccessibility="no"
    numberOfLines={1}
    adjustsFontSizeToFit
    style={[{
      position: 'absolute',
      left: frame.x + line.x - bleed,
      top: frame.y + line.y - bleed,
      width: line.width + bleed * 2,
      height,
      lineHeight: height,
      fontSize,
      fontWeight: '600',
      textAlign: 'center',
      textAlignVertical: 'center'
    }, glow(tint, radius, 0.75)]}
  >{text}</Text>
}

/**
 * Wraps one Text that holds personal data. While Blur is on, the Text keeps its place but turns
 * invisible, and a blurred copy of each of its lines is drawn over it.
 */
export function Blurred({ tint = INK, active = true, children }: {
  tint?: string
  active?: boolean
  children: React.ReactElement<TextProps>
}): React.ReactElement {
  const { blurred } = useBlur()
  const [frame, setFrame] = useState<LayoutRectangle | null>(null)
  const [lines, setLines] = useState<readonly TextLine[]>([])
  const on = blurred && active
  if (!on) return <>{React.cloneElement(children, { key: 'plain' })}</>
  const { style, onLayout, onTextLayout } = children.props
  const measured = React.cloneElement(children, {
    key: 'blurred',
    style: [style, { opacity: 0 }],
    onLayout: (event: LayoutChangeEvent) => {
      onLayout?.(event)
      setFrame(event.nativeEvent.layout)
    },
    onTextLayout: (event: NativeSyntheticEvent<TextLayoutEventData>) => {
      onTextLayout?.(event)
      setLines(event.nativeEvent.lines)
    }
  })
  return <>
    {measured}
    {frame && lines
      .filter((line) => line.y < frame.height)
      .map((line, index) => <SmudgeLine key={`line-${index}`} frame={frame} line={line} tint={tint} />)}
  </>
}

/** An amount or name in the middle of a sentence. It inherits the sentence's type and blurs alone. */
export function BlurSpan({ tint = INK, children }: { tint?: string; children: React.ReactNode }): React.ReactElement {
  const { blurred } = useBlur()
  return <Text style={blurred ? glow(tint, 3, 0.7) : undefined}>{children}</Text>
}

/** Stands in for an icon that would give the data away, such as a mood's face or a habit's emoji. */
export function BlurBlob({ size, tint = '#a3a3a3' }: { size: number; tint?: string }): React.ReactElement {
  const half = size / 2
  return <Svg width={size} height={size} accessible={false} pointerEvents="none">
    <Defs>
      <RadialGradient id="blob" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={tint} stopOpacity={0.6} />
        <Stop offset="0.5" stopColor={tint} stopOpacity={0.35} />
        <Stop offset="1" stopColor={tint} stopOpacity={0} />
      </RadialGradient>
    </Defs>
    <Circle cx={half} cy={half} r={half} fill="url(#blob)" />
  </Svg>
}
