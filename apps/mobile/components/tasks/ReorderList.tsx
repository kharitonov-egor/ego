import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PanResponder, Pressable, ScrollView, Vibration, View, type GestureResponderEvent } from 'react-native'

const GAP = 12
const EDGE = 64
const SCROLL_STEP = 12
const DEFAULT_HEIGHT = 76

interface Lifted {
  id: string
  fromIndex: number
  offsetY: number
}

/**
 * A vertical list that reorders by holding a row and dragging it, the way boards are ordered. The
 * rows are measured as they lay out, so the drop index comes straight from the finger's height.
 */
export function ReorderList<T extends { id: string }>({ items, renderItem, onPress, onMove, header, footer, label }: {
  items: readonly T[]
  renderItem: (item: T, lifted: boolean) => React.ReactElement
  onPress: (item: T) => void
  onMove: (id: string, index: number) => void
  header?: React.ReactNode
  footer?: React.ReactNode
  label: (item: T) => string
}): React.ReactElement {
  const [lifted, setLifted] = useState<Lifted | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const latest = useRef({ items, onMove })
  latest.current = { items, onMove }
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
      y += (heights.current.get(rows[position].id) ?? DEFAULT_HEIGHT) + GAP
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
      top += height + GAP
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
    onMoveShouldSetPanResponderCapture: () => liftedRef.current !== null,
    onPanResponderGrant: () => { rootActive.current = true },
    onPanResponderMove: (_event, gesture) => move(gesture.moveY),
    onPanResponderRelease: finish,
    onPanResponderTerminate: finish,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true
  }), [finish, move])

  useEffect(() => stop, [stop])

  const lift = (item: T, index: number, event: GestureResponderEvent): void => {
    const top = viewport.current.top + rowsTop.current + rowTop(index, null) - scrollY.current
    const next: Lifted = { id: item.id, fromIndex: index, offsetY: event.nativeEvent.pageY - top }
    Vibration.vibrate(12)
    liftedRef.current = next
    hoverRef.current = index
    pointerY.current = event.nativeEvent.pageY
    ghost.setValue(top - root.current.y)
    setLifted(next)
    setHover(index)
  }

  /** A long press that ends without moving never hands the touch to the list, so it ends here. */
  const releasedInPlace = (): void => {
    if (liftedRef.current && !rootActive.current) finish()
  }

  const liftedItem = lifted ? items.find((item) => item.id === lifted.id) : undefined
  const rows: Array<T | 'placeholder'> = items.filter((item) => item.id !== lifted?.id)
  if (lifted && hover !== null) rows.splice(Math.min(hover, rows.length), 0, 'placeholder')

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
        <View onLayout={(event) => { rowsTop.current = event.nativeEvent.layout.y }} style={{ gap: GAP }}>
          {rows.map((item) => item === 'placeholder'
            ? <View key="placeholder" style={{ height: liftedItem ? heights.current.get(liftedItem.id) ?? DEFAULT_HEIGHT : DEFAULT_HEIGHT, borderRadius: 24, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#525252' }} />
            : <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={label(item)}
              accessibilityHint="Opens it. Hold to reorder."
              onLayout={(event) => heights.current.set(item.id, event.nativeEvent.layout.height)}
              onPress={() => { if (!liftedRef.current) onPress(item) }}
              onLongPress={(event) => lift(item, items.findIndex((entry) => entry.id === item.id), event)}
              onPressOut={releasedInPlace}
              delayLongPress={300}
            >{renderItem(item, false)}</Pressable>)}
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
    >{renderItem(liftedItem, true)}</Animated.View>}
  </View>
}
