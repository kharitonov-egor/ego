import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { parseIso, shiftIso } from '@ego/local/dates'
import { clockLabel, inAllDayRow, layoutSpans, monthWeeks, shiftEvent, weekdayShort, type EventTimes } from '@ego/local/calendar/layout'
import { Blurred } from '../../lib/blur'
import { cn } from '../../lib/utils'
import type { GridHandlers } from './TimeGrid'
import { blockStyle, colorOf } from './ui'

const LINE = 22
const HEADER = 30
const DRAG_THRESHOLD = 4

interface Drag {
  event: CalendarEvent
  startX: number
  startY: number
  origin: string
  started: boolean
  target: string | null
}

export function MonthGrid({ anchor, today, events, calendars, selectedKey, saving, handlers }: {
  anchor: string
  today: string
  events: CalendarEvent[]
  calendars: ReadonlyMap<string, CalendarInfo>
  selectedKey: string | null
  saving: ReadonlySet<string>
  handlers: GridHandlers
}): React.ReactElement {
  const weeks = useMemo(() => monthWeeks(anchor), [anchor])
  const month = anchor.slice(0, 7)
  const grid = useRef<HTMLDivElement>(null)
  const [rowHeight, setRowHeight] = useState(120)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag

  useLayoutEffect(() => {
    const element = grid.current
    if (!element) return
    const measure = (): void => setRowHeight(element.clientHeight / weeks.length)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [weeks.length])

  const fits = Math.max(1, Math.floor((rowHeight - HEADER - 4) / LINE))
  const rows = useMemo(() => weeks.map((week) => layoutSpans(events, week, { includeTimed: true })), [events, weeks])

  const dayAt = (clientX: number, clientY: number): string | null => {
    const rect = grid.current?.getBoundingClientRect()
    if (!rect) return null
    const column = Math.floor(((clientX - rect.left) / rect.width) * 7)
    const row = Math.floor(((clientY - rect.top) / rect.height) * weeks.length)
    return weeks[Math.max(0, Math.min(weeks.length - 1, row))]?.[Math.max(0, Math.min(6, column))] ?? null
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (pointer: PointerEvent): void => {
      const current = dragRef.current
      if (!current) return
      if (!current.started && Math.hypot(pointer.clientX - current.startX, pointer.clientY - current.startY) < DRAG_THRESHOLD) return
      setDrag({ ...current, started: true, target: dayAt(pointer.clientX, pointer.clientY) })
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      const current = dragRef.current
      setDrag(null)
      if (!current) return
      if (!current.started) {
        handlers.onOpen(current.event)
        return
      }
      if (!current.target || current.target === current.origin) return
      const days = Math.round((parseIso(current.target).getTime() - parseIso(current.origin).getTime()) / 86_400_000)
      const times: EventTimes = shiftEvent(current.event, days, 0)
      handlers.onMove(current.event, times)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag !== null, handlers, weeks])

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="grid shrink-0 grid-cols-7 border-b border-border">
      {weeks[0].map((day) => <div key={day} className="py-2 text-center text-[12px] font-semibold uppercase tracking-wide text-surface-500">{weekdayShort(day)}</div>)}
    </div>
    <div ref={grid} className="grid min-h-0 flex-1" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
      {weeks.map((week, row) => {
        const layout = rows[row]
        const lanes = layout.lanes > fits ? fits - 1 : fits
        return <div key={week[0]} className="relative grid grid-cols-7 border-b border-border">
          {week.map((day) => {
            const hidden = layout.items.filter((item) => item.lane >= lanes && week.indexOf(day) >= item.startIndex && week.indexOf(day) <= item.endIndex).length
            const target = drag?.started && drag.target === day
            return <div
              key={day}
              className={cn('relative border-l border-border', day.slice(0, 7) !== month && 'bg-surface-900/40', target && 'bg-white/10')}
              onDoubleClick={() => handlers.onCreate({ allDay: true, start: day, end: shiftIso(day, 1) })}
            >
              <button
                type="button"
                onClick={() => handlers.onOpenDay(day)}
                className={cn('mx-auto mt-1 flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] font-semibold',
                  day === today ? 'bg-white text-black' : day.slice(0, 7) === month ? 'text-surface-200 hover:bg-surface-800' : 'text-surface-600 hover:bg-surface-800')}
              >{parseIso(day).getDate() === 1 ? parseIso(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : parseIso(day).getDate()}</button>
              {hidden > 0 && <button
                type="button"
                onClick={() => handlers.onOpenDay(day)}
                className="absolute left-1 right-1 truncate rounded px-1.5 text-left text-[12px] font-semibold text-surface-300 hover:bg-surface-800"
                style={{ top: HEADER + lanes * LINE, height: LINE - 2 }}
              >{hidden} more</button>}
            </div>
          })}
          {layout.items.filter((item) => item.lane < lanes).map((item) => {
            const event = item.event
            const color = colorOf(event, calendars)
            const bar = inAllDayRow(event) || item.endIndex > item.startIndex
            const look = blockStyle(event, color)
            const movable = handlers.canMove(event)
            return <div
              key={event.key}
              role="button"
              tabIndex={0}
              onKeyDown={(key) => { if (key.key === 'Enter') handlers.onOpen(event) }}
              onPointerDown={(pointer) => {
                if (pointer.button !== 0) return
                pointer.stopPropagation()
                if (!movable) return
                pointer.preventDefault()
                document.body.style.userSelect = 'none'
                setDrag({ event, startX: pointer.clientX, startY: pointer.clientY, origin: week[item.startIndex], started: false, target: null })
              }}
              onClick={() => { if (!movable) handlers.onOpen(event) }}
              className={cn('absolute flex items-center gap-1.5 overflow-hidden rounded px-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-white',
                bar ? look.className : 'hover:bg-surface-800', selectedKey === event.key && 'ring-2 ring-white',
                drag?.started && drag.event.key === event.key && 'opacity-40', saving.has(event.key) && 'animate-pulse',
                movable ? 'cursor-grab' : 'cursor-pointer')}
              style={{
                ...(bar ? look.style : {}),
                top: HEADER + item.lane * LINE,
                height: LINE - 2,
                left: `calc(${(item.startIndex / 7) * 100}% + 3px)`,
                width: `calc(${((item.endIndex - item.startIndex + 1) / 7) * 100}% - 6px)`
              }}
            >
              {!bar && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
              {!bar && <span className="shrink-0 text-surface-400">{clockLabel(event.start)}</span>}
              <Blurred><span className={cn('truncate', bar ? 'font-medium' : 'font-semibold text-surface-100',
                !bar && event.response === 'declined' && 'line-through opacity-60')}>{event.title || '(No title)'}</span></Blurred>
            </div>
          })}
        </div>
      })}
    </div>
  </div>
}
