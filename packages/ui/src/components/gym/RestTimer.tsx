import React from 'react'
import { AlarmClock } from 'lucide-react'
import { formatSetDuration } from '@ego/core'
import { REST_PRESETS, useRestClock, useRestTimer } from '../../lib/gym/rest-timer'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { Switch } from '../ui/switch'

export function RestTimerButton({ onPress }: { onPress: () => void }): React.ReactElement {
  const { running } = useRestTimer()
  const { remaining, finished } = useRestClock()
  const tint = finished ? color.positive : running ? color.text : color.textSecondary
  const label = running ? `Rest timer, ${formatSetDuration(remaining)} left` : 'Rest timer'
  return <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onPress}
    className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 transition-colors hover:bg-surface-800"
  >
    <AlarmClock color={tint} size={20} />
    {running && <span className="tabular ml-1 text-[15px] font-semibold">{formatSetDuration(remaining)}</span>}
  </button>
}

function Countdown(): React.ReactElement {
  const { running, preference } = useRestTimer()
  const { remaining, finished } = useRestClock()
  return <div className="flex flex-col items-center py-4">
    <span className="tabular text-[64px] font-bold leading-none tracking-tight">
      {formatSetDuration(running ? remaining : preference.seconds)}
    </span>
    <span aria-live="polite" className={cn('mt-3 text-[15px]', finished ? 'text-positive' : 'text-muted-foreground')}>
      {finished ? 'Rest is over' : running ? 'Resting' : 'Ready'}
    </span>
  </div>
}

export function RestTimerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.ReactElement | null {
  const timer = useRestTimer()
  const { preference } = timer
  return <Sheet visible={visible} title="Rest timer" onClose={onClose} dismissOnBackdrop>
    <Countdown />
    {timer.running && <div className="flex gap-3">
      <Button variant="outline" size="lg" onClick={() => timer.adjust(-15)} className="flex-1">-15s</Button>
      <Button variant="outline" size="lg" onClick={() => timer.adjust(15)} className="flex-1">+15s</Button>
    </div>}
    <Button size="lg" onClick={() => timer.running ? timer.stop() : timer.start()} className="mt-3 w-full">
      {timer.running ? 'Stop' : `Start ${formatSetDuration(preference.seconds)}`}
    </Button>
    <p className="mb-2 mt-6 text-[15px] font-medium text-surface-200">Length</p>
    <div className="flex flex-wrap gap-2">
      {REST_PRESETS.map((seconds) => {
        const selected = seconds === preference.seconds
        return <button
          key={seconds}
          type="button"
          aria-pressed={selected}
          onClick={() => timer.setSeconds(seconds)}
          className={cn('tabular min-h-12 min-w-[72px] rounded-xl border px-4 text-[16px] transition-colors',
            selected ? 'border-primary bg-primary font-semibold text-primary-foreground' : 'border-input bg-surface-900 text-surface-200 hover:bg-surface-800')}
        >{formatSetDuration(seconds)}</button>
      })}
    </div>
    <div className="mt-6 flex min-h-14 items-center">
      <div className="flex flex-1 flex-col pr-3">
        <span className="text-[16px]">Start after each set</span>
        <span className="text-[14px] leading-5 text-muted-foreground">Saving a new set starts the countdown.</span>
      </div>
      <Switch label="Start the rest timer after each set" checked={preference.autoStart} onCheckedChange={timer.setAutoStart} />
    </div>
  </Sheet>
}
