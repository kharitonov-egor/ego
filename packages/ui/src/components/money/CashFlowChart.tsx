import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Flow } from '@ego/local/cash-flow'
import type { ChartBucket } from '@ego/local/periods'
import { BlurSpan, Blurred } from '../../lib/blur'
import { Checkbox } from '../ui/checkbox'
import { money } from './Common'

/** Validated as a pair against the card surface with the dataviz palette checker. */
export const SERIES_COLOR = { expense: '#3b8fe8', income: '#2fa37a' } as const

export interface SeriesVisibility {
  expense: boolean
  income: boolean
}

const PLOT_HEIGHT = 176
const GUTTER = 44
const INSET = 20
const TICK_WIDTH = 44
const BUBBLE_WIDTH = 176
const MAX_BAR = 24

function niceCeiling(cents: number): number {
  if (cents <= 0) return 0
  const magnitude = 10 ** Math.floor(Math.log10(cents))
  const fraction = cents / magnitude
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return step * magnitude
}

function compactMoney(cents: number): string {
  const dollars = cents / 100
  if (dollars >= 1000000) return `$${(dollars / 1000000).toFixed(dollars % 1000000 === 0 ? 0 : 1)}M`
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(dollars % 1000 === 0 ? 0 : 1)}k`
  return `$${Math.round(dollars)}`
}

interface Geometry {
  baseline: number
  scale: number
  incomeMax: number
  expenseMax: number
  diverging: boolean
}

/**
 * With both series on, income rises above a shared baseline and spending hangs below it on one
 * scale, so a day's two bars never compete for the same slot. With one series on, it fills the
 * whole height.
 */
function geometry(flows: readonly Flow[], series: SeriesVisibility): Geometry {
  const incomeMax = series.income ? niceCeiling(Math.max(0, ...flows.map((flow) => flow.incomeCents))) : 0
  const expenseMax = series.expense ? niceCeiling(Math.max(0, ...flows.map((flow) => flow.expenseCents))) : 0
  const diverging = series.income && series.expense
  if (!diverging) {
    const top = Math.max(incomeMax, expenseMax)
    return { baseline: PLOT_HEIGHT, scale: top > 0 ? PLOT_HEIGHT / top : 0, incomeMax, expenseMax, diverging }
  }
  const share = incomeMax + expenseMax > 0 ? incomeMax / (incomeMax + expenseMax) : 0.5
  const baseline = Math.round(PLOT_HEIGHT * Math.min(0.75, Math.max(0.25, share)))
  const scale = Math.min(
    incomeMax > 0 ? (baseline - 1) / incomeMax : Infinity,
    expenseMax > 0 ? (PLOT_HEIGHT - baseline - 2) / expenseMax : Infinity
  )
  return { baseline, scale: Number.isFinite(scale) ? scale : 0, incomeMax, expenseMax, diverging }
}

function barHeight(cents: number, scale: number): number {
  if (cents <= 0) return 0
  return Math.max(2, cents * scale)
}

function readout(bucket: ChartBucket, flow: Flow, series: SeriesVisibility): string {
  const parts = [bucket.title]
  if (series.expense) parts.push(`spent ${money(flow.expenseCents)}`)
  if (series.income) parts.push(`received ${money(flow.incomeCents)}`)
  return parts.join(', ')
}

/**
 * The phone's scrubbed bar chart. The pointer reads a bar on hover and a click opens it; with the
 * chart focused, the arrow keys move between bars and Enter opens one.
 */
export function CashFlowChart({ title, buckets, flows, today, series, onSeriesChange, onOpen }: {
  title: string
  buckets: readonly ChartBucket[]
  flows: readonly Flow[]
  today: string
  series: SeriesVisibility
  onSeriesChange: (series: SeriesVisibility) => void
  onOpen: (bucket: ChartBucket) => void
}): React.ReactElement {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const identity = buckets.length > 0 ? `${buckets[0].key}:${buckets.length}` : ''
  useEffect(() => setSelected(null), [identity])

  useLayoutEffect(() => {
    const element = frame.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const plotWidth = Math.max(0, width - INSET * 2 - GUTTER)
  const slot = buckets.length > 0 ? plotWidth / buckets.length : 0
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot * 0.62))
  const radius = Math.min(4, barWidth / 2)
  /** Days after today have nothing to read, so the pointer stops at the last one that happened. */
  const lastReadable = useMemo(() => {
    for (let index = buckets.length - 1; index >= 0; index -= 1) if (buckets[index].from <= today) return index
    return -1
  }, [buckets, today])

  const shape = useMemo(() => geometry(flows, series), [flows, series])
  const totals = useMemo(() => flows.reduce((sum, flow) => ({
    incomeCents: sum.incomeCents + flow.incomeCents,
    expenseCents: sum.expenseCents + flow.expenseCents
  }), { incomeCents: 0, expenseCents: 0 }), [flows])

  const indexAt = (x: number): number | null => {
    if (slot <= 0 || lastReadable < 0) return null
    return Math.max(0, Math.min(lastReadable, Math.floor(x / slot)))
  }
  const pointAt = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>): number | null =>
    indexAt(event.clientX - event.currentTarget.getBoundingClientRect().left)
  const toggle = (key: keyof SeriesVisibility, value: boolean): void => onSeriesChange({ ...series, [key]: value })
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (lastReadable < 0) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 1 : -1
      setSelected((current) => Math.max(0, Math.min(lastReadable, (current ?? (delta > 0 ? -1 : lastReadable + 1)) + delta)))
    } else if (event.key === 'Enter' && selected !== null) {
      event.preventDefault()
      onOpen(buckets[selected])
    } else if (event.key === 'Escape' && selected !== null) {
      setSelected(null)
    }
  }

  const active = selected !== null ? buckets[selected] : null
  const activeFlow = selected !== null ? flows[selected] : null
  const center = selected !== null ? selected * slot + slot / 2 : 0
  const bubbleLeft = Math.max(0, Math.min(plotWidth + GUTTER - BUBBLE_WIDTH, center - BUBBLE_WIDTH / 2))
  const empty = totals.incomeCents === 0 && totals.expenseCents === 0

  return <div onPointerLeave={() => setSelected(null)}>
    <div ref={frame} className="relative">
      <div className="flex min-h-[64px] flex-col justify-center px-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] font-semibold">{title}</h2>
          {!empty && <span className="text-[13px] text-surface-500">Point to a bar to read it</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {series.expense && <span className="text-[14px] text-muted-foreground">Spent <span className="text-[14px] font-semibold text-foreground tabular"><BlurSpan>{money(totals.expenseCents)}</BlurSpan></span></span>}
          {series.income && <span className="text-[14px] text-muted-foreground">Received <span className="text-[14px] font-semibold text-foreground tabular"><BlurSpan>{money(totals.incomeCents)}</BlurSpan></span></span>}
        </div>
      </div>

      <div
        tabIndex={0}
        role="slider"
        aria-label={`${title} chart`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, lastReadable)}
        aria-valuenow={selected ?? 0}
        aria-valuetext={active && activeFlow ? readout(active, activeFlow, series) : 'No bar selected'}
        onKeyDown={onKey}
        className="relative mx-5 mt-3 rounded-sm"
        style={{ height: PLOT_HEIGHT }}
      >
        <div className="pointer-events-none absolute left-0 top-0" style={{ width: plotWidth, height: PLOT_HEIGHT }}>
          <div className="absolute left-0 right-0 top-0 h-px bg-[#1f1f1f]" />
          {shape.diverging && <div className="absolute bottom-0 left-0 right-0 h-px bg-[#1f1f1f]" />}
          <div className="absolute left-0 right-0 h-px bg-surface-700" style={{ top: shape.baseline - (shape.diverging ? 0 : 1) }} />
          {selected !== null && <div className="absolute bottom-0 top-0 w-px bg-surface-600" style={{ left: Math.round(center) }} />}
          {buckets.map((bucket, index) => {
            const flow = flows[index]
            const left = index * slot + (slot - barWidth) / 2
            const dim = selected !== null && selected !== index ? 0.3 : 1
            if (index > lastReadable) {
              return <div key={bucket.key} className="absolute h-[3px] w-[3px] rounded-full bg-[#333333]" style={{ left: index * slot + slot / 2 - 1.5, top: shape.baseline - 1.5 }} />
            }
            const income = series.income ? barHeight(flow.incomeCents, shape.scale) : 0
            const expense = series.expense ? barHeight(flow.expenseCents, shape.scale) : 0
            return <React.Fragment key={bucket.key}>
              {income > 0 && <div className="absolute" style={{
                left, width: barWidth, height: income, top: shape.baseline - (shape.diverging ? 1 : 0) - income,
                backgroundColor: SERIES_COLOR.income, opacity: dim, borderTopLeftRadius: radius, borderTopRightRadius: radius
              }} />}
              {expense > 0 && (shape.diverging
                ? <div className="absolute" style={{
                  left, width: barWidth, height: expense, top: shape.baseline + 2,
                  backgroundColor: SERIES_COLOR.expense, opacity: dim, borderBottomLeftRadius: radius, borderBottomRightRadius: radius
                }} />
                : <div className="absolute" style={{
                  left, width: barWidth, height: expense, top: shape.baseline - expense,
                  backgroundColor: SERIES_COLOR.expense, opacity: dim, borderTopLeftRadius: radius, borderTopRightRadius: radius
                }} />)}
            </React.Fragment>
          })}
        </div>

        <div className="pointer-events-none absolute bottom-0 right-0 top-0" style={{ width: GUTTER - 6 }}>
          <Blurred><span className="absolute right-0 top-0 text-[12px] text-muted-foreground tabular">
            {compactMoney(shape.diverging ? shape.incomeMax : Math.max(shape.incomeMax, shape.expenseMax))}
          </span></Blurred>
          {shape.diverging && <Blurred><span className="absolute bottom-0 right-0 text-[12px] text-muted-foreground tabular">
            {compactMoney(shape.expenseMax)}
          </span></Blurred>}
          <span className="absolute right-0 text-[12px] leading-4 text-muted-foreground tabular" style={{ top: Math.min(PLOT_HEIGHT - 16, Math.max(16, shape.baseline - 8)) }}>$0</span>
        </div>

        <div
          className="absolute left-0 top-0 cursor-pointer"
          style={{ width: plotWidth, height: PLOT_HEIGHT }}
          onPointerMove={(event) => setSelected(pointAt(event))}
          onClick={(event) => {
            const index = pointAt(event)
            if (index !== null) onOpen(buckets[index])
          }}
        />
      </div>

      <div className="pointer-events-none relative mx-5 mt-2 h-4" style={{ width: plotWidth }}>
        {buckets.map((bucket, index) => bucket.tick
          ? <span
            key={bucket.key}
            className="absolute truncate text-center text-[12px] leading-4 text-muted-foreground"
            style={{ width: TICK_WIDTH, left: Math.max(-4, Math.min(plotWidth - TICK_WIDTH + 4, index * slot + slot / 2 - TICK_WIDTH / 2)) }}
          >{bucket.tick}</span>
          : null)}
      </div>

      {active && activeFlow && <button
        type="button"
        aria-label={`${readout(active, activeFlow, series)}. Open`}
        onClick={() => onOpen(active)}
        className="absolute rounded-2xl border border-surface-700 bg-popover px-3.5 py-2 text-left transition-colors hover:bg-surface-800"
        style={{ top: 2, left: INSET + bubbleLeft, width: BUBBLE_WIDTH }}
      >
        <span className="flex items-center">
          <span className="flex-1 truncate text-[13px] font-medium text-muted-foreground">{active.title}</span>
          <ChevronRight color="#a3a3a3" size={15} />
        </span>
        {series.expense && <BubbleRow color={SERIES_COLOR.expense} label="Spent" cents={activeFlow.expenseCents} />}
        {series.income && <BubbleRow color={SERIES_COLOR.income} label="Received" cents={activeFlow.incomeCents} />}
      </button>}
    </div>

    <div className="mt-3 flex items-center gap-5 px-5 pb-3">
      <Checkbox
        label="Spending"
        color={SERIES_COLOR.expense}
        checked={series.expense}
        disabled={series.expense && !series.income}
        onCheckedChange={(value) => toggle('expense', value)}
      />
      <Checkbox
        label="Income"
        color={SERIES_COLOR.income}
        checked={series.income}
        disabled={series.income && !series.expense}
        onCheckedChange={(value) => toggle('income', value)}
      />
    </div>
  </div>
}

function BubbleRow({ color, label, cents }: { color: string; label: string; cents: number }): React.ReactElement {
  return <span className="mt-0.5 flex items-center">
    <span className="mr-2 h-[3px] w-3 rounded-full" style={{ backgroundColor: color }} />
    <span className="flex-1 text-[13px] text-muted-foreground">{label}</span>
    <Blurred><span className="text-[15px] font-semibold tabular">{money(cents)}</span></Blurred>
  </span>
}
