import React from 'react'
import Svg, { Circle } from 'react-native-svg'

/** A progress ring drawn clockwise from twelve o'clock. Positioned absolutely over its slot. */
export function Ring({ size, stroke = 3, share, track, fill }: {
  size: number
  stroke?: number
  share: number
  track: string
  fill: string
}): React.ReactElement {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(1, Math.max(0, share))
  return <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
    <Circle cx={size / 2} cy={size / 2} r={radius} stroke={track} strokeWidth={stroke} fill="none" />
    {clamped > 0 && <Circle
      cx={size / 2} cy={size / 2} r={radius} stroke={fill} strokeWidth={stroke} fill="none"
      strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`}
      strokeDashoffset={circumference * (1 - clamped)}
    />}
  </Svg>
}
