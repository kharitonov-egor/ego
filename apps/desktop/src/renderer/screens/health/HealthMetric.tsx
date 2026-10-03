import React, { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { HEALTH_HEART_CURVE_DAYS } from '@ego/api-contracts'
import { WEEKLY_ZONE_MINUTES_TARGET, formatSleepMinutes } from '@ego/core'
import { formatIso, shiftIso } from '@ego/local/dates'
import {
  METRIC_SPECS, isHealthMetric, mainSleep, metricSeries, periodFor, seriesStats, shiftPeriod, weekStart,
  weekZoneMinutes, type ChartPoint, type HealthIndex, type HealthMetric, type HealthRange, type MetricSpec
} from '@ego/local/health/metrics'
import { HeartCurve, Hypnogram, MetricChart } from '../../components/health/charts'
import { HealthGate, HealthMessage, partLine, readinessLabel } from '../../components/health/ui'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { useHealth } from '../../lib/health/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

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
  return <div className="min-w-0 flex-1 rounded-2xl bg-surface-900 px-3.5 py-3">
    <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
    <p className="mt-1 truncate text-[19px] font-bold tracking-tight">{value}</p>
    {detail && <p className="truncate text-[12px] text-surface-400">{detail}</p>}
  </div>
}

function DetailRow({ label, value, detail }: { label: string; value: string; detail?: string }): React.ReactElement {
  return <div className="flex min-h-11 items-center border-t border-surface-800 py-2">
    <span className="flex-1 text-[15px] text-muted-foreground">{label}</span>
    {detail && <span className="tabular mr-3 text-[13px] text-surface-500">{detail}</span>}
    <span className="tabular text-[15px] font-semibold">{value}</span>
  </div>
}

function withUnit(spec: MetricSpec, unit: string, value: number): string {
  return unit ? `${spec.format(value)} ${unit}` : spec.format(value)
}

function SleepNight({ index, date }: { index: HealthIndex; date: string }): React.ReactElement {
  const night = mainSleep(index, date)
  const naps = (index.nights.get(date) ?? []).filter((sleep) => sleep.nap)
  if (!night) {
    return <Card className="p-5"><p className="text-[15px] text-muted-foreground">No main sleep recorded for the night before {formatIso(date)}.</p></Card>
  }
  const staged = night.deepMinutes !== null
  const share = (minutes: number | null): string | undefined =>
    minutes === null || night.minutesInBed === 0 ? undefined : `${Math.round((minutes / night.minutesInBed) * 100)}%`
  return <Card className="p-5">
    <h2 className="text-[17px] font-semibold">{`${clock(night.startLocal)} to ${clock(night.endLocal)}`}</h2>
    <p className="mt-0.5 text-[14px] text-muted-foreground">{`${formatSleepMinutes(night.minutesInBed)} in bed, ${formatSleepMinutes(night.minutesAwake)} awake`}</p>
    <div className="mt-4"><Hypnogram stages={night.stages} minutesInBed={night.minutesInBed} startLocal={night.startLocal} endLocal={night.endLocal} /></div>
    <div className="mt-3">
      <DetailRow label="Asleep" value={formatSleepMinutes(night.minutesAsleep)} />
      {staged && <>
        <DetailRow label="Deep" value={formatSleepMinutes(night.deepMinutes ?? 0)} detail={share(night.deepMinutes)} />
        <DetailRow label="Light" value={formatSleepMinutes(night.lightMinutes ?? 0)} detail={share(night.lightMinutes)} />
        <DetailRow label="REM" value={formatSleepMinutes(night.remMinutes ?? 0)} detail={share(night.remMinutes)} />
      </>}
      <DetailRow label="Awake" value={formatSleepMinutes(night.minutesAwake)} detail={share(night.minutesAwake)} />
      {naps.map((nap) => <DetailRow key={nap.id} label={`Nap at ${clock(nap.startLocal)}`} value={formatSleepMinutes(nap.minutesAsleep)} />)}
    </div>
  </Card>
}

function HeartDay({ index, date, today }: { index: HealthIndex; date: string; today: string }): React.ReactElement {
  const day = index.days.get(date)
  const curve = index.heart.get(date)
  return <Card className="p-5">
    <h2 className="text-[17px] font-semibold">Through the day</h2>
    <div className="mt-3">
      {curve && curve.points.length > 0
        ? <HeartCurve points={curve.points} resting={day?.restingHeartRate ?? null} />
        : <p className="text-[15px] leading-6 text-muted-foreground">
          {date < shiftIso(today, -(HEALTH_HEART_CURVE_DAYS - 1))
            ? `The five-minute curve covers the last ${HEALTH_HEART_CURVE_DAYS} days. Older days keep their daily numbers below.`
            : 'No five-minute readings for this day yet.'}
        </p>}
    </div>
    <div className="mt-3">
      {day?.heartRateAvg != null && <DetailRow label="Average" value={`${Math.round(day.heartRateAvg)} bpm`} />}
      {day?.heartRateMin != null && <DetailRow label="Lowest" value={`${Math.round(day.heartRateMin)} bpm`} />}
      {day?.heartRateMax != null && <DetailRow label="Highest" value={`${Math.round(day.heartRateMax)} bpm`} />}
      {day?.restingHeartRate != null && <DetailRow label="Resting" value={`${day.restingHeartRate} bpm`} />}
    </div>
  </Card>
}

function ReadinessDay({ index, date }: { index: HealthIndex; date: string }): React.ReactElement {
  const readiness = index.readiness.get(date)
  return <Card className="p-5">
    {readiness
      ? <>
        <h2 className="text-[17px] font-semibold">{`${readiness.score}, ${readinessLabel(readiness)}`}</h2>
        <div className="mt-2">{readiness.parts.map((part) => {
          const line = partLine(part)
          return <DetailRow key={part.key} label={line.label} value={line.value} detail={line.detail} />
        })}</div>
      </>
      : <p className="text-[15px] leading-6 text-muted-foreground">No score for this day. It needs that morning's HRV or resting heart rate and at least a week of readings before it.</p>}
    <p className="mt-4 text-[13px] leading-5 text-surface-400">
      Google keeps its readiness score inside its own app, so Ego scores the same inputs itself. HRV and resting heart rate are compared with your previous 30 days, and sleep with 7h 30m. HRV weighs most, then resting heart rate, then sleep. A usual day lands near 60, and 70 or more reads as high.
    </p>
  </Card>
}

function WeeklyCardio({ index, date }: { index: HealthIndex; date: string }): React.ReactElement {
  const day = index.days.get(date)
  const total = weekZoneMinutes(index, shiftIso(weekStart(date), 6))
  const share = Math.min(1, total / WEEKLY_ZONE_MINUTES_TARGET)
  return <Card className="p-5">
    <h2 className="text-[17px] font-semibold">{`Week of ${formatIso(weekStart(date))}`}</h2>
    <p className="mt-0.5 text-[14px] text-muted-foreground">{`${total} of ${WEEKLY_ZONE_MINUTES_TARGET} zone minutes`}</p>
    <div
      role="progressbar"
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${Math.round(share * 100)} percent of the weekly goal`}
      className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-800"
    >
      <div className="h-full rounded-full bg-foreground" style={{ width: `${share * 100}%` }} />
    </div>
    <div className="mt-3">
      <DetailRow label="Fat burn" value={`${day?.fatBurnMinutes ?? 0} min`} />
      <DetailRow label="Cardio" value={`${day?.cardioMinutes ?? 0} min`} />
      <DetailRow label="Peak" value={`${day?.peakMinutes ?? 0} min`} />
    </div>
    <p className="mt-3 text-[13px] leading-5 text-surface-400">
      {`Zone minutes for ${formatIso(date)}. Google counts each minute in the cardio or peak zone twice. Google's cardio load score is not available to other apps, so weekly cardio here is zone minutes against the ${WEEKLY_ZONE_MINUTES_TARGET}-minute weekly goal.`}
    </p>
  </Card>
}

function heroCaption(point: ChartPoint, range: HealthRange, spec: MetricSpec): string {
  if (range !== 'year') return point.title
  return spec.summary === 'total' ? `${point.title}, daily average` : `${point.title}, average`
}

/** The metric over a week, month, or year. On a wide window the list of values sits beside the details. */
function MetricView({ param, opened }: { param: string | undefined; opened: string | null }): React.ReactElement {
  const health = useHealth()
  const { index, units, today } = health
  const start = opened !== null && opened <= today ? opened : today
  const back = opened !== null && opened < today ? `/health?date=${opened}` : '/health'
  const [range, setRange] = useState<HealthRange>('week')
  const [anchor, setAnchor] = useState(start)
  const [selected, setSelected] = useState<string | null>(start)
  if (!isHealthMetric(param)) {
    return <Screen>
      <ScreenHeader title="" back="/health" />
      <HealthMessage title="Nothing to show" detail="That metric does not exist." />
    </Screen>
  }
  const metric: HealthMetric = param
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
  const detail = detailDate === null ? null
    : metric === 'sleep' ? <SleepNight index={index} date={detailDate} />
      : metric === 'heart' ? <HeartDay index={index} date={detailDate} today={today} />
        : metric === 'readiness' ? <ReadinessDay index={index} date={detailDate} />
          : metric === 'zone' ? <WeeklyCardio index={index} date={detailDate} />
            : null

  return <Screen>
    <ScreenHeader title={spec.title} back={back} />
    <HealthGate>
      <ScreenBody width="wide" className="flex flex-col gap-3 pb-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <SegmentedControl options={RANGES} value={range} onValueChange={changeRange} className="md:w-80" />
          <div className="flex flex-1 items-center">
            <IconButton label={`Previous ${range}`} disabled={period.start <= earliest} onClick={() => move(-1)} className="h-10 w-10">
              <ChevronLeft color={color.text} size={22} />
            </IconButton>
            <p aria-live="polite" className="flex-1 text-center text-[16px] font-semibold">{period.label}</p>
            <IconButton label={`Next ${range}`} disabled={period.end >= today} onClick={() => move(1)} className="h-10 w-10">
              <ChevronRight color={color.text} size={22} />
            </IconButton>
          </div>
        </div>

        <Card className="px-4 pb-3 pt-5">
          <div className="px-1">
            {current && current.value !== null
              ? <>
                <div className="flex items-baseline">
                  <span className="text-[44px] font-bold tracking-tight">{spec.format(current.value)}</span>
                  {unit !== '' && <span className="ml-1.5 text-[17px] text-muted-foreground">{unit}</span>}
                </div>
                <p className="text-[14px] text-muted-foreground">{heroCaption(current, range, spec)}</p>
              </>
              : <>
                <p className="text-[28px] font-bold text-surface-600">No data</p>
                <p className="text-[14px] text-muted-foreground">Nothing recorded in this {range}.</p>
              </>}
          </div>
          <div className="mt-4">
            <MetricChart
              points={points}
              spec={spec}
              selectedKey={current?.key ?? null}
              onSelect={setSelected}
              label={`${spec.title} for ${period.label}. The list below the chart has every value.`}
              describe={(point) => ({ title: heroCaption(point, range, spec), value: withUnit(spec, unit, point.value) })}
            />
          </div>
          {range === 'year' && <p className="px-1 pt-1 text-[12px] text-surface-500">Each month shows its daily average. Click a month in the list to open it.</p>}
        </Card>

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              {statTiles.map((tile) => <Stat key={tile.label} label={tile.label} value={tile.value} detail={tile.detail} />)}
            </div>
            {detail}
          </div>

          {listed.length > 0 && <Card className="px-5 pb-2 pt-4">
            <h2 className="text-[15px] font-semibold text-muted-foreground">{range === 'year' ? 'Months' : 'Days'}</h2>
            <div className="mt-2">{listed.map((point) => <button
              key={point.key}
              type="button"
              aria-pressed={point.key === current?.key}
              onClick={() => choose(point)}
              className="flex min-h-12 w-full items-center gap-1 border-t border-surface-800 py-2 text-left transition-colors hover:bg-surface-900 active:bg-surface-900"
            >
              <span className={cn('flex-1 text-[15px]', point.key === current?.key ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{point.title}</span>
              <span className="tabular text-[15px] font-semibold">{withUnit(spec, unit, point.value)}</span>
              {range === 'year' && <ChevronRight color={color.textFaint} size={16} />}
            </button>)}</div>
          </Card>}
        </div>
      </ScreenBody>
    </HealthGate>
  </Screen>
}

/** Each metric and day opens fresh, as a new screen on the phone's stack does. */
export default function HealthMetricScreen(): React.ReactElement {
  const { metric } = useParams()
  const [params] = useSearchParams()
  const opened = params.get('date')
  return <MetricView key={`${metric ?? ''}:${opened ?? ''}`} param={metric} opened={opened} />
}
