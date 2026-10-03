import React, { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PeriodPreset } from '@ego/core'
import { currentPeriodName, isStepped } from '@ego/local/periods'
import { usePeriod } from '../../lib/period'
import { cn } from '../../lib/utils'
import { IconButton } from '../ui/button'
import { SegmentedControl, type SegmentedOption } from '../ui/segmented-control'
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

/** `since` names the first day of the ledger, shown under "All time". The arrow keys step it too. */
export function PeriodBar({ since }: { since?: string }): React.ReactElement {
  const period = usePeriod()
  const [picking, setPicking] = useState(false)
  const preset = period.period
  const stepped = isStepped(preset)

  const caption = period.period === 'all'
    ? since ? `Since ${since}` : null
    : period.period === 'custom' ? 'Click to change the dates' : period.relative

  return <div className="mx-auto flex w-full max-w-2xl shrink-0 flex-col gap-3 px-6 pb-3 pt-4">
    <SegmentedControl
      options={OPTIONS}
      value={period.period}
      onValueChange={(value) => value === 'custom' ? setPicking(true) : period.setPeriod(value)}
    />
    <div className="flex items-center">
      <IconButton
        label={`Previous ${UNIT[preset]}`}
        disabled={!period.canGoBack}
        aria-hidden={!stepped}
        tabIndex={stepped ? undefined : -1}
        onClick={() => period.step(-1)}
        className={cn('h-11 w-11', !stepped && 'invisible')}
      ><ChevronLeft color="#fafafa" size={22} /></IconButton>
      <div className="flex min-w-0 flex-1 flex-col items-center px-1">
        {preset === 'custom'
          ? <button type="button" title="Opens the date range" onClick={() => setPicking(true)} className="max-w-full truncate rounded-xl px-3 text-[22px] font-bold tracking-tight hover:bg-surface-900">{period.label}</button>
          : <span aria-live="polite" className="max-w-full truncate text-[22px] font-bold tracking-tight">{period.label}</span>}
        <div className="mt-0.5 flex min-h-[20px] items-center gap-2">
          {caption && <span className="text-[14px] text-muted-foreground">{caption}</span>}
          {isStepped(preset) && !period.current && <button type="button" onClick={period.jumpToToday} className="text-[14px] font-semibold text-foreground underline">
            Back to {currentPeriodName(preset)}
          </button>}
        </div>
      </div>
      <IconButton
        label={`Next ${UNIT[preset]}`}
        disabled={!period.canGoForward}
        aria-hidden={!stepped}
        tabIndex={stepped ? undefined : -1}
        onClick={() => period.step(1)}
        className={cn('h-11 w-11', !stepped && 'invisible')}
      ><ChevronRight color="#fafafa" size={22} /></IconButton>
    </div>
    <CustomPeriodSheet
      visible={picking}
      value={period.custom}
      onClose={() => setPicking(false)}
      onApply={(range) => { period.setCustom(range); setPicking(false) }}
    />
  </div>
}
