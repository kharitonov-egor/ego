import React, { useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, View } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'
import type { PeriodPreset } from '@ego/core'
import { usePeriod } from '../../lib/period-context'
import { currentPeriodName, isHorizontalSwipe, isStepped, swipeStep } from '../../lib/periods'
import { Button } from '../ui/button'
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control'
import { Text } from '../ui/text'
import { CustomPeriodSheet } from './PeriodSheet'

const OPTIONS: SegmentedOption<PeriodPreset>[] = [
  { value: 'today', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' }
]

const UNIT: Record<PeriodPreset, string> = {
  today: 'day', week: 'week', month: 'month', year: 'year', all: 'period', custom: 'period'
}

/** `since` names the first day of the ledger, shown under "All time". */
export function PeriodBar({ since }: { since?: string }): React.ReactElement {
  const period = usePeriod()
  const [picking, setPicking] = useState(false)
  const preset = period.period
  const stepped = isStepped(preset)
  const hidden = stepped ? {} : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const }
  const live = useRef(period)
  live.current = period

  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, state) => isHorizontalSwipe(state.dx, state.dy),
    onPanResponderRelease: (_, state) => {
      const { canGoBack, canGoForward, step } = live.current
      const delta = swipeStep(state.dx, state.vx)
      if ((delta === -1 && canGoBack) || (delta === 1 && canGoForward)) step(delta)
    }
  }), [])

  const caption = period.period === 'all'
    ? since ? `Since ${since}` : null
    : period.period === 'custom' ? 'Tap to change the dates' : period.relative

  return <View className="gap-3 px-4 pb-3 pt-2">
    <SegmentedControl
      options={OPTIONS}
      value={period.period}
      onValueChange={(value) => value === 'custom' ? setPicking(true) : period.setPeriod(value)}
    />
    <View {...swipe.panHandlers} className="flex-row items-center">
      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel={`Previous ${UNIT[preset]}`}
        disabled={!period.canGoBack}
        onPress={() => period.step(-1)}
        className={stepped ? undefined : 'opacity-0'}
        {...hidden}
      ><ChevronLeft color="#fafafa" size={22} /></Button>
      <Pressable
        accessible={preset === 'custom'}
        accessibilityRole="button"
        accessibilityHint="Opens the date range"
        disabled={preset !== 'custom'}
        onPress={() => setPicking(true)}
        className="flex-1 items-center px-1"
      >
        <Text accessibilityLiveRegion="polite" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="text-[22px] font-bold tracking-tight">{period.label}</Text>
        <View className="mt-0.5 min-h-[20px] flex-row items-center gap-2">
          {caption && <Text className="text-[14px] text-muted-foreground">{caption}</Text>}
          {isStepped(preset) && !period.current && <Pressable accessibilityRole="button" onPress={period.jumpToToday} hitSlop={10}>
            <Text className="text-[14px] font-semibold text-foreground underline">Back to {currentPeriodName(preset)}</Text>
          </Pressable>}
        </View>
      </Pressable>
      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel={`Next ${UNIT[preset]}`}
        disabled={!period.canGoForward}
        onPress={() => period.step(1)}
        className={stepped ? undefined : 'opacity-0'}
        {...hidden}
      ><ChevronRight color="#fafafa" size={22} /></Button>
    </View>
    <CustomPeriodSheet
      visible={picking}
      value={period.custom}
      onClose={() => setPicking(false)}
      onApply={(range) => { period.setCustom(range); setPicking(false) }}
    />
  </View>
}
