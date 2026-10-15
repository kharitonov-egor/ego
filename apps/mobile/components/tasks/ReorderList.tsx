import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder, Pressable, ScrollView, Vibration, View, type GestureResponderEvent } from 'react-native'

const GAP = 12
const EDGE = 64
const SCROLL_STEP = 12
const DEFAULT_HEIGHT = 76
const HOLD_DELAY = 300
/** How far a held row moves before it counts as a drag rather than a hold. */
const SLOP = 8

interface Lifted {
  id: string
  fromIndex: number
  offsetY: number
  x: number
  y: number
}

/** Goes on the row's own Pressable when the list has no `onPress`. */
export interface RowHold {
  onLongPress: (event: GestureResponderEvent) => void
  onPressOut: () => void
  delayLongPress: number
}

const GHOST_HOLD: RowHold = { onLongPress: () => undefined, onPressOut: () => undefined, delayLongPress: HOLD_DELAY }

type Press<T> =
  | { onPress: (item: T) => void; label: (item: T) => string }
  /** The rows bring their own Pressable and spread `hold` onto it. */
  | { onPress?: undefined; label?: undefined }

/**
 * A vertical list that reorders by holding a row and dragging it, the way boards are ordered. The
 * rows are measured as they lay out, so the drop index comes straight from the finger's height.
 */
export function ReorderList<T extends { id: string }>({
  items, renderItem, onPress, onMove, onHold, header, footer, label, gap = GAP, radius = 24
}: {
  items: readonly T[]
  renderItem: (item: T, lifted: boolean, hold: RowHold) => React.ReactElement
  onMove: (id: string, index: number) => void
  /** A row was held and let go without being dragged. */
  onHold?: (item: T) => void
  header?: React.ReactNode
  footer?: React.ReactNode
  gap?: number
  radius?: number
} & Press<T>): React.ReactElement {
  const [lifted, setLifted] = useState<Lifted | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const latest = useRef({ items, onMove, onHold, gap })
  latest.current = { items, onMove, onHold, gap }
  const liftedRef = useRef<Lifted | null>(null)
  const hoverRef = useRef<number | null>(null)
  const rootActive = useRef(false)
  const pointerY = useRef(0)
  const root = useRef({ x: 0, y: 0 })
  const rootView = useRef<View>(null)
  const scroll = useRef<ScrollView>(null)
  const frame = useRef<View>(null)
  const viewport = useRef({ top: 0, height: 0 })
  const contentHeight = useRef(0)
  const scrollY = useRef(0)
  const rowsTop = useRef(0)
  const heights = useRef(new Map<string, number>())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const ghost = useRef(new Animated.Value(0)).current

  const rowTop = useCallback((index: number, skip: string | null): number => {
    let y = 0
    const rows = latest.current.items.filter((item) => item.id !== skip)
    for (let position = 0; position < index && position < rows.length; position += 1) {
      y += (heights.current.get(rows[position].id) ?? DEFAULT_HEIGHT) + latest.current.gap
    }
    return y
  }, [])

  const updateHover = useCallback((): void => {
    const current = liftedRef.current
    if (!current) return
    const contentY = pointerY.current - viewport.current.top + scrollY.current - rowsTop.current
    const rows = latest.current.items.filter((item) => item.id !== current.id)
    let top = 0
    let index = rows.length
    for (let position = 0; position < rows.length; position += 1) {
      const height = heights.current.get(rows[position].id) ?? DEFAULT_HEIGHT
      if (contentY < top + height / 2) {
        index = position
        break
      }
      top += height + latest.current.gap
    }
    if (hoverRef.current === index) return
    hoverRef.current = index
    setHover(index)
  }, [])

  const stop = useCallback((): void => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }, [])

  const finish = useCallback((): void => {
    stop()
    const current = liftedRef.current
    const index = hoverRef.current
    liftedRef.current = null
    hoverRef.current = null
    rootActive.current = false
    setLifted(null)
    setHover(null)
    if (current && index !== null && index !== current.fromIndex) latest.current.onMove(current.id, index)
  }, [stop])

  const move = useCallback((y: number): void => {
    const current = liftedRef.current
    if (!current) return
    pointerY.current = y
    ghost.setValue(y - root.current.y - current.offsetY)
    updateHover()
    const direction = y > viewport.current.top + viewport.current.height - EDGE ? 1 : y < viewport.current.top + EDGE ? -1 : 0
    if (direction === 0) {
      stop()
      return
    }
    if (timer.current) return
    timer.current = setInterval(() => {
      const limit = Math.max(0, contentHeight.current - viewport.current.height)
      const to = Math.max(0, Math.min(limit, scrollY.current + direction * SCROLL_STEP))
      if (to === scrollY.current) return
      scrollY.current = to
      scroll.current?.scrollTo({ y: to, animated: false })
      updateHover()
    }, 16)
  }, [ghost, stop, updateHover])

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      const current = liftedRef.current
      return current !== null && Math.hypot(gesture.moveX - current.x, gesture.moveY - current.y) > SLOP
    },
    onPanResponderGrant: () => { rootActive.current = true },
    onPanResponderMove: (_event, gesture) => move(gesture.moveY),
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true
  }), [finish, move])

  useEffect(() => stop, [stop])

  const lift = (item: T, event: GestureResponderEvent): void => {
    const index = latest.current.items.findIndex((entry) => entry.id === item.id)
    if (index < 0) return
    const { pageX, pageY } = event.nativeEvent
    const top = viewport.current.top + rowsTop.current + rowTop(index, null) - scrollY.current
    const next: Lifted = { id: item.id, fromIndex: index, offsetY: pageY - top, x: pageX, y: pageY }
    Vibration.vibrate(12)
    liftedRef.current = next
    hoverRef.current = index
    pointerY.current = pageY
    ghost.setValue(top - root.current.y)
    setLifted(next)
    setHover(index)
  }

  /**
   * A hold that ends without moving never hands the touch to the list, so it ends here. The lifted
   * row stays mounted, hidden, because an unmounted Pressable drops its handlers and this would
   * never run.
   */
  const releasedInPlace = (): void => {
    const current = liftedRef.current
    if (!current || rootActive.current) return
    const item = latest.current.items.find((entry) => entry.id === current.id)
    finish()
    if (item) latest.current.onHold?.(item)
  }

  const holdFor = (item: T): RowHold => ({
    onLongPress: (event) => lift(item, event),
    onPressOut: releasedInPlace,
    delayLongPress: HOLD_DELAY
  })

  const liftedItem = lifted ? items.find((item) => item.id === lifted.id) : undefined
  const rows: Array<T | 'placeholder'> = [...items]
  if (lifted && hover !== null) {
    const before = items.filter((item) => item.id !== lifted.id)[hover]
    rows.splice(before ? rows.indexOf(before) : rows.length, 0, 'placeholder')
  }

  return <View
    ref={rootView}
    style={{ flex: 1 }}
    onLayout={() => rootView.current?.measureInWindow((x, y) => { root.current = { x, y } })}
    {...responder.panHandlers}
  >
    <View
      ref={frame}
      style={{ flex: 1 }}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height
        frame.current?.measureInWindow((_x, y) => { viewport.current = { top: y, height } })
      }}
    >
      <ScrollView
        ref={scroll}
        scrollEnabled={lifted === null}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y
          if (liftedRef.current) updateHover()
        }}
        onContentSizeChange={(_width, height) => { contentHeight.current = height }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {header}
        <View onLayout={(event) => { rowsTop.current = event.nativeEvent.layout.y }} style={{ gap }}>
          {rows.map((item) => {
            if (item === 'placeholder') {
              return <View key="placeholder" style={{ height: liftedItem ? heights.current.get(liftedItem.id) ?? DEFAULT_HEIGHT : DEFAULT_HEIGHT, borderRadius: radius, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#525252' }} />
            }
            const hold = holdFor(item)
            return <View
              key={item.id}
              style={item.id === lifted?.id ? { display: 'none' } : undefined}
              onLayout={(event) => { if (liftedRef.current?.id !== item.id) heights.current.set(item.id, event.nativeEvent.layout.height) }}
            >
              {onPress
                ? <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={label?.(item)}
                  accessibilityHint="Opens it. Hold to reorder."
                  onPress={() => { if (!liftedRef.current) onPress(item) }}
                  {...hold}
                >{renderItem(item, false, hold)}</Pressable>
                : renderItem(item, false, hold)}
            </View>
          })}
        </View>
        {footer}
      </ScrollView>
    </View>
    {lifted && liftedItem && <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 16, right: 16, top: 0, transform: [{ translateY: ghost }, { rotate: '1.5deg' }],
        opacity: 0.95, elevation: 12, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }
      }}
    >{renderItem(liftedItem, true, GHOST_HOLD)}</Animated.View>}
  </View>
}
