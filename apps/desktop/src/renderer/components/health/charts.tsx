import React, { useCallback, useRef, useState } from 'react'
import type { HealthSleepStage, HealthSleepStageKind } from '@ego/api-contracts'
import { ticksFor, type ChartPoint, type MetricSpec } from '@ego/local/health/metrics'
import { color } from '../../lib/tokens'

/** One series per chart, so the ink stays in the app's grays: the chosen mark in white, the rest a step down. */
const INK = {
  mark: '#737373',
  hover: '#a3a3a3',
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

/** The phone's onLayout: a ref that measures its element whenever it mounts or resizes. */
function useWidth(): [number, (element: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!element) return
    setWidth(Math.round(element.getBoundingClientRect().width))
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.current.observe(element)
  }, [])
  return [width, ref]
}

function pointerX(event: React.PointerEvent<HTMLElement>): number {
  return event.clientX - event.currentTarget.getBoundingClientRect().left
}

/** A label over the chart for the value under the mouse, kept inside the chart's edges. */
function Tooltip({ x, y, width, title, value }: {
  x: number
  y: number
  width: number
  title: string
  value: string
}): React.ReactElement {
  const half = 80
  const left = Math.min(Math.max(x, half), Math.max(half, width - half))
  return <div
    role="tooltip"
    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl border border-surface-700 bg-popover px-3 py-2 text-center shadow-lg"
    style={{ left, top: Math.max(0, y - 10) }}
  >
    <p className="text-[12px] text-muted-foreground">{title}</p>
    <p className="tabular text-[15px] font-semibold">{value}</p>
  </div>
}

/**
 * A day, week, or month series. A click or a drag chooses a point, as a tap does on the phone,
 * and the mouse shows each value as it passes. With the chart focused, the arrow keys step
 * between points that have a value.
 */
export function MetricChart({ points, spec, selectedKey, onSelect, label, describe }: {
  points: readonly ChartPoint[]
  spec: MetricSpec
  selectedKey: string | null
  onSelect: (key: string) => void
  label: string
  describe: (point: ChartPoint & { value: number }) => { title: string; value: string }
}): React.ReactElement {
  const [width, ref] = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)
  const values = points.map((point) => point.value).filter((value): value is number => value !== null)
  const ticks = ticksFor(values, spec.fromZero, spec.target, spec.tickUnit)
  const low = ticks[0]
  const high = ticks[ticks.length - 1]
  const plotWidth = Math.max(0, width - GUTTER)
  const slot = points.length > 0 ? plotWidth / points.length : 0
  const y = (value: number): number => TOP + PLOT_HEIGHT - ((value - low) / (high - low || 1)) * PLOT_HEIGHT
  const centre = (index: number): number => GUTTER + slot * index + slot / 2

  const indexAt = (x: number): number | null => {
    if (slot <= 0) return null
    return Math.min(points.length - 1, Math.max(0, Math.floor((x - GUTTER) / slot)))
  }
  const pick = (index: number | null): void => {
    const point = index === null ? undefined : points[index]
    if (point && point.value !== null && point.key !== selectedKey) onSelect(point.key)
  }
  const step = (direction: number): void => {
    const start = points.findIndex((point) => point.key === selectedKey)
    for (let index = (start < 0 ? points.length : start) + direction; index >= 0 && index < points.length; index += direction) {
      if (points[index].value !== null) {
        onSelect(points[index].key)
        return
      }
    }
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
  const hoverPoint = hovered === null ? null : points[hovered]
  const hoverValue = hoverPoint?.value ?? null
  const tip = hoverPoint && hoverValue !== null && hovered !== null
    ? { x: centre(hovered), y: y(hoverValue), ...describe({ ...hoverPoint, value: hoverValue }) }
    : null

  return <div
    ref={ref}
    role="group"
    aria-label={label}
    tabIndex={0}
    onPointerDown={(event) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      pick(indexAt(pointerX(event)))
    }}
    onPointerMove={(event) => {
      const index = indexAt(pointerX(event))
      setHovered(index)
      if (event.buttons === 1) pick(index)
    }}
    onPointerLeave={() => setHovered(null)}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      step(event.key === 'ArrowLeft' ? -1 : 1)
    }}
    className="relative cursor-pointer select-none rounded-lg outline-offset-4"
    style={{ height: TOP + PLOT_HEIGHT + AXIS_BAND }}
  >
    {width > 0 && <svg width={width} height={TOP + PLOT_HEIGHT + AXIS_BAND} aria-hidden className="block">
      {ticks.map((tick) => <React.Fragment key={tick}>
        <line x1={GUTTER} x2={width} y1={y(tick)} y2={y(tick)} stroke={INK.grid} strokeWidth={1} />
        <text x={GUTTER - 8} y={y(tick) + 4} fill={INK.axis} fontSize={11} textAnchor="end">{spec.tick(tick)}</text>
      </React.Fragment>)}
      {spec.target !== undefined && spec.target <= high && <>
        <line x1={GUTTER} x2={width} y1={y(spec.target)} y2={y(spec.target)} stroke={INK.guide} strokeWidth={1} />
        <text x={width - 2} y={y(spec.target) - 5} fill={INK.axis} fontSize={11} textAnchor="end">Goal</text>
      </>}
      {selectedIndex >= 0 && spec.mark === 'line' && <line
        x1={centre(selectedIndex)} x2={centre(selectedIndex)} y1={TOP} y2={TOP + PLOT_HEIGHT} stroke={INK.guide} strokeWidth={1}
      />}
      {tip && hovered !== selectedIndex && spec.mark === 'line' && <line
        x1={tip.x} x2={tip.x} y1={TOP} y2={TOP + PLOT_HEIGHT} stroke={INK.grid} strokeWidth={1}
      />}
      {spec.mark === 'bar' && points.map((point, index) => {
        if (point.value === null || point.value <= low) return null
        const top = y(point.value)
        return <path
          key={point.key}
          d={barPath(centre(index) - barWidth / 2, top, barWidth, TOP + PLOT_HEIGHT - top)}
          fill={point.key === selectedKey ? INK.selected : index === hovered ? INK.hover : INK.mark}
        />
      })}
      {segments.map((segment) => <path
        key={segment} d={segment} stroke={INK.selected} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"
      />)}
      {spec.mark === 'line' && points.map((point, index) => {
        if (point.value === null) return null
        const selected = point.key === selectedKey
        if (!selected && !showMarkers && index !== hovered) return null
        return <circle
          key={point.key} cx={centre(index)} cy={y(point.value)} r={selected ? 5 : 4}
          fill={INK.selected} stroke={INK.surface} strokeWidth={2}
        />
      })}
      {points.map((point, index) => point.label !== '' && <text
        key={`label-${point.key}`}
        x={centre(index)} y={TOP + PLOT_HEIGHT + 16} fill={point.key === selectedKey ? INK.selected : INK.axis}
        fontSize={11} fontWeight={point.key === selectedKey ? 700 : 400} textAnchor="middle"
      >{point.label}</text>)}
    </svg>}
    {tip && <Tooltip x={tip.x} y={tip.y} width={width} title={tip.title} value={tip.value} />}
  </div>
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

/** The wall-clock time `offset` minutes after a `YYYY-MM-DDTHH:mm` start. */
function clockAfter(startLocal: string, offset: number): string {
  const total = (Number(startLocal.slice(11, 13)) * 60 + Number(startLocal.slice(14, 16)) + Math.round(offset)) % 1440
  return minuteLabel(total)
}

function minuteLabel(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60) % 24
  const minutes = String(minuteOfDay % 60).padStart(2, '0')
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

/** The night as Google Health draws it: one row per stage, time running left to right. */
export function Hypnogram({ stages, minutesInBed, startLocal, endLocal }: {
  stages: readonly HealthSleepStage[]
  minutesInBed: number
  startLocal: string
  endLocal: string
}): React.ReactElement | null {
  const [width, ref] = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)
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
  const stageAt = (pixel: number): number | null => {
    if (plotWidth <= 0 || pixel < LABEL_WIDTH) return null
    const minute = ((pixel - LABEL_WIDTH) / plotWidth) * span
    const index = stages.findIndex((stage) => minute >= stage.start && minute < stage.start + stage.minutes)
    return index < 0 ? null : index
  }
  const active = hovered === null ? null : stages[hovered]

  return <div
    ref={ref}
    role="img"
    aria-label={`Sleep stages from ${clockLabel(startLocal)} to ${clockLabel(endLocal)}. ${spoken}.`}
    onPointerMove={(event) => setHovered(stageAt(pointerX(event)))}
    onPointerLeave={() => setHovered(null)}
    className="relative"
    style={{ height }}
  >
    {width > 0 && <svg width={width} height={height} aria-hidden className="block">
      {rows.map((kind) => <React.Fragment key={kind}>
        <line x1={LABEL_WIDTH} x2={width} y1={rowTop(kind) + ROW_HEIGHT - 0.5} y2={rowTop(kind) + ROW_HEIGHT - 0.5} stroke={INK.grid} strokeWidth={1} />
        <text x={0} y={rowTop(kind) + ROW_HEIGHT / 2 + 4} fill={INK.axis} fontSize={12}>{STAGE_LABELS[kind]}</text>
      </React.Fragment>)}
      {stages.map((stage, index) => {
        const next = stages[index + 1]
        const top = rowTop(stage.kind) + 5
        const nextTop = next ? rowTop(next.kind) + 5 : top
        const fill = stage.kind === 'awake' || index === hovered ? INK.selected : '#a3a3a3'
        return <React.Fragment key={`${stage.start}-${index}`}>
          <rect
            x={x(stage.start)} y={top} width={Math.max(1.5, x(stage.start + stage.minutes) - x(stage.start))} height={ROW_HEIGHT - 12}
            rx={2} fill={fill}
          />
          {next && next.kind !== stage.kind && <line
            x1={x(next.start)} x2={x(next.start)} y1={Math.min(top, nextTop) + 7} y2={Math.max(top, nextTop) + 7}
            stroke={INK.guide} strokeWidth={1}
          />}
        </React.Fragment>
      })}
      <text x={LABEL_WIDTH} y={rows.length * ROW_HEIGHT + 16} fill={INK.axis} fontSize={11}>{clockLabel(startLocal)}</text>
      <text x={width} y={rows.length * ROW_HEIGHT + 16} fill={INK.axis} fontSize={11} textAnchor="end">{clockLabel(endLocal)}</text>
    </svg>}
    {active && <Tooltip
      x={x(active.start + active.minutes / 2)}
      y={rowTop(active.kind) + 5}
      width={width}
      title={`${clockAfter(startLocal, active.start)} to ${clockAfter(startLocal, active.start + active.minutes)}`}
      value={`${STAGE_LABELS[active.kind]}, ${active.minutes} min`}
    />}
  </div>
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
  const [width, ref] = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)
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
  const nearest = (pixel: number): number | null => {
    if (plotWidth <= 0 || pixel < GUTTER) return null
    const minute = ((pixel - GUTTER) / plotWidth) * DAY_MINUTES
    let best = 0
    points.forEach((point, index) => {
      if (Math.abs(point[0] - minute) < Math.abs(points[best][0] - minute)) best = index
    })
    return Math.abs(points[best][0] - minute) <= CURVE_GAP_MINUTES ? best : null
  }
  const active = hovered === null ? null : points[hovered] ?? null

  return <div
    ref={ref}
    role="img"
    aria-label={`Heart rate through the day, from ${Math.round(least[1])} to ${Math.round(peak[1])} beats per minute`}
    onPointerMove={(event) => setHovered(nearest(pointerX(event)))}
    onPointerLeave={() => setHovered(null)}
    className="relative"
    style={{ height: TOP + PLOT_HEIGHT + AXIS_BAND }}
  >
    {width > 0 && <svg width={width} height={TOP + PLOT_HEIGHT + AXIS_BAND} aria-hidden className="block">
      {ticks.map((tick) => <React.Fragment key={tick}>
        <line x1={GUTTER} x2={width} y1={y(tick)} y2={y(tick)} stroke={INK.grid} strokeWidth={1} />
        <text x={GUTTER - 8} y={y(tick) + 4} fill={INK.axis} fontSize={11} textAnchor="end">{tick}</text>
      </React.Fragment>)}
      {resting !== null && <>
        <line x1={GUTTER} x2={width} y1={y(resting)} y2={y(resting)} stroke={INK.guide} strokeWidth={1} />
        <text x={width - 2} y={y(resting) - 5} fill={INK.axis} fontSize={11} textAnchor="end">{`Resting ${resting}`}</text>
      </>}
      {active && <line x1={x(active[0])} x2={x(active[0])} y1={TOP} y2={TOP + PLOT_HEIGHT} stroke={INK.guide} strokeWidth={1} />}
      <path d={path} stroke={INK.selected} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(peak[0])} cy={y(peak[1])} r={4} fill={INK.selected} stroke={INK.surface} strokeWidth={2} />
      <text x={Math.min(width - 4, Math.max(GUTTER + 4, x(peak[0])))} y={Math.max(12, y(peak[1]) - 10)} fill={color.textSecondary} fontSize={12} fontWeight={600} textAnchor="middle">
        {`${Math.round(peak[1])}`}
      </text>
      {active && <circle cx={x(active[0])} cy={y(active[1])} r={4} fill={INK.selected} stroke={INK.surface} strokeWidth={2} />}
      {HOUR_MARKS.map((minute, index) => HOUR_LABELS[index] !== '' && <text
        key={minute} x={x(minute)} y={TOP + PLOT_HEIGHT + 16} fill={INK.axis} fontSize={11} textAnchor={index === 0 ? 'start' : 'middle'}
      >{HOUR_LABELS[index]}</text>)}
    </svg>}
    {active && <Tooltip x={x(active[0])} y={y(active[1])} width={width} title={minuteLabel(active[0])} value={`${Math.round(active[1])} bpm`} />}
  </div>
}
