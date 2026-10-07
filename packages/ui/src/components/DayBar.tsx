import React, { useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatIso, parseIso, shiftIso } from '@ego/local/dates'
import { IconButton } from './ui/button'

/**
 * Today, Yesterday, or the weekday, with arrows either side and the calendar behind the title.
 * The left and right arrow keys step a day, unless a field, a radio group, or a menu has the focus.
 */
export function DayBar({ date, today, onPick, onOpenCalendar }: {
  date: string
  today: string
  onPick: (iso: string) => void
  onOpenCalendar: () => void
}): React.ReactElement {
  const title = date === today ? 'Today'
    : date === shiftIso(today, -1) ? 'Yesterday'
      : parseIso(date).toLocaleDateString('en-US', { weekday: 'long' })
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (target instanceof Element && target.closest('[role="radiogroup"], [role="menu"]')) return
      if (event.altKey || event.ctrlKey || event.metaKey || document.querySelector('[aria-modal="true"]')) return
      if (event.key === 'ArrowLeft') onPick(shiftIso(date, -1))
      else if (event.key === 'ArrowRight' && date < today) onPick(shiftIso(date, 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [date, onPick, today])
  return <div className="flex items-center">
    <IconButton label="Previous day" onClick={() => onPick(shiftIso(date, -1))} className="h-11 w-11">
      <ChevronLeft color="#fafafa" size={22} />
    </IconButton>
    <div className="flex flex-1 flex-col items-center">
      <button type="button" aria-label={`${title}, ${formatIso(date)}. Opens the calendar`} onClick={onOpenCalendar} className="flex flex-col items-center rounded-xl px-3 py-0.5 hover:bg-surface-900">
        <span aria-live="polite" className="text-[22px] font-bold tracking-tight">{title}</span>
        <span className="mt-0.5 text-[14px] text-muted-foreground">{formatIso(date)}</span>
      </button>
      {date !== today && <button type="button" onClick={() => onPick(today)} className="mt-1 text-[14px] font-semibold underline">Back to today</button>}
    </div>
    <IconButton label="Next day" disabled={date >= today} onClick={() => onPick(shiftIso(date, 1))} className="h-11 w-11">
      <ChevronRight color="#fafafa" size={22} />
    </IconButton>
  </div>
}
