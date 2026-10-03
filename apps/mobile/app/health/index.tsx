import React, { useEffect, useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Activity, Flame, Footprints, HeartPulse, LayoutGrid, Moon, Route, Scale, Settings2, Waves, Zap, type LucideIcon
} from 'lucide-react-native'
import {
  DAILY_STEP_TARGET, WEEKLY_ZONE_MINUTES_TARGET, bodyWeightUnit, distanceUnit, formatSleepMinutes
} from '@ego/core'
import { DayBar } from '../../components/DayBar'
import { HeaderIcon } from '../../components/gym/ui'
import { HealthGate, HealthSettingsSheet, MetricTile, ReadinessCard, SyncStatus } from '../../components/health/ui'
import { CalendarDialog } from '../../components/money/DatePicker'
import { color } from '../../components/money/tokens'
import { Text } from '../../components/ui/text'
import { formatIso, shiftIso } from '@ego/local/dates'
import { useHealth } from '../../lib/health/context'
import { latestValue, mainSleep, metricValue, weekZoneMinutes, type HealthMetric } from '@ego/local/health/metrics'

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

export default function HealthHome(): React.ReactElement {
  const health = useHealth()
  const router = useRouter()
  const params = useLocalSearchParams<{ connected?: string; error?: string }>()
  const [picked, setPicked] = useState<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { index, units, today } = health
  const date = picked ?? today

  useEffect(() => {
    if (params.connected) void health.refresh(false)
    if (params.error) setNotice(CONNECT_ERRORS[params.error] ?? CONNECT_ERRORS.failed)
  }, [params.connected, params.error])

  const pick = (iso: string): void => setPicked(iso >= today ? null : iso)
  const open = (metric: HealthMetric): void => router.push({ pathname: '/health/[metric]', params: { metric, date } })

  const header = <Stack.Screen options={{
    headerLeft: () => <HeaderIcon label="All apps" onPress={() => router.dismissTo('/')}><LayoutGrid color={color.text} size={21} /></HeaderIcon>,
    headerRight: () => <HeaderIcon label="Health settings" onPress={() => setSettingsOpen(true)}><Settings2 color={color.textSecondary} size={21} /></HeaderIcon>
  }} />

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
  const rows = Array.from({ length: Math.ceil(tiles.length / 2) }, (_, row) => tiles.slice(row * 2, row * 2 + 2))
  const earliest = index.firstDate ?? shiftIso(today, -365)

  return <>
    {header}
    <HealthGate>
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 12 }}
        refreshControl={<RefreshControl refreshing={health.refreshing} onRefresh={() => void health.refresh(false)} tintColor={color.text} colors={[color.screen]} progressBackgroundColor={color.text} />}
      >
        <DayBar date={date} today={today} onPick={(iso) => { if (iso >= earliest) pick(iso) }} onOpenCalendar={() => setCalendarOpen(true)} />
        {notice && <Text onPress={() => setNotice(null)} className="rounded-2xl bg-attention/10 px-4 py-3 text-[14px] leading-5 text-attention">{notice}</Text>}
        <SyncStatus />
        <ReadinessCard readiness={index.readiness.get(date) ?? null} onPress={() => open('readiness')} />
        {rows.map((row) => <View key={row[0].metric} className="flex-row gap-3">
          {row.map((tile) => <MetricTile
            key={tile.metric}
            Icon={tile.Icon}
            label={tile.label}
            value={tile.value}
            unit={tile.unit}
            detail={tile.detail}
            progress={tile.progress}
            onPress={() => open(tile.metric)}
          />)}
          {row.length === 1 && <View className="flex-1" />}
        </View>)}
        <Text className="mt-2 px-2 text-center text-[12px] leading-[18px] text-surface-500">Data from Google Health</Text>
      </ScrollView>
    </HealthGate>
    <CalendarDialog
      visible={calendarOpen}
      value={date}
      onCancel={() => setCalendarOpen(false)}
      onConfirm={(iso) => {
        setCalendarOpen(false)
        pick(iso > today ? today : iso)
      }}
    />
    <HealthSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
  </>
}
