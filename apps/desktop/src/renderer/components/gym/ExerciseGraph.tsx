import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  GRAPH_METRIC_LABELS, graphMetricsFor, graphPoints,
  type DistanceUnit, type ExerciseType, type GraphMetric, type GraphPoint, type GymSetLike, type WeightUnit
} from '@ego/core'
import { formatIso, isoToday, shiftIso } from '@ego/local/dates'
import { dayNumber, formatMetric, tickLabel, ticksFor } from '@ego/local/gym/graph'
import { Chips } from '../common'
import { color } from '../../lib/tokens'

/** Categorical slot 1, validated against the card surface. One series, so it needs no legend. */
const SERIES = '#3987e5'
const SURFACE = color.surface
const PLOT_HEIGHT = 260
const GUTTER = 48
const PAD = 12
const MAX_MARKERS = 60

type Range = '1m' | '3m' | '6m' | '1y' | 'all'
const RANGES: readonly Range[] = ['1m', '3m', '6m', '1y', 'all']
const RANGE_LABELS: Record<Range, string> = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', all: 'All' }
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '1m': 31, '3m': 92, '6m': 183, '1y': 366 }

/**
 * The phone's graph with the mouse in place of a finger: hovering picks the nearest workout, and
 * the Left and Right keys step through them once the plot has the focus.
 */
export function ExerciseGraph({ sets, type, weightUnit, distanceUnit }: {
  sets: readonly GymSetLike[]
  type: ExerciseType
  weightUnit: WeightUnit
  distanceUnit: DistanceUnit
}): React.ReactElement {
  const metrics = graphMetricsFor(type)
  const [metric, setMetric] = useState<GraphMetric>(metrics[0])
  const [range, setRange] = useState<Range>('all')
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!metrics.includes(metric)) setMetric(metrics[0])
  }, [type])

  useLayoutEffect(() => {
    const element = frame.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

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

  const nearest = (x: number): number | null => {
    if (coordinates.length === 0) return null
    let best = 0
    for (let index = 1; index < coordinates.length; index += 1) {
      if (Math.abs(coordinates[index].x - x) < Math.abs(coordinates[best].x - x)) best = index
    }
    return best
  }

  const onKey = (event: React.KeyboardEvent): void => {
    if (points.length === 0) return
    const last = points.length - 1
    const current = selected ?? last
    const next = event.key === 'ArrowLeft' ? Math.max(0, current - 1)
      : event.key === 'ArrowRight' ? Math.min(last, current + 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? last
            : event.key === 'Escape' ? null : undefined
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    setSelected(next)
  }

  const shown = selected !== null ? points[selected] : points[points.length - 1]
  const summary = points.length > 0
    ? `${GRAPH_METRIC_LABELS[metric]}, ${points.length} workouts. Latest ${formatMetric(metric, points[points.length - 1].value, weightUnit, distanceUnit)}.`
    : `${GRAPH_METRIC_LABELS[metric]}, no workouts in this range.`
  const metricLabels: Partial<Record<GraphMetric, string>> = Object.fromEntries(metrics.map((item) => [item, GRAPH_METRIC_LABELS[item]]))

  return <div>
    <Chips values={metrics} value={metric} labels={metricLabels} onChange={setMetric} />
    <div className="mt-4 rounded-3xl border border-border bg-card p-5">
      <p className="text-[15px] font-medium text-muted-foreground">{GRAPH_METRIC_LABELS[metric]}</p>
      {shown
        ? <div className="mt-1">
          <p className="text-[28px] font-bold tracking-tight">{formatMetric(metric, shown.value, weightUnit, distanceUnit)}</p>
          <p className="text-[14px] text-muted-foreground">{formatIso(shown.date)}{selected === null ? ', latest' : ''}</p>
        </div>
        : <p className="mt-2 text-[16px] leading-6 text-muted-foreground">Nothing logged in this range yet.</p>}
      <div ref={frame} className="mt-4 flex">
        <div aria-hidden className="relative" style={{ width: GUTTER - 8, height: PLOT_HEIGHT }}>
          {ticks.map((tick) => <span
            key={tick}
            className="tabular absolute right-0 text-[12px] text-muted-foreground"
            style={{ top: yOf(tick) - 8 }}
          >{tickLabel(metric, tick)}</span>)}
        </div>
        <div
          role="img"
          aria-label={summary}
          tabIndex={points.length > 0 ? 0 : -1}
          onKeyDown={onKey}
          onMouseMove={(event) => setSelected(nearest(event.clientX - event.currentTarget.getBoundingClientRect().left))}
          onMouseLeave={() => setSelected(null)}
          className="cursor-crosshair rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ marginLeft: 8, width: plotWidth, height: PLOT_HEIGHT }}
        >
          {width > 0 && <svg width={plotWidth} height={PLOT_HEIGHT} className="overflow-visible">
            {ticks.map((tick) => <line key={tick} x1={0} x2={plotWidth} y1={yOf(tick)} y2={yOf(tick)} stroke={color.line} strokeWidth={1} />)}
            {selected !== null && coordinates[selected] && <line
              x1={coordinates[selected].x} x2={coordinates[selected].x} y1={0} y2={PLOT_HEIGHT}
              stroke={color.textFaint} strokeWidth={1}
            />}
            {coordinates.length > 1 && <path d={path} stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" fill="none" />}
            {coordinates.map((point, index) => {
              const isSelected = index === selected
              const isLast = index === coordinates.length - 1
              if (!isSelected && !isLast && coordinates.length > MAX_MARKERS) return null
              return <circle
                key={points[index].date}
                cx={point.x}
                cy={point.y}
                r={isSelected ? 6 : 4}
                fill={SERIES}
                stroke={SURFACE}
                strokeWidth={2}
              />
            })}
          </svg>}
        </div>
      </div>
      {points.length > 0 && <div className="mt-2 flex justify-between" style={{ marginLeft: GUTTER }}>
        <span className="text-[12px] text-muted-foreground">{formatIso(points[0].date)}</span>
        {points.length > 1 && <span className="text-[12px] text-muted-foreground">{formatIso(points[points.length - 1].date)}</span>}
      </div>}
    </div>
    <div className="mt-4">
      <Chips values={RANGES} value={range} labels={RANGE_LABELS} onChange={setRange} />
    </div>
  </div>
}
