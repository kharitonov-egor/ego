import React, { useMemo } from 'react'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { parseIso } from '@ego/local/dates'
import { eventDays, inAllDayRow, scheduleDays, timeRangeLabel, weekdayShort } from '@ego/local/calendar/layout'
import { Blurred } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { colorOf } from './ui'

function whenOnDay(event: CalendarEvent, day: string): string {
  if (event.allDay) return 'All day'
  const { first, last } = eventDays(event)
  if (inAllDayRow(event) || (first !== day && last !== day)) return 'All day'
  if (first !== last) return day === first ? `From ${timeRangeLabel(event).split(' – ')[0]}` : `Until ${timeRangeLabel(event).split(' – ')[1]}`
  return timeRangeLabel(event)
}

/** Google's Schedule view: every day with something on it, one line per event. */
export function Schedule({ days, today, events, calendars, selectedKey, onOpen }: {
  days: string[]
  today: string
  events: CalendarEvent[]
  calendars: ReadonlyMap<string, CalendarInfo>
  selectedKey: string | null
  onOpen: (event: CalendarEvent) => void
}): React.ReactElement {
  const groups = useMemo(() => scheduleDays(events, days), [days, events])
  if (groups.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-[16px] text-surface-400">Nothing scheduled in the next {days.length} days.</div>
  }
  return <div className="min-h-0 flex-1 overflow-y-auto">
    <div className="mx-auto max-w-4xl px-6 py-4">
      {groups.map((group) => <div key={group.day} className="flex gap-4 border-b border-border py-3">
        <div className="flex w-24 shrink-0 items-start gap-2 pt-1">
          <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[18px] font-semibold',
            group.day === today ? 'bg-white text-black' : 'text-surface-100')}>{parseIso(group.day).getDate()}</span>
          <span className="pt-1.5 text-[12px] font-semibold uppercase text-surface-400">
            {parseIso(group.day).toLocaleDateString('en-US', { month: 'short' })}, {weekdayShort(group.day)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          {group.events.map((event) => <button
            key={event.key}
            type="button"
            onClick={() => onOpen(event)}
            className={cn('flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-900',
              selectedKey === event.key && 'bg-surface-800')}
          >
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: colorOf(event, calendars) }} />
            <span className="w-40 shrink-0 text-[14px] text-surface-300">{whenOnDay(event, group.day)}</span>
            <Blurred><span className={cn('min-w-0 flex-1 truncate text-[15px] font-medium',
              event.response === 'declined' && 'line-through opacity-60')}>{event.title || '(No title)'}</span></Blurred>
            {event.location && <Blurred><span className="hidden max-w-[30%] truncate text-[13px] text-surface-500 lg:block">{event.location}</span></Blurred>}
          </button>)}
        </div>
      </div>)}
    </div>
  </div>
}
