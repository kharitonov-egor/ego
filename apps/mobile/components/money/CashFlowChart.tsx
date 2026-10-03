import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import type { Flow } from '@ego/local/cash-flow'
import type { ChartBucket } from '@ego/local/periods'
import { Checkbox } from '../ui/checkbox'
import { Text } from '../ui/text'
import { money } from './Common'
import { color, tabular } from './tokens'
import { BlurSpan, Blurred } from '../../lib/blur'

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
/** A tap this short and this still toggles the selection instead of scrubbing. */
const TAP_MS = 220
const TAP_SLOP = 6

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

interface Gesture {
  x: number
  startedAt: number
  previous: number | null
  index: number | null
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

export function CashFlowChart({ title, buckets, flows, today, series, onSeriesChange, onScrubbingChange, onOpen }: {
  title: string
  buckets: readonly ChartBucket[]
  flows: readonly Flow[]
  today: string
  series: SeriesVisibility
  onSeriesChange: (series: SeriesVisibility) => void
  onScrubbingChange: (scrubbing: boolean) => void
  onOpen: (bucket: ChartBucket) => void
}): React.ReactElement {
  const [width, setWidth] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [touching, setTouching] = useState(false)
  const identity = buckets.length > 0 ? `${buckets[0].key}:${buckets.length}` : ''
  useEffect(() => setSelected(null), [identity])

  const plotWidth = Math.max(0, width - INSET * 2 - GUTTER)
  const slot = buckets.length > 0 ? plotWidth / buckets.length : 0
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot * 0.62))
  const radius = Math.min(4, barWidth / 2)
  /** Days after today have nothing to read, so the finger stops at the last one that happened. */
  const lastReadable = useMemo(() => {
    for (let index = buckets.length - 1; index >= 0; index -= 1) if (buckets[index].from <= today) return index
    return -1
  }, [buckets, today])

  const shape = useMemo(() => geometry(flows, series), [flows, series])
  const totals = useMemo(() => flows.reduce((sum, flow) => ({
    incomeCents: sum.incomeCents + flow.incomeCents,
    expenseCents: sum.expenseCents + flow.expenseCents
  }), { incomeCents: 0, expenseCents: 0 }), [flows])

  const live = useRef({ slot, lastReadable, selected, onScrubbingChange })
  live.current = { slot, lastReadable, selected, onScrubbingChange }
  const gesture = useRef<Gesture>({ x: 0, startedAt: 0, previous: null, index: null })

  const responder = useMemo(() => {
    const indexAt = (x: number): number | null => {
      const { slot: size, lastReadable: last } = live.current
      if (size <= 0 || last < 0) return null
      return Math.max(0, Math.min(last, Math.floor(x / size)))
    }
    const finish = (tap: boolean): void => {
      setTouching(false)
      live.current.onScrubbingChange(false)
      if (tap && gesture.current.previous !== null && gesture.current.previous === gesture.current.index) setSelected(null)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        const index = indexAt(event.nativeEvent.locationX)
        gesture.current = { x: event.nativeEvent.locationX, startedAt: Date.now(), previous: live.current.selected, index }
        setSelected(index)
        setTouching(true)
        live.current.onScrubbingChange(true)
      },
      onPanResponderMove: (_, state) => {
        const index = indexAt(gesture.current.x + state.dx)
        if (index === gesture.current.index) return
        gesture.current.index = index
        setSelected(index)
      },
      onPanResponderRelease: (_, state) => {
        finish(Date.now() - gesture.current.startedAt < TAP_MS && Math.abs(state.dx) < TAP_SLOP && Math.abs(state.dy) < TAP_SLOP)
      },
      onPanResponderTerminate: () => finish(false)
    })
  }, [])

  const onLayout = (event: LayoutChangeEvent): void => setWidth(event.nativeEvent.layout.width)
  const toggle = (key: keyof SeriesVisibility, value: boolean): void => onSeriesChange({ ...series, [key]: value })
  const moveSelection = (event: AccessibilityActionEvent): void => {
    if (lastReadable < 0) return
    const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1
    setSelected((current) => Math.max(0, Math.min(lastReadable, (current ?? (delta > 0 ? -1 : lastReadable + 1)) + delta)))
  }

  const active = selected !== null ? buckets[selected] : null
  const activeFlow = selected !== null ? flows[selected] : null
  const center = selected !== null ? selected * slot + slot / 2 : 0
  const bubbleLeft = Math.max(0, Math.min(plotWidth + GUTTER - BUBBLE_WIDTH, center - BUBBLE_WIDTH / 2))
  const empty = totals.incomeCents === 0 && totals.expenseCents === 0

  return <View>
    <View onLayout={onLayout}>
      <View className="min-h-[64px] justify-center px-5">
        <View className="flex-row items-baseline justify-between">
          <Text accessibilityRole="header" className="text-[18px] font-semibold">{title}</Text>
          {!empty && <Text className="text-[13px] text-surface-500">Drag to explore</Text>}
        </View>
        <View className="mt-1 flex-row flex-wrap gap-x-4">
          {series.expense && <Text className="text-[14px] text-muted-foreground">Spent <Text className="text-[14px] font-semibold" style={tabular}><BlurSpan>{money(totals.expenseCents)}</BlurSpan></Text></Text>}
          {series.income && <Text className="text-[14px] text-muted-foreground">Received <Text className="text-[14px] font-semibold" style={tabular}><BlurSpan>{money(totals.incomeCents)}</BlurSpan></Text></Text>}
        </View>
      </View>

      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${title} chart`}
        accessibilityHint="Swipe up or down to read one bar at a time"
        accessibilityValue={{ text: active && activeFlow ? readout(active, activeFlow, series) : 'No bar selected' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={moveSelection}
        className="mx-5 mt-3"
        style={{ height: PLOT_HEIGHT }}
      >
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: plotWidth, height: PLOT_HEIGHT }}>
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: '#1f1f1f' }} />
          {shape.diverging && <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: '#1f1f1f' }} />}
          <View style={{ position: 'absolute', left: 0, right: 0, top: shape.baseline - (shape.diverging ? 0 : 1), height: 1, backgroundColor: '#404040' }} />
          {selected !== null && <View style={{ position: 'absolute', top: 0, bottom: 0, left: Math.round(center), width: 1, backgroundColor: '#525252' }} />}
          {buckets.map((bucket, index) => {
            const flow = flows[index]
            const left = index * slot + (slot - barWidth) / 2
            const dim = selected !== null && selected !== index ? 0.3 : 1
            if (index > lastReadable) {
              return <View key={bucket.key} style={{ position: 'absolute', left: index * slot + slot / 2 - 1.5, top: shape.baseline - 1.5, width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#333333' }} />
            }
            const income = series.income ? barHeight(flow.incomeCents, shape.scale) : 0
            const expense = series.expense ? barHeight(flow.expenseCents, shape.scale) : 0
            return <React.Fragment key={bucket.key}>
              {income > 0 && <View style={{
                position: 'absolute', left, width: barWidth, height: income, top: shape.baseline - (shape.diverging ? 1 : 0) - income,
                backgroundColor: SERIES_COLOR.income, opacity: dim, borderTopLeftRadius: radius, borderTopRightRadius: radius
              }} />}
              {expense > 0 && (shape.diverging
                ? <View style={{
                  position: 'absolute', left, width: barWidth, height: expense, top: shape.baseline + 2,
                  backgroundColor: SERIES_COLOR.expense, opacity: dim, borderBottomLeftRadius: radius, borderBottomRightRadius: radius
                }} />
                : <View style={{
                  position: 'absolute', left, width: barWidth, height: expense, top: shape.baseline - expense,
                  backgroundColor: SERIES_COLOR.expense, opacity: dim, borderTopLeftRadius: radius, borderTopRightRadius: radius
                }} />)}
            </React.Fragment>
          })}
        </View>

        <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: GUTTER - 6 }}>
          <Blurred tint={color.textMuted}><Text className="absolute right-0 top-0 text-[12px] text-muted-foreground" style={tabular}>
            {compactMoney(shape.diverging ? shape.incomeMax : Math.max(shape.incomeMax, shape.expenseMax))}
          </Text></Blurred>
          {shape.diverging && <Blurred tint={color.textMuted}><Text className="absolute bottom-0 right-0 text-[12px] text-muted-foreground" style={tabular}>
            {compactMoney(shape.expenseMax)}
          </Text></Blurred>}
          <Text className="absolute right-0 text-[12px] text-muted-foreground" style={{ ...tabular, top: Math.min(PLOT_HEIGHT - 16, Math.max(16, shape.baseline - 8)) }}>$0</Text>
        </View>

        <View {...responder.panHandlers} style={{ position: 'absolute', left: 0, top: 0, width: plotWidth, height: PLOT_HEIGHT }} />
      </View>

      <View pointerEvents="none" className="mx-5 mt-2 h-4" style={{ width: plotWidth }}>
        {buckets.map((bucket, index) => bucket.tick
          ? <Text
            key={bucket.key}
            numberOfLines={1}
            className="absolute text-center text-[12px] text-muted-foreground"
            style={{ width: TICK_WIDTH, left: Math.max(-4, Math.min(plotWidth - TICK_WIDTH + 4, index * slot + slot / 2 - TICK_WIDTH / 2)) }}
          >{bucket.tick}</Text>
          : null)}
      </View>

      {active && activeFlow && <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${readout(active, activeFlow, series)}. Open`}
        disabled={touching}
        onPress={() => onOpen(active)}
        className="absolute rounded-2xl border border-surface-700 bg-popover px-3.5 py-2 active:bg-surface-800"
        style={{ top: 2, left: INSET + bubbleLeft, width: BUBBLE_WIDTH }}
      >
        <View className="flex-row items-center">
          <Text numberOfLines={1} className="flex-1 text-[13px] font-medium text-muted-foreground">{active.title}</Text>
          {!touching && <ChevronRight color="#a3a3a3" size={15} />}
        </View>
        {series.expense && <BubbleRow color={SERIES_COLOR.expense} label="Spent" cents={activeFlow.expenseCents} />}
        {series.income && <BubbleRow color={SERIES_COLOR.income} label="Received" cents={activeFlow.incomeCents} />}
      </Pressable>}
    </View>

    <View className="mt-3 flex-row items-center gap-5 px-5 pb-3">
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
    </View>
  </View>
}

function BubbleRow({ color, label, cents }: { color: string; label: string; cents: number }): React.ReactElement {
  return <View className="mt-0.5 flex-row items-center">
    <View className="mr-2 h-[3px] w-3 rounded-full" style={{ backgroundColor: color }} />
    <Text className="flex-1 text-[13px] text-muted-foreground">{label}</Text>
    <Blurred><Text className="text-[15px] font-semibold" style={tabular}>{money(cents)}</Text></Blurred>
  </View>
}
