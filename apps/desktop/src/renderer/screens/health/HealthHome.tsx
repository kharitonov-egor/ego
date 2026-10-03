import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import {
  Activity, Flame, Footprints, HeartPulse, Moon, RefreshCw, Route, Scale, Settings2, Waves, Zap, type LucideIcon
} from 'lucide-react'
import {
  DAILY_STEP_TARGET, WEEKLY_ZONE_MINUTES_TARGET, bodyWeightUnit, distanceUnit, formatSleepMinutes
} from '@ego/core'
import { formatIso, shiftIso } from '@ego/local/dates'
import { latestValue, mainSleep, metricValue, weekZoneMinutes, type HealthMetric } from '@ego/local/health/metrics'
import { CalendarDialog } from '../../components/DatePicker'
import { DayBar } from '../../components/DayBar'
import { HealthGate, HealthSettingsSheet, MetricTile, ReadinessCard, SyncStatus } from '../../components/health/ui'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { IconButton } from '../../components/ui/button'
import { useHealth } from '../../lib/health/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

const CONNECT_ERRORS: Record<string, string> = {
  cancelled: 'Google Health was not connected. Nothing changed.',
  expired: 'That Google link expired or was already used. Try again.',
  no_access: 'Google did not grant any health data. Connect again and tick every box.',
  failed: 'Google did not finish connecting. Try again.'
}

function clock(local: string): string {
  const hours = Number(local.slice(11, 13))
  return `${hours % 12 === 0 ? 12 : hours % 12}:${local.slice(14, 16)} ${hours < 12 ? 'AM' : 'PM'}`
}

function gapFromAverage(value: number | null, average: number | null, unit: string): string | undefined {
  if (value === null || average === null) return undefined
  const gap = Math.round(value - average)
  return gap === 0 ? 'Same as your 30-day average' : `${Math.abs(gap)} ${unit} ${gap > 0 ? 'above' : 'below'} your 30-day average`
}

/**
 * One day of Health. The picked day lives in the address, so the back arrow on a metric returns
 * to the day it was opened from, the way the phone's stack keeps this screen underneath.
 */
export default function HealthHome(): React.ReactElement {
  const health = useHealth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { index, units, today } = health
  const picked = params.get('date')
  const date = picked && picked < today ? picked : today
  const connected = params.get('connected')
  const failure = params.get('error')

  useEffect(() => {
    if (connected) void health.refresh(false)
    if (failure) setNotice(CONNECT_ERRORS[failure] ?? CONNECT_ERRORS.failed)
  }, [connected, failure])

  const pick = (iso: string): void => setParams(iso >= today ? {} : { date: iso }, { replace: true })
  const open = (metric: HealthMetric): void => void navigate(`/health/${metric}?date=${date}`)

  const thirtyDayAverage = (metric: HealthMetric): number | null => {
    const values: number[] = []
    for (let offset = 1; offset <= 30; offset += 1) {
      const value = metricValue(index, metric, shiftIso(date, -offset), units)
      if (value !== null) values.push(value)
    }
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length
  }

  const steps = metricValue(index, 'steps', date, units)
  const sleep = mainSleep(index, date)
  const calories = metricValue(index, 'calories', date, units)
  const distance = metricValue(index, 'distance', date, units)
  const zoneToday = metricValue(index, 'zone', date, units)
  const zoneWeek = weekZoneMinutes(index, date)
  const day = index.days.get(date)
  const resting = metricValue(index, 'resting', date, units)
  const hrv = metricValue(index, 'hrv', date, units)
  const weight = latestValue(index, 'weight', date, units)
  const whole = (value: number | null): string | null => value === null ? null : Math.round(value).toLocaleString('en-US')

  const tiles: Array<{ metric: HealthMetric; Icon: LucideIcon; label: string; value: string | null; unit?: string; detail?: string; progress?: number }> = [
    {
      metric: 'steps', Icon: Footprints, label: 'Steps', value: whole(steps),
      detail: `Goal ${DAILY_STEP_TARGET.toLocaleString('en-US')}`, progress: steps === null ? undefined : steps / DAILY_STEP_TARGET
    },
    {
      metric: 'sleep', Icon: Moon, label: 'Sleep', value: sleep ? formatSleepMinutes(sleep.minutesAsleep) : null,
      detail: sleep ? `${clock(sleep.startLocal)} to ${clock(sleep.endLocal)}` : undefined
    },
    { metric: 'calories', Icon: Flame, label: 'Calories', value: whole(calories), unit: 'kcal', detail: 'Burned' },
    { metric: 'distance', Icon: Route, label: 'Distance', value: distance === null ? null : distance.toFixed(2), unit: distanceUnit(units) },
    {
      metric: 'zone', Icon: Zap, label: 'Weekly cardio', value: String(zoneWeek), unit: `/ ${WEEKLY_ZONE_MINUTES_TARGET}`,
      detail: `Zone minutes since Monday${zoneToday ? `, ${zoneToday} on this day` : ''}`,
      progress: zoneWeek / WEEKLY_ZONE_MINUTES_TARGET
    },
    {
      metric: 'heart', Icon: HeartPulse, label: 'Heart rate', value: whole(day?.heartRateAvg ?? null), unit: 'bpm',
      detail: day?.heartRateMin != null && day.heartRateMax != null
        ? `Average, ranging ${Math.round(day.heartRateMin)} to ${Math.round(day.heartRateMax)}`
        : 'Average'
    },
    { metric: 'resting', Icon: Activity, label: 'Resting heart rate', value: whole(resting), unit: 'bpm', detail: gapFromAverage(resting, thirtyDayAverage('resting'), 'bpm') },
    { metric: 'hrv', Icon: Waves, label: 'HRV', value: whole(hrv), unit: 'ms', detail: gapFromAverage(hrv, thirtyDayAverage('hrv'), 'ms') },
    {
      metric: 'weight', Icon: Scale, label: 'Weight', value: weight ? weight.value.toFixed(1) : null, unit: bodyWeightUnit(units),
      detail: weight ? weight.date === date ? 'Logged this day' : `Last logged ${formatIso(weight.date)}` : 'Nothing logged in 90 days'
    }
  ]
  const earliest = index.firstDate ?? shiftIso(today, -365)

  return <Screen>
    <ScreenHeader
      title="Health"
      right={<>
        <IconButton label="Refresh" disabled={health.refreshing} onClick={() => void health.refresh(false)}>
          <RefreshCw color={color.textSecondary} size={19} className={cn(health.refreshing && 'animate-spin motion-reduce:animate-none')} />
        </IconButton>
        <IconButton label="Health settings" onClick={() => setSettingsOpen(true)}><Settings2 color={color.textSecondary} size={20} /></IconButton>
      </>}
    />
    <HealthGate>
      <ScreenBody width="wide" className="flex flex-col gap-3 pb-8">
        <div className="mx-auto w-full max-w-xl">
          <DayBar date={date} today={today} onPick={(iso) => { if (iso >= earliest) pick(iso) }} onOpenCalendar={() => setCalendarOpen(true)} />
        </div>
        {notice && <button
          type="button"
          onClick={() => setNotice(null)}
          className="rounded-2xl bg-attention/10 px-4 py-3 text-left text-[14px] leading-5 text-attention hover:bg-attention/15"
        >{notice}</button>}
        <SyncStatus />
        <ReadinessCard readiness={index.readiness.get(date) ?? null} onPress={() => open('readiness')} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {tiles.map((tile) => <MetricTile
            key={tile.metric}
            Icon={tile.Icon}
            label={tile.label}
            value={tile.value}
            unit={tile.unit}
            detail={tile.detail}
            progress={tile.progress}
            onPress={() => open(tile.metric)}
          />)}
        </div>
        <p className="mt-2 px-2 text-center text-[12px] leading-[18px] text-surface-500">Data from Google Health</p>
      </ScreenBody>
    </HealthGate>
    <CalendarDialog
      visible={calendarOpen}
      value={date}
      max={today}
      onCancel={() => setCalendarOpen(false)}
      onConfirm={(iso) => {
        setCalendarOpen(false)
        pick(iso > today ? today : iso)
      }}
    />
    <HealthSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </Screen>
}
