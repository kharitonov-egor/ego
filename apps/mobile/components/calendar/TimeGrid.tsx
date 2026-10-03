import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanResponder, Pressable, ScrollView, Text, Vibration, View, type GestureResponderEvent, type LayoutChangeEvent
} from 'react-native'
import { ChevronDown, ChevronUp } from 'lucide-react-native'
import type { CalendarEvent, CalendarInfo } from '@ego/api-contracts'
import { parseIso } from '@ego/local/dates'
import {
  DAY_MINUTES, MIN_BLOCK_MINUTES, clockLabel, hourLabel, instantAt, layoutDay, layoutSpans, minutesInto, resizeEvent, shiftEvent,
  snapMinutes, timeRangeLabel, weekdayShort, type EventTimes
} from '@ego/local/calendar/layout'
import { Blurred } from '../../lib/blur'
import { blockStyle, colorOf } from './ui'

const HOUR = 52
const GUTTER = 44
const LANE = 20
const COLLAPSED_LANES = 2
const SWIPE_DISTANCE = 64
const EDGE = 56
const RESIZE_ZONE = 14
const NOW_COLOR = '#ea4335'

type Drag =
  | { kind: 'move'; event: CalendarEvent; startX: number; startY: number; startScroll: number; dayIndex: number; times: EventTimes | null }
  | { kind: 'resize'; event: CalendarEvent; times: EventTimes | null }
  | { kind: 'allday'; event: CalendarEvent; startX: number; dayIndex: number; times: EventTimes | null }

export interface GridHandlers {
  canMove: (event: CalendarEvent) => boolean
  onOpen: (event: CalendarEvent) => void
  onMove: (event: CalendarEvent, times: EventTimes) => void
  onCreate: (times: EventTimes) => void
  onOpenDay: (day: string) => void
  onSwipe: (direction: 1 | -1) => void
}

/**
 * Google's day, 3-day, and week grid. Hold an event to pick it up and drag it to another time or
 * day; hold its bottom edge to stretch it. Tap an empty slot to add an event, and swipe sideways
 * for the next or previous page.
 */
export function TimeGrid({ days, today, events, calendars, saving, handlers }: {
  days: string[]
  today: string
  events: CalendarEvent[]
  calendars: ReadonlyMap<string, CalendarInfo>
  saving: ReadonlySet<string>
  handlers: GridHandlers
}): React.ReactElement {
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const dragRef = useRef<Drag | null>(null)
  const latest = useRef({ days, handlers })
  latest.current = { days, handlers }
  const scroller = useRef<ScrollView>(null)
  const gridView = useRef<View>(null)
  const grid = useRef({ x: 0, y: 0, height: 0 })
  const scrollY = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })
  const scrollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const column = width > 0 ? (width - GUTTER) / days.length : 0

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const nowMinutes = days.includes(today) ? minutesInto(new Date().toISOString(), today) : 0
    const target = nowMinutes > 9 * 60 ? nowMinutes - 2 * 60 : 7 * 60
    const timer = setTimeout(() => scroller.current?.scrollTo({ y: (target / 60) * HOUR, animated: false }), 0)
    return () => clearTimeout(timer)
  }, [days[0], days.length])

  const spans = useMemo(() => layoutSpans(events, days), [events, days])
  const placements = useMemo(() => days.map((day) => layoutDay(events, day)), [events, days])
  const visibleLanes = expanded ? spans.lanes : Math.min(spans.lanes, COLLAPSED_LANES)
  const hiddenPerDay = useMemo(() => days.map((_, index) => spans.items.filter((item) =>
    item.lane >= COLLAPSED_LANES && item.startIndex <= index && item.endIndex >= index).length), [days, spans])

  const dayAt = useCallback((pageX: number): number => {
    const count = latest.current.days.length
    const columnWidth = (width - GUTTER) / count
    return Math.max(0, Math.min(count - 1, Math.floor((pageX - grid.current.x - GUTTER) / columnWidth)))
  }, [width])

  const minutesAt = (pageY: number): number =>
    Math.max(0, Math.min(DAY_MINUTES, ((pageY - grid.current.y + scrollY.current) / HOUR) * 60))

  const stopScroll = (): void => {
    if (scrollTimer.current) clearInterval(scrollTimer.current)
    scrollTimer.current = null
  }

  const follow = useCallback((pageX: number, pageY: number): void => {
    const current = dragRef.current
    if (!current) return
    pointer.current = { x: pageX, y: pageY }
    let next: Drag
    if (current.kind === 'move') {
      const minutes = snapMinutes(((pageY - current.startY + scrollY.current - current.startScroll) / HOUR) * 60)
      next = { ...current, times: shiftEvent(current.event, dayAt(pageX) - current.dayIndex, minutes) }
    } else if (current.kind === 'resize') {
      next = { ...current, times: resizeEvent(current.event, snapMinutes(minutesAt(pageY)), latest.current.days[dayAt(pageX)]) }
    } else {
      next = { ...current, times: shiftEvent(current.event, dayAt(pageX) - current.dayIndex, 0) }
    }
    dragRef.current = next
    setDrag(next)
  }, [dayAt])

  const autoScroll = useCallback((): void => {
    const current = dragRef.current
    if (!current || current.kind === 'allday') return
    const { y } = pointer.current
    const direction = y < grid.current.y + EDGE ? -1 : y > grid.current.y + grid.current.height - EDGE ? 1 : 0
    if (direction === 0) {
      stopScroll()
      return
    }
    if (scrollTimer.current) return
    scrollTimer.current = setInterval(() => {
      const target = Math.max(0, Math.min(24 * HOUR - grid.current.height, scrollY.current + direction * 12))
      if (target === scrollY.current) return
      scrollY.current = target
      scroller.current?.scrollTo({ y: target, animated: false })
      follow(pointer.current.x, pointer.current.y)
    }, 16)
  }, [follow])

  const finish = useCallback((): void => {
    stopScroll()
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!current?.times) return
    const { start, end } = current.times
    if (start !== current.event.start || end !== current.event.end) latest.current.handlers.onMove(current.event, current.times)
  }, [])

  const swipe = useRef({ active: false })
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (dragRef.current) return true
      const sideways = Math.abs(gesture.dx) > 24 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2
      swipe.current.active = sideways
      return sideways
    },
    onPanResponderMove: (_event, gesture) => {
      if (!dragRef.current) return
      follow(gesture.moveX, gesture.moveY)
      autoScroll()
    },
    onPanResponderRelease: (_event, gesture) => {
      if (dragRef.current) {
        finish()
        return
      }
      if (swipe.current.active && Math.abs(gesture.dx) > SWIPE_DISTANCE) latest.current.handlers.onSwipe(gesture.dx < 0 ? 1 : -1)
      swipe.current.active = false
    },
    onPanResponderTerminate: () => {
      swipe.current.active = false
      finish()
    },
    onPanResponderTerminationRequest: () => dragRef.current === null,
    onShouldBlockNativeResponder: () => true
  }), [autoScroll, finish, follow])

  useEffect(() => stopScroll, [])

  const measure = (): void => {
    gridView.current?.measureInWindow((x, y, _width, height) => { grid.current = { x, y, height } })
  }

  const lift = (next: Drag, event: GestureResponderEvent): void => {
    measure()
    Vibration.vibrate(12)
    pointer.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY }
    dragRef.current = next
    setDrag(next)
  }

  const ghost = drag && drag.kind !== 'allday' && drag.times ? { ...drag.event, ...drag.times } : null
  const allDayGhost = drag?.kind === 'allday' && drag.times ? layoutSpans([{ ...drag.event, ...drag.times }], days).items[0] : null

  return <View className="flex-1" onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} {...responder.panHandlers}>
    <View className="flex-row border-b border-border" style={{ paddingLeft: GUTTER }}>
      {days.map((day) => {
        const isToday = day === today
        return <Pressable key={day} accessibilityRole="button" accessibilityLabel={`Open ${parseIso(day).toDateString()}`} onPress={() => handlers.onOpenDay(day)} className="flex-1 items-center py-1.5 active:bg-surface-900">
          <Text className={`text-[11px] font-semibold uppercase ${isToday ? 'text-foreground' : 'text-surface-500'}`}>{days.length > 3 ? weekdayShort(day).charAt(0) : weekdayShort(day)}</Text>
          <View className={`mt-0.5 h-8 w-8 items-center justify-center rounded-full ${isToday ? 'bg-white' : ''}`}>
            <Text className={`text-[17px] font-semibold ${isToday ? 'text-black' : 'text-surface-200'}`}>{parseIso(day).getDate()}</Text>
          </View>
        </Pressable>
      })}
    </View>

    {spans.lanes > 0 && <View className="flex-row border-b border-border">
      <View style={{ width: GUTTER }} className="items-center justify-start pt-1">
        {spans.lanes > COLLAPSED_LANES && <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Show fewer all-day events' : 'Show every all-day event'} hitSlop={8} onPress={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp color="#a3a3a3" size={16} /> : <ChevronDown color="#a3a3a3" size={16} />}
        </Pressable>}
      </View>
      <View style={{ flex: 1, height: (visibleLanes + (hiddenPerDay.some(Boolean) && !expanded ? 1 : 0)) * LANE + 4 }}>
        {column > 0 && spans.items.filter((item) => item.lane < visibleLanes).map((item) => {
          const look = blockStyle(item.event, colorOf(item.event, calendars))
          const movable = handlers.canMove(item.event)
          return <Pressable
            key={item.event.key}
            accessibilityRole="button"
            accessibilityLabel={item.event.title || '(No title)'}
            onPress={() => handlers.onOpen(item.event)}
            onLongPress={movable ? (press) => lift({ kind: 'allday', event: item.event, startX: press.nativeEvent.pageX, dayIndex: item.startIndex, times: null }, press) : undefined}
            delayLongPress={350}
            style={[look.box, {
              position: 'absolute', top: 2 + item.lane * LANE, height: LANE - 3, borderRadius: 5, paddingHorizontal: 4, justifyContent: 'center',
              left: item.startIndex * column + 1, width: (item.endIndex - item.startIndex + 1) * column - 2,
              opacity: drag?.event.key === item.event.key ? 0.4 : saving.has(item.event.key) ? 0.7 : look.box.opacity
            }]}
          >
            <Blurred><Text numberOfLines={1} style={[look.text, { fontSize: 11, fontWeight: '600' }]}>{item.event.title || '(No title)'}</Text></Blurred>
          </Pressable>
        })}
        {!expanded && column > 0 && hiddenPerDay.map((count, index) => count > 0 && <Pressable
          key={days[index]}
          onPress={() => setExpanded(true)}
          style={{ position: 'absolute', top: 2 + visibleLanes * LANE, left: index * column + 2, width: column - 4, height: LANE - 3, justifyContent: 'center' }}
        ><Text numberOfLines={1} className="text-[11px] font-semibold text-surface-300">+{count}</Text></Pressable>)}
        {allDayGhost && <View pointerEvents="none" style={{
          position: 'absolute', top: 2, height: LANE - 3, borderRadius: 5, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
          backgroundColor: 'rgba(255,255,255,0.2)', left: allDayGhost.startIndex * column + 1, width: (allDayGhost.endIndex - allDayGhost.startIndex + 1) * column - 2
        }} />}
      </View>
    </View>}

    <View ref={gridView} className="flex-1" onLayout={measure}>
      <ScrollView
        ref={scroller}
        scrollEnabled={drag === null}
        onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y }}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ height: 24 * HOUR, flexDirection: 'row' }}>
          <View style={{ width: GUTTER }}>
            {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => <Text
              key={hour}
              className="absolute right-1.5 text-[10px] font-medium text-surface-500"
              style={{ top: hour * HOUR - 7 }}
            >{hourLabel(hour)}</Text>)}
          </View>
          <View style={{ flex: 1 }}>
            {Array.from({ length: 24 }, (_, hour) => <View key={hour} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: hour * HOUR, height: 1, backgroundColor: '#262626' }} />)}
            {column > 0 && days.map((day, index) => {
              const nowMinutes = day === today ? minutesInto(new Date(now).toISOString(), day) : -1
              return <View key={day} style={{ position: 'absolute', top: 0, bottom: 0, left: index * column, width: column, borderLeftWidth: 1, borderLeftColor: '#262626' }}>
                <Pressable
                  accessibilityLabel={`Add an event on ${parseIso(day).toDateString()}`}
                  onPress={(press) => {
                    const minutes = Math.floor(((press.nativeEvent.locationY / HOUR) * 60) / 30) * 30
                    handlers.onCreate({ allDay: false, start: instantAt(day, minutes), end: instantAt(day, Math.min(minutes + 60, DAY_MINUTES)) })
                  }}
                  style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}
                />
                {placements[index].map((placement) => {
                  const event = placement.event
                  const look = blockStyle(event, colorOf(event, calendars))
                  const height = (Math.max(placement.bottom - placement.top, MIN_BLOCK_MINUTES) / 60) * HOUR
                  const movable = handlers.canMove(event)
                  const slotWidth = column / placement.columns
                  return <Pressable
                    key={event.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${event.title || '(No title)'}, ${timeRangeLabel(event)}`}
                    onPress={() => handlers.onOpen(event)}
                    onLongPress={movable ? (press) => {
                      const nearBottom = height >= 36 && !placement.endsAfter && press.nativeEvent.locationY > height - RESIZE_ZONE
                      lift(nearBottom
                        ? { kind: 'resize', event, times: null }
                        : { kind: 'move', event, startX: press.nativeEvent.pageX, startY: press.nativeEvent.pageY, startScroll: scrollY.current, dayIndex: index, times: null }, press)
                    } : undefined}
                    delayLongPress={350}
                    style={[look.box, {
                      position: 'absolute', top: (placement.top / 60) * HOUR + 1, height: height - 2, borderRadius: 5,
                      left: placement.column * slotWidth + 1, width: placement.span * slotWidth - 2, paddingHorizontal: 3, paddingTop: 1, overflow: 'hidden',
                      opacity: drag?.event.key === event.key ? 0.4 : saving.has(event.key) ? 0.7 : look.box.opacity
                    }]}
                  >
                    <Blurred><Text numberOfLines={height < 40 ? 1 : 3} style={[look.text, { fontSize: 11, fontWeight: '600', lineHeight: 13 }]}>
                      {event.title || '(No title)'}{height < 30 ? `, ${clockLabel(event.start)}` : ''}
                    </Text></Blurred>
                    {height >= 46 && days.length < 7 && <Text numberOfLines={1} style={[look.text, { fontSize: 10, opacity: 0.9 }]}>{timeRangeLabel(event)}</Text>}
                    {movable && height >= 36 && <View pointerEvents="none" style={{ position: 'absolute', bottom: 2, alignSelf: 'center', width: 14, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' }} />}
                  </Pressable>
                })}
                {ghost && layoutDay([ghost], day).map((placement) => <View key="ghost" pointerEvents="none" style={{
                  position: 'absolute', left: 1, right: 1, top: (placement.top / 60) * HOUR, borderRadius: 5, borderWidth: 2,
                  borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 2,
                  height: (Math.max(placement.bottom - placement.top, MIN_BLOCK_MINUTES) / 60) * HOUR
                }}><Text numberOfLines={2} style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{clockLabel(ghost.start)}</Text></View>)}
                {nowMinutes >= 0 && nowMinutes <= DAY_MINUTES && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (nowMinutes / 60) * HOUR - 1 }}>
                  <View style={{ height: 2, backgroundColor: NOW_COLOR }} />
                  <View style={{ position: 'absolute', left: -5, top: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: NOW_COLOR }} />
                </View>}
              </View>
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  </View>
}
