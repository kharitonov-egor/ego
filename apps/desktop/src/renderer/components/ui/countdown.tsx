import React, { useEffect, useMemo, useRef } from 'react'
import { Undo2 } from 'lucide-react'
import { SAVE_DELAY_MS } from '@ego/core'
import { color } from '../../lib/tokens'

export { SAVE_DELAY_MS }

/** What the bar needs to run: it starts over whenever either value changes. */
export interface SaveProgress {
  runKey: string
  paused: boolean
}

/**
 * Runs the bar down over `SAVE_DELAY_MS` from when `runKey` appears or the card stops being paused,
 * then calls `onElapsed` if there is one. A pause throws the time away, so coming back from an
 * edit gives the full delay again. Without `onElapsed` the card only shows time that something
 * else is keeping.
 */
export function useSaveCountdown(runKey: string, paused: boolean, onElapsed?: () => void): SaveProgress {
  const elapsed = useRef(onElapsed)
  elapsed.current = onElapsed
  useEffect(() => {
    if (paused) return
    const timer = setTimeout(() => elapsed.current?.(), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [paused, runKey])
  return useMemo(() => ({ runKey, paused }), [paused, runKey])
}

export function CountdownBar({ progress }: { progress: SaveProgress }): React.ReactElement {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = bar.current
    if (!element || progress.paused || typeof element.animate !== 'function') return
    const animation = element.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], {
      duration: SAVE_DELAY_MS, easing: 'linear', fill: 'forwards'
    })
    return () => animation.cancel()
  }, [progress])
  return <div className="h-1 overflow-hidden rounded-full bg-surface-800">
    <div ref={bar} className="h-full origin-left" style={{ backgroundColor: color.text }} />
  </div>
}

/**
 * The top of every card that saves itself: what is about to happen, the bar running down, and
 * the only way to stop it.
 */
export function SaveCountdown({ runKey, paused, label, onElapsed, onUndo }: {
  runKey: string
  paused: boolean
  label: string
  onElapsed?: () => void
  onUndo: () => void
}): React.ReactElement {
  const progress = useSaveCountdown(runKey, paused, onElapsed)
  return <div>
    <div className="flex items-center gap-3">
      <p aria-live="polite" className="flex-1 text-[14px] font-medium text-muted-foreground">
        {paused ? 'Waiting for your edit' : label}
      </p>
      <button
        type="button"
        title="Stops this before it saves"
        onClick={onUndo}
        className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-surface-700 px-4 transition-colors hover:bg-surface-800 active:bg-surface-800"
      >
        <Undo2 color={color.textSecondary} size={16} />
        <span className="text-[15px] font-semibold">Undo</span>
      </button>
    </div>
    <div className="mt-3"><CountdownBar progress={progress} /></div>
  </div>
}
