import React, { useEffect, useRef } from 'react'
import { usePeriod } from '../../lib/period'

/** A key pressed in a field belongs to the field, not to the page around it. */
export function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/**
 * The phone steps the shared period on a sideways swipe. Here the left and right arrow keys do,
 * unless a field has the focus or a dialog is open.
 */
export function PeriodSwipe({ enabled = true, onStep, canStep, children }: {
  enabled?: boolean
  /** Steps something other than the shared period, such as Budget's own month. */
  onStep?: (delta: -1 | 1) => void
  /** Limits `onStep`, which otherwise steps both ways. */
  canStep?: (delta: -1 | 1) => boolean
  children: React.ReactNode
}): React.ReactElement {
  const period = usePeriod()
  const live = useRef({ period, enabled, onStep, canStep })
  live.current = { period, enabled, onStep, canStep }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.defaultPrevented) return
      if (!live.current.enabled || isTyping(event.target) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (document.querySelector('[aria-modal="true"]')) return
      const delta = event.key === 'ArrowLeft' ? -1 : 1
      const current = live.current
      const allowed = current.onStep !== undefined
        ? current.canStep?.(delta) ?? true
        : delta === -1 ? current.period.canGoBack : current.period.canGoForward
      if (!allowed) return
      event.preventDefault()
      ;(current.onStep ?? current.period.step)(delta)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <>{children}</>
}
