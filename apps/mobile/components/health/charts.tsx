import React, { useState } from 'react'
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg'
import type { HealthSleepStage, HealthSleepStageKind } from '@ego/api-contracts'
import { ticksFor, type ChartPoint, type MetricSpec } from '../../lib/health/metrics'
import { color } from '../money/tokens'

/** One series per chart, so the ink stays in the app's grays: the chosen mark in white, the rest a step down. */
const INK = {
  mark: '#737373',
  selected: color.text,
  grid: color.line,
  axis: color.textFaint,
  guide: '#525252',
  surface: color.surface
} as const

const PLOT_HEIGHT = 168
const AXIS_BAND = 22
const GUTTER = 40
const TOP = 8
const MAX_BAR = 24
const BAR_GAP = 2
const RADIUS = 4

function barPath(x: number, y: number, width: number, height: number): string {
  const radius = Math.min(RADIUS, width / 2, height)
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}` +
    `Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`
}

function useWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0)
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))]
}

/**
 * A day, week, or month series with tap and drag to choose a point. The responder gives the touch
 * back to the scroll view when the finger moves vertically, so the page still scrolls over it.
 */
export function MetricChart({ points, spec, selectedKey, onSelect, accessibilityLabel }: {
  points: readonly ChartPoint[]
  spec: MetricSpec
  selectedKey: string | null
  onSelect: (key: string) => void
  accessibilityLabel: string
}): React.ReactElement {
  const [width, onLayout] = useWidth()
  const values = points.map((point) => point.value).filter((value): value is number => value !== null)
  const ticks = ticksFor(values, spec.fromZero, spec.target, spec.tickUnit)
  const low = ticks[0]
  const high = ticks[ticks.length - 1]
  const plotWidth = Math.max(0, width - GUTTER)
  const slot = points.length > 0 ? plotWidth / points.length : 0
  const y = (value: number): number => TOP + PLOT_HEIGHT - ((value - low) / (high - low || 1)) * PLOT_HEIGHT
  const centre = (index: number): number => GUTTER + slot * index + slot / 2

  const pick = (event: GestureResponderEvent): void => {
    if (slot <= 0) return
    const index = Math.min(points.length - 1, Math.max(0, Math.floor((event.nativeEvent.locationX - GUTTER) / slot)))
    const point = points[index]
    if (point && point.value !== null && point.key !== selectedKey) onSelect(point.key)
  }

  const segments: string[] = []
  if (spec.mark === 'line') {
    let current = ''
    points.forEach((point, index) => {
      if (point.value === null) {
        if (current) segments.push(current)
        current = ''
        return
      }
      current += `${current ? 'L' : 'M'}${centre(index)},${y(point.value)}`
    })
    if (current) segments.push(current)
  }
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - BAR_GAP))
  const showMarkers = spec.mark === 'line' && slot >= 14
  const selectedIndex = points.findIndex((point) => point.key === selectedKey)

  return <View
    onLayout={onLayout}
    accessible
    accessibilityLabel={accessibilityLabel}
    onStartShouldSetResponder={() => true}
    onResponderGrant={pick}
    onResponderMove={pick}
    onResponderTerminationRequest={() => true}
    style={{ height: TOP + PLOT_HEIGHT + AXIS_BAND }}
  >
    {width > 0 && <Svg width={width} height={TOP + PLOT_HEIGHT + AXIS_BAND}>
      {ticks.map((tick) => <React.Fragment key={tick}>
        <Line x1={GUTTER} x2={width} y1={y(tick)} y2={y(tick)} stroke={INK.grid} strokeWidth={1} />
        <SvgText x={GUTTER - 8} y={y(tick) + 4} fill={INK.axis} fontSize={11} textAnchor="end">{spec.tick(tick)}</SvgText>
      </React.Fragment>)}
      {spec.target !== undefined && spec.target <= high && <>
        <Line x1={GUTTER} x2={width} y1={y(spec.target)} y2={y(spec.target)} stroke={INK.guide} strokeWidth={1} />
        <SvgText x={width - 2} y={y(spec.target) - 5} fill={INK.axis} fontSize={11} textAnchor="end">Goal</SvgText>
      </>}
      {selectedIndex >= 0 && spec.mark === 'line' && <Line
        x1={centre(selectedIndex)} x2={centre(selectedIndex)} y1={TOP} y2={TOP + PLOT_HEIGHT} stroke={INK.guide} strokeWidth={1}
      />}
      {spec.mark === 'bar' && points.map((point, index) => {
        if (point.value === null || point.value <= low) return null
        const top = y(point.value)
        return <Path
          key={point.key}
          d={barPath(centre(index) - barWidth / 2, top, barWidth, TOP + PLOT_HEIGHT - top)}
          fill={point.key === selectedKey ? INK.selected : INK.mark}
        />
      })}
      {segments.map((segment) => <Path
        key={segment} d={segment} stroke={INK.selected} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"
      />)}
      {spec.mark === 'line' && points.map((point, index) => {
        if (point.value === null) return null
        const selected = point.key === selectedKey
        if (!selected && !showMarkers) return null
        return <Circle
          key={point.key} cx={centre(index)} cy={y(point.value)} r={selected ? 5 : 4}
          fill={INK.selected} stroke={INK.surface} strokeWidth={2}
        />
      })}
      {points.map((point, index) => point.label !== '' && <SvgText
        key={`label-${point.key}`}
        x={centre(index)} y={TOP + PLOT_HEIGHT + 16} fill={point.key === selectedKey ? INK.selected : INK.axis}
        fontSize={11} fontWeight={point.key === selectedKey ? '700' : '400'} textAnchor="middle"
      >{point.label}</SvgText>)}
    </Svg>}
  </View>
}

const STAGE_ROWS: Record<'stages' | 'classic', HealthSleepStageKind[]> = {
  stages: ['awake', 'rem', 'light', 'deep'],
  classic: ['awake', 'restless', 'asleep']
}

const STAGE_LABELS: Record<HealthSleepStageKind, string> = {
  awake: 'Awake', rem: 'REM', light: 'Light', deep: 'Deep', asleep: 'Asleep', restless: 'Restless'
}

const ROW_HEIGHT = 26
const LABEL_WIDTH = 58

function clockLabel(local: string): string {
  const hours = Number(local.slice(11, 13))
  const minutes = local.slice(14, 16)
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

/** The night as Google Health draws it: one row per stage, time running left to right. */
export function Hypnogram({ stages, minutesInBed, startLocal, endLocal }: {
  stages: readonly HealthSleepStage[]
  minutesInBed: number
  startLocal: string
  endLocal: string
}): React.ReactElement | null {
  const [width, onLayout] = useWidth()
  if (stages.length === 0) return null
  const rows = stages.some((stage) => stage.kind === 'deep' || stage.kind === 'rem' || stage.kind === 'light')
    ? STAGE_ROWS.stages : STAGE_ROWS.classic
  const span = Math.max(minutesInBed, ...stages.map((stage) => stage.start + stage.minutes), 1)
  const plotWidth = Math.max(0, width - LABEL_WIDTH)
  const x = (minute: number): number => LABEL_WIDTH + (minute / span) * plotWidth
  const rowTop = (kind: HealthSleepStageKind): number => Math.max(0, rows.indexOf(kind)) * ROW_HEIGHT
  const height = rows.length * ROW_HEIGHT + AXIS_BAND
  const spoken = rows.map((kind) => {
    const minutes = stages.filter((stage) => stage.kind === kind).reduce((total, stage) => total + stage.minutes, 0)
    return `${STAGE_LABELS[kind]} ${minutes} minutes`
  }).join(', ')

  return <View onLayout={onLayout} accessible accessibilityLabel={`Sleep stages from ${clockLabel(startLocal)} to ${clockLabel(endLocal)}. ${spoken}.`} style={{ height }}>
    {width > 0 && <Svg width={width} height={height}>
      {rows.map((kind) => <React.Fragment key={kind}>
        <Line x1={LABEL_WIDTH} x2={width} y1={rowTop(kind) + ROW_HEIGHT - 0.5} y2={rowTop(kind) + ROW_HEIGHT - 0.5} stroke={INK.grid} strokeWidth={1} />
        <SvgText x={0} y={rowTop(kind) + ROW_HEIGHT / 2 + 4} fill={INK.axis} fontSize={12}>{STAGE_LABELS[kind]}</SvgText>
      </React.Fragment>)}
      {stages.map((stage, index) => {
        const next = stages[index + 1]
        const top = rowTop(stage.kind) + 5
        const nextTop = next ? rowTop(next.kind) + 5 : top
        return <React.Fragment key={`${stage.start}-${index}`}>
          <Rect
            x={x(stage.start)} y={top} width={Math.max(1.5, x(stage.start + stage.minutes) - x(stage.start))} height={ROW_HEIGHT - 12}
            rx={2} fill={stage.kind === 'awake' ? INK.selected : '#a3a3a3'}
          />
          {next && next.kind !== stage.kind && <Line
            x1={x(next.start)} x2={x(next.start)} y1={Math.min(top, nextTop) + 7} y2={Math.max(top, nextTop) + 7}
            stroke={INK.guide} strokeWidth={1}
          />}
        </React.Fragment>
      })}
      <SvgText x={LABEL_WIDTH} y={rows.length * ROW_HEIGHT + 16} fill={INK.axis} fontSize={11}>{clockLabel(startLocal)}</SvgText>
      <SvgText x={width} y={rows.length * ROW_HEIGHT + 16} fill={INK.axis} fontSize={11} textAnchor="end">{clockLabel(endLocal)}</SvgText>
    </Svg>}
  </View>
}

const DAY_MINUTES = 1440
const CURVE_GAP_MINUTES = 15
const HOUR_MARKS = [0, 360, 720, 1080, 1440]
const HOUR_LABELS = ['12 AM', '6 AM', '12 PM', '6 PM', '']

/** Five-minute averages across one day. A gap longer than fifteen minutes means the band was off. */
export function HeartCurve({ points, resting }: {
  points: ReadonlyArray<readonly [number, number]>
  resting: number | null
}): React.ReactElement | null {
  const [width, onLayout] = useWidth()
  if (points.length === 0) return null
  const values = points.map((point) => point[1])
  const ticks = ticksFor(resting === null ? values : [...values, resting], false)
  const low = ticks[0]
  const high = ticks[ticks.length - 1]
  const plotWidth = Math.max(0, width - GUTTER)
  const x = (minute: number): number => GUTTER + (minute / DAY_MINUTES) * plotWidth
  const y = (value: number): number => TOP + PLOT_HEIGHT - ((value - low) / (high - low || 1)) * PLOT_HEIGHT
  let path = ''
  points.forEach(([minute, bpm], index) => {
    const joined = index > 0 && minute - points[index - 1][0] <= CURVE_GAP_MINUTES
    path += `${joined ? 'L' : 'M'}${x(minute)},${y(bpm)}`
  })
  const peak = points.reduce((best, point) => point[1] > best[1] ? point : best)
  const least = points.reduce((best, point) => point[1] < best[1] ? point : best)

  return <View
    onLayout={onLayout}
    accessible
    accessibilityLabel={`Heart rate through the day, from ${Math.round(least[1])} to ${Math.round(peak[1])} beats per minute`}
    style={{ height: TOP + PLOT_HEIGHT + AXIS_BAND }}
  >
    {width > 0 && <Svg width={width} height={TOP + PLOT_HEIGHT + AXIS_BAND}>
      {ticks.map((tick) => <React.Fragment key={tick}>
        <Line x1={GUTTER} x2={width} y1={y(tick)} y2={y(tick)} stroke={INK.grid} strokeWidth={1} />
        <SvgText x={GUTTER - 8} y={y(tick) + 4} fill={INK.axis} fontSize={11} textAnchor="end">{tick}</SvgText>
      </React.Fragment>)}
      {resting !== null && <>
        <Line x1={GUTTER} x2={width} y1={y(resting)} y2={y(resting)} stroke={INK.guide} strokeWidth={1} />
        <SvgText x={width - 2} y={y(resting) - 5} fill={INK.axis} fontSize={11} textAnchor="end">{`Resting ${resting}`}</SvgText>
      </>}
      <Path d={path} stroke={INK.selected} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={x(peak[0])} cy={y(peak[1])} r={4} fill={INK.selected} stroke={INK.surface} strokeWidth={2} />
      <SvgText x={Math.min(width - 4, Math.max(GUTTER + 4, x(peak[0])))} y={Math.max(12, y(peak[1]) - 10)} fill={color.textSecondary} fontSize={12} fontWeight="600" textAnchor="middle">
        {`${Math.round(peak[1])}`}
      </SvgText>
      {HOUR_MARKS.map((minute, index) => HOUR_LABELS[index] !== '' && <SvgText
        key={minute} x={x(minute)} y={TOP + PLOT_HEIGHT + 16} fill={INK.axis} fontSize={11} textAnchor={index === 0 ? 'start' : 'middle'}
      >{HOUR_LABELS[index]}</SvgText>)}
    </Svg>}
  </View>
}
