import React from 'react'
import { Pressable, Text, View } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import { parseIso, shiftIso } from '../../lib/dates'
import { mondayOf, weekDates, type DayScore } from '../../lib/habits/stats'
import { formatSpan } from '../../lib/periods'
import { PeriodSwipe } from '../money/PeriodSwipe'

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const RING = 38
const STROKE = 3

function Ring({ share, track, fill }: { share: number; track: string; fill: string }): React.ReactElement {
  const radius = (RING - STROKE) / 2
  const circumference = 2 * Math.PI * radius
  return <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
    <Circle cx={RING / 2} cy={RING / 2} r={radius} stroke={track} strokeWidth={STROKE} fill="none" />
    {share > 0 && <Circle
      cx={RING / 2} cy={RING / 2} r={radius} stroke={fill} strokeWidth={STROKE} fill="none"
      strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`}
      strokeDashoffset={circumference * (1 - share)}
    />}
  </Svg>
}

function weekLabel(monday: string, today: string): string {
  if (monday === mondayOf(today)) return 'This week'
  if (monday === shiftIso(mondayOf(today), -7)) return 'Last week'
  return formatSpan(monday, shiftIso(monday, 6), parseIso(today).getFullYear())
}

function DayPill({ date, today, selected, score, onPress }: {
  date: string
  today: string
  selected: boolean
  score: DayScore
  onPress: () => void
}): React.ReactElement {
  const future = date > today
  const finished = !future && score.total > 0 && score.done === score.total
  const share = future || score.total === 0 ? 0 : score.done / score.total
  const letter = LETTERS[(parseIso(date).getDay() + 6) % 7]
  const numberColor = finished ? (selected ? 'text-white' : 'text-primary-foreground')
    : selected ? 'text-primary-foreground' : future ? 'text-surface-600' : 'text-foreground'
  const spoken = parseIso(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected, disabled: future }}
    accessibilityLabel={future ? spoken : `${spoken}, ${score.done} of ${score.total} done`}
    disabled={future}
    onPress={onPress}
    className={`flex-1 items-center rounded-2xl pb-2 pt-1.5 ${selected ? 'bg-primary' : 'active:bg-surface-900'}`}
  >
    <Text className={`text-[12px] font-semibold ${selected ? 'text-surface-600' : date === today ? 'text-foreground' : 'text-surface-500'}`}>{letter}</Text>
    <View className="mt-1 items-center justify-center" style={{ width: RING, height: RING }}>
      {finished
        ? <View className={`absolute rounded-full ${selected ? 'bg-surface-950' : 'bg-primary'}`} style={{ width: RING, height: RING }} />
        : <Ring share={share} track={selected ? '#d4d4d4' : '#262626'} fill={selected ? '#0a0a0a' : '#fafafa'} />}
      <Text className={`text-[15px] ${date === today || selected ? 'font-bold' : 'font-medium'} ${numberColor}`}>{parseIso(date).getDate()}</Text>
    </View>
  </Pressable>
}

/**
 * One week at a time. Swiping follows the rest of the app, so a swipe to the left goes back a
 * week. Stepping keeps the same weekday, and never lands after today.
 */
export function WeekStrip({ selected, today, scoreFor, onSelect }: {
  selected: string
  today: string
  scoreFor: (date: string) => DayScore
  onSelect: (date: string) => void
}): React.ReactElement {
  const monday = mondayOf(selected)
  const canGoForward = monday < mondayOf(today)
  const step = (delta: -1 | 1): void => {
    const next = shiftIso(selected, delta * 7)
    onSelect(next > today ? today : next)
  }
  return <View>
    <View className="mb-1 flex-row items-center justify-between">
      <Pressable accessibilityRole="button" accessibilityLabel="Previous week" onPress={() => step(-1)} hitSlop={8} className="h-10 w-10 items-center justify-center rounded-full active:bg-surface-800">
        <ChevronLeft color="#d4d4d4" size={20} />
      </Pressable>
      <Text accessibilityLiveRegion="polite" className="text-[15px] font-semibold text-surface-300">{weekLabel(monday, today)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next week"
        accessibilityState={{ disabled: !canGoForward }}
        disabled={!canGoForward}
        onPress={() => step(1)}
        hitSlop={8}
        className={`h-10 w-10 items-center justify-center rounded-full active:bg-surface-800 ${canGoForward ? '' : 'opacity-30'}`}
      >
        <ChevronRight color="#d4d4d4" size={20} />
      </Pressable>
    </View>
    <PeriodSwipe style={{ flex: 0 }} onStep={step} canStep={(delta) => delta === -1 || canGoForward}>
      <View className="flex-row gap-1">
        {weekDates(selected).map((date) => <DayPill
          key={date}
          date={date}
          today={today}
          selected={date === selected}
          score={scoreFor(date)}
          onPress={() => onSelect(date)}
        />)}
      </View>
    </PeriodSwipe>
  </View>
}
