import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { parseIso, shiftIso } from '@ego/local/dates'
import {
  DAY_MINUTES, MIN_BLOCK_MINUTES, SNAP_MINUTES, clockLabel, hourLabel, instantAt, layoutDay, layoutSpans, minutesInto,
  shiftEvent, resizeEvent, snapMinutes, timeRangeLabel, weekdayShort, type EventTimes
} from '@ego/local/calendar/layout'
import { Blurred } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { blockStyle, colorOf } from './ui'

const HOUR = 48
const GUTTER = 64
const LANE = 24
const COLLAPSED_LANES = 3
/** A press that moves less than this is a click. */
const DRAG_THRESHOLD = 4
const NOW_COLOR = '#ea4335'

type Drag =
  | { kind: 'move'; event: CalendarEvent; startX: number; startY: number; dayIndex: number; started: boolean; times: EventTimes | null }
  | { kind: 'resize'; event: CalendarEvent; times: EventTimes | null }
  | { kind: 'create'; dayIndex: number; anchor: number; current: number; started: boolean }
  | { kind: 'allday'; event: CalendarEvent; startX: number; dayIndex: number; started: boolean; times: EventTimes | null }

export interface GridHandlers {
  canMove: (event: CalendarEvent) => boolean
  onOpen: (event: CalendarEvent) => void
  onMove: (event: CalendarEvent, times: EventTimes) => void
  onCreate: (times: EventTimes) => void
  onOpenDay: (day: string) => void
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

function DayHeader({ day, today, onOpenDay }: { day: string; today: string; onOpenDay: (day: string) => void }): React.ReactElement {
  const isToday = day === today
  return <button
    type="button"
    onClick={() => onOpenDay(day)}
    className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 hover:bg-surface-900"
  >
    <span className={cn('text-[12px] font-semibold uppercase tracking-wide', isToday ? 'text-foreground' : 'text-surface-500')}>{weekdayShort(day)}</span>
    <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-[20px] font-semibold',
      isToday ? 'bg-white text-black' : 'text-surface-200')}>{parseIso(day).getDate()}</span>
  </button>
}

export function TimeGrid({ days, today, events, calendars, selectedKey, saving, handlers }: {
  days: string[]
  today: string
  events: CalendarEvent[]
  calendars: ReadonlyMap<string, CalendarInfo>
  selectedKey: string | null
  saving: ReadonlySet<string>
  handlers: GridHandlers
}): React.ReactElement {
  const scroller = useRef<HTMLDivElement>(null)
  const columns = useRef<HTMLDivElement>(null)
  const allDayRow = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const [expanded, setExpanded] = useState(false)
  const now = useNow()
  const firstDay = days[0]

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const nowMinutes = days.includes(today) ? minutesInto(new Date().toISOString(), today) : 0
    const target = nowMinutes > 9 * 60 ? nowMinutes - 2 * 60 : 7 * 60
    element.scrollTop = (target / 60) * HOUR
  }, [firstDay, days.length])

  const spans = useMemo(() => layoutSpans(events, days), [events, days])
  const placements = useMemo(() => days.map((day) => layoutDay(events, day)), [events, days])
  const visibleLanes = expanded ? spans.lanes : Math.min(spans.lanes, COLLAPSED_LANES)
  const hiddenPerDay = useMemo(() => days.map((_, index) => spans.items.filter((item) =>
    item.lane >= COLLAPSED_LANES && item.startIndex <= index && item.endIndex >= index).length), [days, spans])

  const pointerDay = (clientX: number, element: HTMLElement | null): number => {
    const rect = element?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - rect.left) / rect.width) * days.length)))
  }

  const pointerMinutes = (clientY: number): number => {
    const rect = columns.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(DAY_MINUTES, ((clientY - rect.top) / HOUR) * 60))
  }

  const begin = (event: React.PointerEvent, next: Drag): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    ;(event.currentTarget as HTMLElement).ownerDocument.body.style.userSelect = 'none'
    setDrag(next)
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (pointer: PointerEvent): void => {
      const current = dragRef.current
      if (!current) return
      if (current.kind === 'move') {
        const distance = Math.hypot(pointer.clientX - current.startX, pointer.clientY - current.startY)
        if (!current.started && distance < DRAG_THRESHOLD) return
        const dayDelta = pointerDay(pointer.clientX, columns.current) - current.dayIndex
        const minuteDelta = snapMinutes(((pointer.clientY - current.startY) / HOUR) * 60)
        setDrag({ ...current, started: true, times: shiftEvent(current.event, dayDelta, minuteDelta) })
      } else if (current.kind === 'resize') {
        const day = days[pointerDay(pointer.clientX, columns.current)]
        setDrag({ ...current, times: resizeEvent(current.event, snapMinutes(pointerMinutes(pointer.clientY)), day) })
      } else if (current.kind === 'create') {
        const minutes = Math.floor(pointerMinutes(pointer.clientY) / SNAP_MINUTES) * SNAP_MINUTES
        setDrag({ ...current, current: minutes, started: current.started || minutes !== current.anchor })
      } else {
        if (!current.started && Math.abs(pointer.clientX - current.startX) < DRAG_THRESHOLD) return
        const dayDelta = pointerDay(pointer.clientX, allDayRow.current) - current.dayIndex
        setDrag({ ...current, started: true, times: shiftEvent(current.event, dayDelta, 0) })
      }
    }
    const finish = (): void => {
      document.body.style.userSelect = ''
      const current = dragRef.current
      setDrag(null)
      if (!current) return
      if (current.kind === 'move' || current.kind === 'allday') {
        if (!current.started) handlers.onOpen(current.event)
        else if (current.times && (current.times.start !== current.event.start || current.times.end !== current.event.end)) {
          handlers.onMove(current.event, current.times)
        }
      } else if (current.kind === 'resize') {
        if (current.times && current.times.end !== current.event.end) handlers.onMove(current.event, current.times)
      } else {
        const day = days[current.dayIndex]
        const from = current.started ? Math.min(current.anchor, current.current) : current.anchor
        const to = current.started ? Math.max(current.anchor, current.current) + SNAP_MINUTES : current.anchor + 60
        handlers.onCreate({ allDay: false, start: instantAt(day, from), end: instantAt(day, Math.min(to, DAY_MINUTES)) })
      }
    }
    const onKey = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape') return
      key.stopPropagation()
      document.body.style.userSelect = ''
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [drag !== null, days, handlers])

  const ghost = drag && (drag.kind === 'move' || drag.kind === 'resize') && drag.times
    ? { ...drag.event, ...drag.times }
    : null
  const draggingKey = drag && drag.kind !== 'create' && (drag.kind === 'resize' || drag.started) ? drag.event.key : null
  const allDayGhost = drag?.kind === 'allday' && drag.started && drag.times ? layoutSpans([{ ...drag.event, ...drag.times }], days).items[0] : null
  const columnWidth = `${100 / days.length}%`

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 border-b border-border pr-[10px]" style={{ paddingLeft: GUTTER }}>
      {days.map((day) => <DayHeader key={day} day={day} today={today} onOpenDay={handlers.onOpenDay} />)}
    </div>

    <div className="flex shrink-0 border-b border-border pr-[10px]">
      <div className="flex shrink-0 items-start justify-end pr-2 pt-1" style={{ width: GUTTER }}>
        {spans.lanes > COLLAPSED_LANES && <button
          type="button"
          aria-label={expanded ? 'Show fewer all-day events' : 'Show every all-day event'}
          onClick={() => setExpanded(!expanded)}
          className="rounded-full p-1 text-surface-400 hover:bg-surface-800"
        >{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}
      </div>
      <div
        ref={allDayRow}
        className="relative min-w-0 flex-1"
        style={{ height: Math.max(1, visibleLanes + (hiddenPerDay.some(Boolean) && !expanded ? 1 : 0)) * LANE + 6 }}
        onDoubleClick={(event) => {
          const day = days[pointerDay(event.clientX, allDayRow.current)]
          handlers.onCreate({ allDay: true, start: day, end: shiftIso(day, 1) })
        }}
      >
        {days.map((day, index) => <div key={day} className="absolute inset-y-0 border-l border-border" style={{ left: `${(index / days.length) * 100}%` }} />)}
        {spans.items.filter((item) => item.lane < visibleLanes).map((item) => {
          const color = colorOf(item.event, calendars)
          const look = blockStyle(item.event, color)
          const movable = handlers.canMove(item.event)
          return <button
            key={item.event.key}
            type="button"
            title={item.event.title || '(No title)'}
            onPointerDown={(event) => movable
              ? begin(event, { kind: 'allday', event: item.event, startX: event.clientX, dayIndex: pointerDay(event.clientX, allDayRow.current), started: false, times: null })
              : undefined}
            onClick={(event) => { if (!movable || event.detail === 0) handlers.onOpen(item.event) }}
            className={cn('absolute flex items-center truncate rounded-md px-2 text-left text-[13px] font-medium', look.className,
              selectedKey === item.event.key && 'ring-2 ring-white', draggingKey === item.event.key && 'opacity-40',
              saving.has(item.event.key) && 'animate-pulse', movable ? 'cursor-grab' : 'cursor-pointer')}
            style={{
              ...look.style,
              top: 3 + item.lane * LANE,
              height: LANE - 3,
              left: `calc(${(item.startIndex / days.length) * 100}% + 2px)`,
              width: `calc(${((item.endIndex - item.startIndex + 1) / days.length) * 100}% - 4px)`
            }}
          >
            {item.continuesBefore && <span aria-hidden className="mr-1">‹</span>}
            <Blurred><span className="truncate">{item.event.title || '(No title)'}</span></Blurred>
          </button>
        })}
        {!expanded && hiddenPerDay.map((count, index) => count > 0 && <button
          key={days[index]}
          type="button"
          onClick={() => setExpanded(true)}
          className="absolute truncate rounded-md px-2 text-left text-[12px] font-semibold text-surface-300 hover:bg-surface-800"
          style={{ top: 3 + visibleLanes * LANE, height: LANE - 3, left: `calc(${(index / days.length) * 100}% + 2px)`, width: `calc(${columnWidth} - 4px)` }}
        >{count} more</button>)}
        {allDayGhost && <div
          className="pointer-events-none absolute rounded-md border-2 border-white/80 bg-white/20"
          style={{
            top: 3, height: LANE - 3,
            left: `calc(${(allDayGhost.startIndex / days.length) * 100}% + 2px)`,
            width: `calc(${((allDayGhost.endIndex - allDayGhost.startIndex + 1) / days.length) * 100}% - 4px)`
          }}
        />}
      </div>
    </div>

    <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-scroll">
      <div className="relative flex" style={{ height: 24 * HOUR }}>
        <div className="relative shrink-0" style={{ width: GUTTER }}>
          {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => <span
            key={hour}
            className="absolute right-2 -translate-y-1/2 select-none text-[11px] font-medium text-surface-500"
            style={{ top: hour * HOUR }}
          >{hourLabel(hour)}</span>)}
        </div>
        <div
          ref={columns}
          className="relative min-w-0 flex-1"
          style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR - 1}px, #262626 ${HOUR - 1}px, #262626 ${HOUR}px)` }}
        >
          {days.map((day, index) => {
            const isToday = day === today
            const nowMinutes = isToday ? minutesInto(new Date(now).toISOString(), day) : -1
            return <div
              key={day}
              className="absolute inset-y-0 border-l border-border"
              style={{ left: `${(index / days.length) * 100}%`, width: columnWidth }}
              onPointerDown={(event) => {
                if (event.target !== event.currentTarget) return
                const minutes = Math.floor(pointerMinutes(event.clientY) / SNAP_MINUTES) * SNAP_MINUTES
                begin(event, { kind: 'create', dayIndex: index, anchor: minutes, current: minutes, started: false })
              }}
            >
              {placements[index].map((placement) => {
                const event = placement.event
                const color = colorOf(event, calendars)
                const look = blockStyle(event, color)
                const height = Math.max(placement.bottom - placement.top, MIN_BLOCK_MINUTES) / 60 * HOUR
                const movable = handlers.canMove(event)
                const short = height < 36
                return <div
                  key={event.key}
                  role="button"
                  tabIndex={0}
                  title={`${event.title || '(No title)'}, ${timeRangeLabel(event)}`}
                  onKeyDown={(key) => { if (key.key === 'Enter' || key.key === ' ') { key.preventDefault(); handlers.onOpen(event) } }}
                  onPointerDown={(pointer) => movable
                    ? begin(pointer, { kind: 'move', event, startX: pointer.clientX, startY: pointer.clientY, dayIndex: index, started: false, times: null })
                    : undefined}
                  onClick={() => { if (!movable) handlers.onOpen(event) }}
                  className={cn('absolute overflow-hidden rounded-md px-1.5 text-left leading-tight outline-none focus-visible:ring-2 focus-visible:ring-white',
                    look.className, selectedKey === event.key && 'z-10 ring-2 ring-white', draggingKey === event.key && 'opacity-40',
                    saving.has(event.key) && 'animate-pulse', movable ? 'cursor-grab' : 'cursor-pointer')}
                  style={{
                    ...look.style,
                    top: (placement.top / 60) * HOUR + 1,
                    height: height - 2,
                    left: `calc(${(placement.column / placement.columns) * 100}% + 1px)`,
                    width: `calc(${(placement.span / placement.columns) * 100}% - 3px)`
                  }}
                >
                  <Blurred><div className={cn('truncate text-[12px] font-semibold', !short && 'pt-0.5')}>
                    {event.title || '(No title)'}{short ? `, ${clockLabel(event.start)}` : ''}
                  </div></Blurred>
                  {!short && <div className="truncate text-[11px] opacity-90">{timeRangeLabel(event)}</div>}
                  {!short && height > 64 && event.location && <Blurred><div className="truncate text-[11px] opacity-80">{event.location}</div></Blurred>}
                  {movable && !placement.endsAfter && <div
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                    onPointerDown={(pointer) => begin(pointer, { kind: 'resize', event, times: null })}
                  />}
                </div>
              })}
              {ghost && layoutDay([ghost], day).map((placement) => <div
                key="ghost"
                className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-white/80 bg-white/20 px-1.5 text-[11px] font-semibold text-white"
                style={{ top: (placement.top / 60) * HOUR, height: Math.max(placement.bottom - placement.top, MIN_BLOCK_MINUTES) / 60 * HOUR }}
              >{timeRangeLabel(ghost)}</div>)}
              {drag?.kind === 'create' && drag.dayIndex === index && (() => {
                const from = Math.min(drag.anchor, drag.current)
                const to = Math.max(drag.anchor, drag.current) + SNAP_MINUTES
                return <div
                  className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md bg-white/80 px-1.5 text-[11px] font-semibold text-black"
                  style={{ top: (from / 60) * HOUR, height: ((to - from) / 60) * HOUR }}
                >{timeRangeLabel({ start: instantAt(day, from), end: instantAt(day, to) })}</div>
              })()}
              {nowMinutes >= 0 && nowMinutes <= DAY_MINUTES && <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: (nowMinutes / 60) * HOUR }}>
                <div className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full" style={{ backgroundColor: NOW_COLOR }} />
                <div className="h-0.5" style={{ backgroundColor: NOW_COLOR }} />
              </div>}
            </div>
          })}
        </div>
      </div>
    </div>
  </div>
}
