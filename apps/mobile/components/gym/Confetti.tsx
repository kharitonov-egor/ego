import React, { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Trophy } from 'lucide-react-native'
import { GYM_CATEGORY_COLORS } from '@ego/core'
import { color, useReducedMotion } from '../money/tokens'
import { Text } from '../ui/text'

const PIECE_COUNT = 90
const DURATION_MS = 2800
const SAMPLE_COUNT = 18
const COLORS = [...GYM_CATEGORY_COLORS, color.attention, color.text]

interface Piece {
  color: string
  width: number
  height: number
  round: boolean
  times: number[]
  x: number[]
  y: number[]
  spin: string[]
  flip: string[]
}

function between(low: number, high: number): number {
  return low + Math.random() * (high - low)
}

/**
 * Each piece leaves the burst fast, slows under air drag toward a gentle falling speed, and sways.
 * Samples crowd the start, where the path bends most, since the native driver draws straight lines
 * between them.
 */
function makePiece(width: number, height: number): Piece {
  const seconds = DURATION_MS / 1000
  const drag = 3
  const fall = between(0.32, 0.5) * height
  const rise = -between(0.8, 1.5) * height
  const drift = between(-1, 1) * width * 1.1
  const sway = between(6, 18)
  const swayRate = between(3, 6)
  const phase = between(0, Math.PI * 2)
  const turns = between(-3, 3)
  const flips = between(2, 6)
  const times: number[] = []
  const x: number[] = []
  const y: number[] = []
  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    const progress = (index / SAMPLE_COUNT) ** 1.6
    const t = progress * seconds
    const slowed = (1 - Math.exp(-drag * t)) / drag
    times.push(progress)
    x.push(drift * slowed + sway * Math.sin(swayRate * t + phase))
    y.push(fall * t + (rise - fall) * slowed)
  }
  const size = between(6, 10)
  return {
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    width: size,
    height: Math.random() < 0.3 ? size : size * between(1.4, 2),
    round: Math.random() < 0.2,
    times,
    x,
    y,
    spin: ['0deg', `${Math.round(turns * 360)}deg`],
    flip: ['0deg', `${Math.round(flips * 360)}deg`]
  }
}

function ConfettiPiece({ piece, progress, originX, originY }: {
  piece: Piece
  progress: Animated.Value
  originX: number
  originY: number
}): React.ReactElement {
  const translateX = progress.interpolate({ inputRange: piece.times, outputRange: piece.x })
  const translateY = progress.interpolate({ inputRange: piece.times, outputRange: piece.y })
  const rotate = progress.interpolate({ inputRange: [0, 1], outputRange: piece.spin })
  const rotateX = progress.interpolate({ inputRange: [0, 1], outputRange: piece.flip })
  const opacity = progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] })
  return <Animated.View style={{
    position: 'absolute',
    left: originX - piece.width / 2,
    top: originY - piece.height / 2,
    width: piece.width,
    height: piece.height,
    borderRadius: piece.round ? piece.width / 2 : 1.5,
    backgroundColor: piece.color,
    opacity,
    transform: [{ translateX }, { translateY }, { rotate }, { rotateX }]
  }} />
}

/** A burst of confetti over the screen and a short "New record" label. Touches pass straight through. */
export function Confetti({ onDone }: { onDone: () => void }): React.ReactElement {
  const { width, height } = useWindowDimensions()
  const reducedMotion = useReducedMotion()
  const progress = useRef(new Animated.Value(0)).current
  const label = useRef(new Animated.Value(0)).current
  const pieces = useMemo(() => Array.from({ length: PIECE_COUNT }, () => makePiece(width, height)), [width, height])
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (reducedMotion) {
      label.setValue(1)
      const clear = setTimeout(() => done.current(), 2200)
      return () => clearTimeout(clear)
    }
    const burst = Animated.parallel([
      Animated.timing(progress, { toValue: 1, duration: DURATION_MS, easing: Easing.linear, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(label, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(label, { toValue: 0, duration: 400, useNativeDriver: true })
      ])
    ])
    burst.start(() => done.current())
    return () => burst.stop()
  }, [label, progress, reducedMotion])

  const labelShift = label.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] })
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {!reducedMotion && pieces.map((piece, index) => <ConfettiPiece
      key={index}
      piece={piece}
      progress={progress}
      originX={width / 2}
      originY={height * 0.4}
    />)}
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center', opacity: label, transform: [{ translateY: labelShift }] }}
    >
      <View className="flex-row items-center gap-2 rounded-full bg-surface-800 px-4 py-2.5">
        <Trophy color={color.attention} size={18} />
        <Text className="text-[16px] font-semibold">New record</Text>
      </View>
    </Animated.View>
  </View>
}
