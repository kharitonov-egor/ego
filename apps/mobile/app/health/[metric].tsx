import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { HEALTH_HEART_CURVE_DAYS } from '@ego/api-contracts'
import { WEEKLY_ZONE_MINUTES_TARGET, formatSleepMinutes } from '@ego/core'
import { HeartCurve, Hypnogram, MetricChart } from '../../components/health/charts'
import { HealthGate, HealthMessage, partLine, readinessLabel } from '../../components/health/ui'
import { color, tabular } from '../../components/money/tokens'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { Text } from '../../components/ui/text'
import { formatIso, shiftIso } from '../../lib/dates'
import { useHealth } from '../../lib/health/context'
import {
  METRIC_SPECS, isHealthMetric, mainSleep, metricSeries, periodFor, seriesStats, shiftPeriod, weekStart,
  weekZoneMinutes, type ChartPoint, type HealthIndex, type HealthMetric, type HealthRange, type MetricSpec
} from '../../lib/health/metrics'

const RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' }
] as const

function clock(local: string): string {
  const hours = Number(local.slice(11, 13))
  return `${hours % 12 === 0 ? 12 : hours % 12}:${local.slice(14, 16)} ${hours < 12 ? 'AM' : 'PM'}`
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }): React.ReactElement {
  return <View className="flex-1 rounded-2xl bg-surface-900 px-3.5 py-3">
    <Text className="text-[13px] font-medium text-muted-foreground">{label}</Text>
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} className="mt-1 text-[19px] font-bold tracking-tight">{value}</Text>
    {detail && <Text numberOfLines={1} className="text-[12px] text-surface-400">{detail}</Text>}
  </View>
}

function DetailRow({ label, value, detail }: { label: string; value: string; detail?: string }): React.ReactElement {
  return <View className="min-h-11 flex-row items-center border-t border-surface-800 py-2">
    <Text className="flex-1 text-[15px] text-muted-foreground">{label}</Text>
    {detail && <Text className="mr-3 text-[13px] text-surface-500" style={tabular}>{detail}</Text>}
    <Text className="text-[15px] font-semibold" style={tabular}>{value}</Text>
  </View>
}

function withUnit(spec: MetricSpec, unit: string, value: number): string {
  return unit ? `${spec.format(value)} ${unit}` : spec.format(value)
}

function SleepNight({ index, date }: { index: HealthIndex; date: string }): React.ReactElement {
  const night = mainSleep(index, date)
  const naps = (index.nights.get(date) ?? []).filter((sleep) => sleep.nap)
  if (!night) {
    return <Card className="p-5"><Text className="text-[15px] text-muted-foreground">No main sleep recorded for the night before {formatIso(date)}.</Text></Card>
  }
  const staged = night.deepMinutes !== null
  const share = (minutes: number | null): string | undefined =>
    minutes === null || night.minutesInBed === 0 ? undefined : `${Math.round((minutes / night.minutesInBed) * 100)}%`
  return <Card className="p-5">
    <Text accessibilityRole="header" className="text-[17px] font-semibold">{`${clock(night.startLocal)} to ${clock(night.endLocal)}`}</Text>
    <Text className="mt-0.5 text-[14px] text-muted-foreground">{`${formatSleepMinutes(night.minutesInBed)} in bed, ${formatSleepMinutes(night.minutesAwake)} awake`}</Text>
    <View className="mt-4"><Hypnogram stages={night.stages} minutesInBed={night.minutesInBed} startLocal={night.startLocal} endLocal={night.endLocal} /></View>
    <View className="mt-3">
      <DetailRow label="Asleep" value={formatSleepMinutes(night.minutesAsleep)} />
      {staged && <>
        <DetailRow label="Deep" value={formatSleepMinutes(night.deepMinutes ?? 0)} detail={share(night.deepMinutes)} />
        <DetailRow label="Light" value={formatSleepMinutes(night.lightMinutes ?? 0)} detail={share(night.lightMinutes)} />
        <DetailRow label="REM" value={formatSleepMinutes(night.remMinutes ?? 0)} detail={share(night.remMinutes)} />
      </>}
      <DetailRow label="Awake" value={formatSleepMinutes(night.minutesAwake)} detail={share(night.minutesAwake)} />
      {naps.map((nap) => <DetailRow key={nap.id} label={`Nap at ${clock(nap.startLocal)}`} value={formatSleepMinutes(nap.minutesAsleep)} />)}
    </View>
  </Card>
}

function HeartDay({ index, date, today }: { index: HealthIndex; date: string; today: string }): React.ReactElement {
  const day = index.days.get(date)
  const curve = index.heart.get(date)
  return <Card className="p-5">
    <Text accessibilityRole="header" className="text-[17px] font-semibold">Through the day</Text>
    <View className="mt-3">
      {curve && curve.points.length > 0
        ? <HeartCurve points={curve.points} resting={day?.restingHeartRate ?? null} />
        : <Text className="text-[15px] leading-6 text-muted-foreground">
          {date < shiftIso(today, -(HEALTH_HEART_CURVE_DAYS - 1))
            ? `The five-minute curve covers the last ${HEALTH_HEART_CURVE_DAYS} days. Older days keep their daily numbers below.`
            : 'No five-minute readings for this day yet.'}
        </Text>}
    </View>
    <View className="mt-3">
      {day?.heartRateAvg != null && <DetailRow label="Average" value={`${Math.round(day.heartRateAvg)} bpm`} />}
      {day?.heartRateMin != null && <DetailRow label="Lowest" value={`${Math.round(day.heartRateMin)} bpm`} />}
      {day?.heartRateMax != null && <DetailRow label="Highest" value={`${Math.round(day.heartRateMax)} bpm`} />}
      {day?.restingHeartRate != null && <DetailRow label="Resting" value={`${day.restingHeartRate} bpm`} />}
    </View>
  </Card>
}

function ReadinessDay({ index, date }: { index: HealthIndex; date: string }): React.ReactElement {
  const readiness = index.readiness.get(date)
  return <Card className="p-5">
    {readiness
      ? <>
        <Text accessibilityRole="header" className="text-[17px] font-semibold">{`${readiness.score}, ${readinessLabel(readiness)}`}</Text>
        <View className="mt-2">{readiness.parts.map((part) => {
          const line = partLine(part)
          return <DetailRow key={part.key} label={line.label} value={line.value} detail={line.detail} />
        })}</View>
      </>
      : <Text className="text-[15px] leading-6 text-muted-foreground">No score for this day. It needs that morning's HRV or resting heart rate and at least a week of readings before it.</Text>}
    <Text className="mt-4 text-[13px] leading-5 text-surface-400">
      Google keeps its readiness score inside its own app, so Ego scores the same inputs itself. HRV and resting heart rate are compared with your previous 30 days, and sleep with 7h 30m. HRV weighs most, then resting heart rate, then sleep. A usual day lands near 60, and 70 or more reads as high.
    </Text>
  </Card>
}

function WeeklyCardio({ index, date }: { index: HealthIndex; date: string }): React.ReactElement {
  const day = index.days.get(date)
  const total = weekZoneMinutes(index, shiftIso(weekStart(date), 6))
  const share = Math.min(1, total / WEEKLY_ZONE_MINUTES_TARGET)
  return <Card className="p-5">
    <Text accessibilityRole="header" className="text-[17px] font-semibold">{`Week of ${formatIso(weekStart(date))}`}</Text>
    <Text className="mt-0.5 text-[14px] text-muted-foreground">{`${total} of ${WEEKLY_ZONE_MINUTES_TARGET} zone minutes`}</Text>
    <View accessibilityLabel={`${Math.round(share * 100)} percent of the weekly goal`} className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-800">
      <View className="h-full rounded-full bg-foreground" style={{ width: `${share * 100}%` }} />
    </View>
    <View className="mt-3">
      <DetailRow label="Fat burn" value={`${day?.fatBurnMinutes ?? 0} min`} />
      <DetailRow label="Cardio" value={`${day?.cardioMinutes ?? 0} min`} />
      <DetailRow label="Peak" value={`${day?.peakMinutes ?? 0} min`} />
    </View>
    <Text className="mt-3 text-[13px] leading-5 text-surface-400">
      {`Zone minutes for ${formatIso(date)}. Google counts each minute in the cardio or peak zone twice. Google's cardio load score is not available to other apps, so weekly cardio here is zone minutes against the ${WEEKLY_ZONE_MINUTES_TARGET}-minute weekly goal.`}
    </Text>
  </Card>
}

function heroCaption(point: ChartPoint, range: HealthRange, spec: MetricSpec): string {
  if (range !== 'year') return point.title
  return spec.summary === 'total' ? `${point.title}, daily average` : `${point.title}, average`
}

export default function HealthMetricScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ metric: string; date?: string }>()
  const health = useHealth()
  const { index, units, today } = health
  const start = typeof params.date === 'string' && params.date <= today ? params.date : today
  const [range, setRange] = useState<HealthRange>('week')
  const [anchor, setAnchor] = useState(start)
  const [selected, setSelected] = useState<string | null>(start)
  if (!isHealthMetric(params.metric)) {
    return <HealthMessage title="Nothing to show" detail="That metric does not exist." />
  }
  const metric: HealthMetric = params.metric
  const spec = METRIC_SPECS[metric]
  const unit = spec.unit(units)
  const period = periodFor(range, anchor)
  const points = metricSeries(index, metric, period, units, today)
  const stats = seriesStats(points)
  const current = points.find((point) => point.key === selected && point.value !== null) ??
    [...points].reverse().find((point) => point.value !== null) ?? null
  const earliest = index.firstDate ?? today
  const detailDate = current?.date ?? null

  const changeRange = (next: HealthRange): void => {
    setRange(next)
    if (current?.date) setAnchor(current.date)
  }
  const move = (steps: number): void => {
    const next = shiftPeriod(period, steps)
    setAnchor(next.end > today ? today : next.end)
    setSelected(null)
  }
  const choose = (point: ChartPoint): void => {
    if (range === 'year') {
      setRange('month')
      setAnchor(point.key)
      setSelected(null)
      return
    }
    setSelected(point.key)
  }

  const format = (value: number | null): string => value === null ? 'No data' : withUnit(spec, unit, value)
  const statTiles = spec.summary === 'total' && metric !== 'sleep'
    ? [
      { label: range === 'year' ? 'Daily average' : 'Average', value: format(stats.average) },
      { label: 'Best', value: format(stats.high?.value ?? null), detail: stats.high?.title },
      range === 'year'
        ? { label: 'Lowest', value: format(stats.low?.value ?? null), detail: stats.low?.title }
        : { label: 'Total', value: format(stats.total) }
    ]
    : [
      { label: 'Average', value: format(stats.average) },
      { label: 'Lowest', value: format(stats.low?.value ?? null), detail: stats.low?.title },
      { label: 'Highest', value: format(stats.high?.value ?? null), detail: stats.high?.title }
    ]
  const listed = [...points].reverse().filter((point): point is ChartPoint & { value: number } => point.value !== null)

  return <>
    <Stack.Screen options={{ title: spec.title }} />
    <HealthGate>
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}>
        <SegmentedControl options={RANGES} value={range} onValueChange={changeRange} />
        <View className="flex-row items-center">
          <Button variant="ghost" size="icon" accessibilityLabel={`Previous ${range}`} disabled={period.start <= earliest} onPress={() => move(-1)}>
            <ChevronLeft color={color.text} size={22} />
          </Button>
          <Text accessibilityLiveRegion="polite" className="flex-1 text-center text-[16px] font-semibold">{period.label}</Text>
          <Button variant="ghost" size="icon" accessibilityLabel={`Next ${range}`} disabled={period.end >= today} onPress={() => move(1)}>
            <ChevronRight color={color.text} size={22} />
          </Button>
        </View>

        <Card className="px-4 pb-3 pt-5">
          <View className="px-1">
            {current && current.value !== null
              ? <>
                <View className="flex-row items-baseline">
                  <Text className="text-[44px] font-bold tracking-tight">{spec.format(current.value)}</Text>
                  {unit !== '' && <Text className="ml-1.5 text-[17px] text-muted-foreground">{unit}</Text>}
                </View>
                <Text className="text-[14px] text-muted-foreground">{heroCaption(current, range, spec)}</Text>
              </>
              : <>
                <Text className="text-[28px] font-bold text-surface-600">No data</Text>
                <Text className="text-[14px] text-muted-foreground">Nothing recorded in this {range}.</Text>
              </>}
          </View>
          <View className="mt-4">
            <MetricChart
              points={points}
              spec={spec}
              selectedKey={current?.key ?? null}
              onSelect={setSelected}
              accessibilityLabel={`${spec.title} for ${period.label}. The list below the chart has every value.`}
            />
          </View>
          {range === 'year' && <Text className="px-1 pt-1 text-[12px] text-surface-500">Each month shows its daily average. Tap a month in the list to open it.</Text>}
        </Card>

        <View className="flex-row gap-2">
          {statTiles.map((tile) => <Stat key={tile.label} label={tile.label} value={tile.value} detail={tile.detail} />)}
        </View>

        {detailDate && metric === 'sleep' && <SleepNight index={index} date={detailDate} />}
        {detailDate && metric === 'heart' && <HeartDay index={index} date={detailDate} today={today} />}
        {detailDate && metric === 'readiness' && <ReadinessDay index={index} date={detailDate} />}
        {detailDate && metric === 'zone' && <WeeklyCardio index={index} date={detailDate} />}

        {listed.length > 0 && <Card className="px-5 pb-2 pt-4">
          <Text accessibilityRole="header" className="text-[15px] font-semibold text-muted-foreground">{range === 'year' ? 'Months' : 'Days'}</Text>
          <View className="mt-2">{listed.map((point) => <Pressable
            key={point.key}
            accessibilityRole="button"
            accessibilityState={{ selected: point.key === current?.key }}
            onPress={() => choose(point)}
            className="min-h-12 flex-row items-center border-t border-surface-800 py-2 active:bg-surface-900"
          >
            <Text className={`flex-1 text-[15px] ${point.key === current?.key ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{point.title}</Text>
            <Text className="text-[15px] font-semibold" style={tabular}>{withUnit(spec, unit, point.value)}</Text>
            {range === 'year' && <ChevronRight color={color.textFaint} size={16} />}
          </Pressable>)}</View>
        </Card>}
      </ScrollView>
    </HealthGate>
  </>
}
