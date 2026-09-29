import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Circle, Line, Path } from 'react-native-svg'
import {
  GRAPH_METRIC_LABELS, formatSetDuration, formatWeight, graphMetricsFor, graphPoints,
  type DistanceUnit, type ExerciseType, type GraphMetric, type GraphPoint, type GymSetLike, type WeightUnit
} from '@ego/core'
import { formatIso, isoToday, parseIso, shiftIso } from '../../lib/dates'
import { Chips } from '../money/Common'
import { color, tabular } from '../money/tokens'
import { Text } from '../ui/text'

/** Categorical slot 1, validated against the card surface. One series, so it needs no legend. */
const SERIES = '#3987e5'
const SURFACE = color.surface
const PLOT_HEIGHT = 200
const GUTTER = 48
const PAD = 12
const MAX_MARKERS = 40

type Range = '1m' | '3m' | '6m' | '1y' | 'all'
const RANGES: readonly Range[] = ['1m', '3m', '6m', '1y', 'all']
const RANGE_LABELS: Record<Range, string> = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', all: 'All' }
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 }

function niceStep(span: number): number {
  const raw = span / 3
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / magnitude
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return step * magnitude
}

/** Clean ticks that bracket the data, so the line never touches the frame. */
function ticksFor(values: number[]): number[] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low === high) {
    const pad = Math.max(1, Math.abs(high) * 0.1)
    return ticksFor([Math.max(0, low - pad), high + pad])
  }
  const step = niceStep(high - low)
  const first = Math.floor(low / step) * step
  const last = Math.ceil(high / step) * step
  const ticks: number[] = []
  for (let tick = first; tick <= last + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000)
  return ticks
}

function isTime(metric: GraphMetric): boolean {
  return metric === 'max_time' || metric === 'workout_time'
}

export function formatMetric(metric: GraphMetric, value: number, weightUnit: WeightUnit, distanceUnit: DistanceUnit): string {
  if (isTime(metric)) return formatSetDuration(value)
  if (metric === 'max_distance' || metric === 'workout_distance') return `${Math.round(value * 100) / 100} ${distanceUnit}`
  if (metric === 'max_reps' || metric === 'workout_reps') return `${Math.round(value)} reps`
  if (metric === 'workout_volume') return `${Math.round(value).toLocaleString('en-US')} ${weightUnit}`
  return `${formatWeight(value)} ${weightUnit}`
}

function tickLabel(metric: GraphMetric, value: number): string {
  if (isTime(metric)) return formatSetDuration(value)
  if (value >= 10000) return `${Math.round(value / 1000)}k`
  return Number.isInteger(value) ? value.toLocaleString('en-US') : String(value)
}

function dayNumber(iso: string): number {
  return Math.round(parseIso(iso).getTime() / 86400000)
}

export function ExerciseGraph({ sets, type, weightUnit, distanceUnit, onScrubbingChange }: {
  sets: readonly GymSetLike[]
  type: ExerciseType
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
  onScrubbingChange: (scrubbing: boolean) => void
}): React.ReactElement {
  const metrics = graphMetricsFor(type)
  const [metric, setMetric] = useState<GraphMetric>(metrics[0])
  const [range, setRange] = useState<Range>('all')
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    if (!metrics.includes(metric)) setMetric(metrics[0])
  }, [type])

  const points = useMemo((): GraphPoint[] => {
    const all = graphPoints(sets, metric, weightUnit, distanceUnit)
    if (range === 'all') return all
    const from = shiftIso(isoToday(), -RANGE_DAYS[range])
    return all.filter((point) => point.date >= from)
  }, [sets, metric, weightUnit, distanceUnit, range])

  useEffect(() => setSelected(null), [points])

  const plotWidth = Math.max(0, width - GUTTER - PAD)
  const ticks = useMemo(() => points.length > 0 ? ticksFor(points.map((point) => point.value)) : [], [points])
  const low = ticks[0] ?? 0
  const high = ticks[ticks.length - 1] ?? 1
  const firstDay = points.length > 0 ? dayNumber(points[0].date) : 0
  const lastDay = points.length > 0 ? dayNumber(points[points.length - 1].date) : 1
  const daySpan = Math.max(1, lastDay - firstDay)
  const xOf = (point: GraphPoint): number => points.length === 1 ? plotWidth / 2 : ((dayNumber(point.date) - firstDay) / daySpan) * plotWidth
  const yOf = (value: number): number => PAD + (1 - (value - low) / (high - low || 1)) * (PLOT_HEIGHT - PAD * 2)
  const coordinates = points.map((point) => ({ x: xOf(point), y: yOf(point.value) }))
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')

  const live = useRef({ coordinates, onScrubbingChange })
  live.current = { coordinates, onScrubbingChange }
  const responder = useMemo(() => {
    const nearest = (x: number): number | null => {
      const list = live.current.coordinates
      if (list.length === 0) return null
      let best = 0
      for (let index = 1; index < list.length; index += 1) {
        if (Math.abs(list[index].x - x) < Math.abs(list[best].x - x)) best = index
      }
      return best
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        live.current.onScrubbingChange(true)
        setSelected(nearest(event.nativeEvent.locationX))
      },
      onPanResponderMove: (event) => setSelected(nearest(event.nativeEvent.locationX)),
      onPanResponderRelease: () => live.current.onScrubbingChange(false),
      onPanResponderTerminate: () => live.current.onScrubbingChange(false)
    })
  }, [])

  const shown = selected !== null ? points[selected] : points[points.length - 1]
  const summary = points.length > 0
    ? `${GRAPH_METRIC_LABELS[metric]}, ${points.length} workouts. Latest ${formatMetric(metric, points[points.length - 1].value, weightUnit, distanceUnit)}.`
    : `${GRAPH_METRIC_LABELS[metric]}, no workouts in this range.`
  const metricLabels = Object.fromEntries(metrics.map((item) => [item, GRAPH_METRIC_LABELS[item]])) as Partial<Record<GraphMetric, string>>

  return <View>
    <Chips values={metrics} value={metric} labels={metricLabels} onChange={setMetric} />
    <View className="mt-4 rounded-3xl border border-border bg-card p-4">
      <Text className="text-[15px] font-medium text-muted-foreground">{GRAPH_METRIC_LABELS[metric]}</Text>
      {shown
        ? <View className="mt-1">
          <Text className="text-[28px] font-bold tracking-tight">{formatMetric(metric, shown.value, weightUnit, distanceUnit)}</Text>
          <Text className="text-[14px] text-muted-foreground">{formatIso(shown.date)}{selected === null ? ', latest' : ''}</Text>
        </View>
        : <Text className="mt-2 text-[16px] leading-6 text-muted-foreground">Nothing logged in this range yet.</Text>}
      <View
        className="mt-4 flex-row"
        accessible
        accessibilityLabel={summary}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      >
        <View style={{ width: GUTTER - 8, height: PLOT_HEIGHT }}>
          {ticks.map((tick) => <Text
            key={tick}
            className="absolute right-0 text-[12px] text-muted-foreground"
            style={[tabular, { top: yOf(tick) - 8 }]}
          >{tickLabel(metric, tick)}</Text>)}
        </View>
        <View style={{ marginLeft: 8, width: plotWidth, height: PLOT_HEIGHT }} {...responder.panHandlers}>
          {width > 0 && <Svg width={plotWidth} height={PLOT_HEIGHT}>
            {ticks.map((tick) => <Line key={tick} x1={0} x2={plotWidth} y1={yOf(tick)} y2={yOf(tick)} stroke={color.line} strokeWidth={1} />)}
            {selected !== null && coordinates[selected] && <Line
              x1={coordinates[selected].x} x2={coordinates[selected].x} y1={0} y2={PLOT_HEIGHT}
              stroke={color.textFaint} strokeWidth={1}
            />}
            {coordinates.length > 1 && <Path d={path} stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />}
            {coordinates.map((point, index) => {
              const isSelected = index === selected
              const isLast = index === coordinates.length - 1
              if (!isSelected && !isLast && coordinates.length > MAX_MARKERS) return null
              return <Circle
                key={points[index].date}
                cx={point.x}
                cy={point.y}
                r={isSelected ? 6 : 4}
                fill={SERIES}
                stroke={SURFACE}
                strokeWidth={2}
              />
            })}
          </Svg>}
        </View>
      </View>
      {points.length > 0 && <View className="mt-2 flex-row justify-between" style={{ marginLeft: GUTTER }}>
        <Text className="text-[12px] text-muted-foreground">{formatIso(points[0].date)}</Text>
        {points.length > 1 && <Text className="text-[12px] text-muted-foreground">{formatIso(points[points.length - 1].date)}</Text>}
      </View>}
    </View>
    <View className="mt-4">
      <Chips values={RANGES} value={range} labels={RANGE_LABELS} onChange={setRange} />
    </View>
  </View>
}
