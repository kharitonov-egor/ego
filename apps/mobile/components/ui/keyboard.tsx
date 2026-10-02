import React, { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Keyboard, Platform, ScrollView, TextInput, View,
  type KeyboardEvent, type ScrollViewProps, type ViewProps
} from 'react-native'
import { inputScrollDelta, keyboardOverlap } from '../../lib/keyboard-layout'

type KeyboardFrame = ReturnType<typeof Keyboard.metrics> | null
const KeyboardContext = createContext<KeyboardFrame>(null)

export function useKeyboardVisible(): boolean {
  return useContext(KeyboardContext) != null
}

/** Use once around navigation and again inside each native modal containing inputs. */
export function KeyboardViewport({ active = true, children, style, onLayout, ...props }: ViewProps & { active?: boolean }): React.ReactElement {
  const view = useRef<View>(null)
  const [frame, setFrame] = useState<KeyboardFrame>(() => active ? Keyboard.metrics() : null)
  const [overlap, setOverlap] = useState(0)
  const measurement = useRef(0)

  useEffect(() => {
    if (!active) {
      setFrame(null)
      return
    }
    setFrame(Keyboard.metrics())
    const show = (event: KeyboardEvent): void => {
      Keyboard.scheduleLayoutAnimation(event)
      setFrame(event.endCoordinates.height > 0 ? event.endCoordinates : null)
    }
    const hide = (event: KeyboardEvent): void => {
      Keyboard.scheduleLayoutAnimation(event)
      setFrame(null)
    }
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardDidHide', hide),
      ...(Platform.OS === 'ios' ? [
        Keyboard.addListener('keyboardWillChangeFrame', show),
        Keyboard.addListener('keyboardWillHide', hide)
      ] : [])
    ]
    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [active])

  const measure = useCallback(() => {
    const request = ++measurement.current
    if (!active || !frame) {
      setOverlap(0)
      return
    }
    // Measure the outer view, which never includes our own keyboard spacing.
    // An Android window that already resized therefore needs no extra space.
    view.current?.measureInWindow((_x, y, _width, height) => {
      if (request === measurement.current) setOverlap(keyboardOverlap(y, height, frame.screenY))
    })
  }, [active, frame])

  useLayoutEffect(() => {
    measure()
    return () => { measurement.current += 1 }
  }, [measure])

  return <KeyboardContext.Provider value={active ? frame : null}>
    <View
      {...props}
      ref={view}
      collapsable={false}
      style={[{ flex: 1 }, style]}
      onLayout={(event) => { measure(); onLayout?.(event) }}
    >
      <View style={{ flex: 1, marginBottom: active && frame ? overlap : 0 }}>{children}</View>
    </View>
  </KeyboardContext.Provider>
}

/** Keeps the focused field visible after keyboard, focus, and form layout changes. */
export const KeyboardScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScrollView({
  onFocus, onBlur, onLayout, onContentSizeChange, onScroll, horizontal,
  keyboardShouldPersistTaps = 'handled', scrollEventThrottle = 16, ...props
}, forwardedRef) {
  const scroll = useRef<ScrollView | null>(null)
  const focused = useRef<ReturnType<typeof TextInput.State.currentlyFocusedInput> | null>(null)
  const offset = useRef(0)
  const pending = useRef<number | null>(null)
  const measurement = useRef(0)
  const frame = useContext(KeyboardContext)

  const reveal = useCallback(() => {
    if (pending.current !== null) cancelAnimationFrame(pending.current)
    const request = ++measurement.current
    pending.current = requestAnimationFrame(() => {
      pending.current = null
      const input = focused.current
      if (horizontal || !frame || !input || input !== TextInput.State.currentlyFocusedInput()) return
      scroll.current?.getNativeScrollRef()?.measureInWindow((_x, y, _width, height) => {
        input.measureInWindow((_inputX, inputY, _inputWidth, inputHeight) => {
          if (request !== measurement.current || input !== TextInput.State.currentlyFocusedInput()) return
          const delta = inputScrollDelta(inputY, inputHeight, y, Math.min(y + height, frame.screenY))
          if (delta !== 0) scroll.current?.scrollTo({ y: Math.max(0, offset.current + delta), animated: true })
        })
      })
    })
  }, [frame, horizontal])

  useEffect(() => {
    reveal()
    return () => {
      if (pending.current !== null) cancelAnimationFrame(pending.current)
      measurement.current += 1
    }
  }, [reveal])

  const setRef = useCallback((value: ScrollView | null) => {
    scroll.current = value
    if (typeof forwardedRef === 'function') forwardedRef(value)
    else if (forwardedRef) forwardedRef.current = value
  }, [forwardedRef])

  return <ScrollView
    {...props}
    ref={setRef}
    horizontal={horizontal}
    keyboardShouldPersistTaps={keyboardShouldPersistTaps}
    scrollEventThrottle={scrollEventThrottle}
    onFocus={(event) => {
      focused.current = TextInput.State.currentlyFocusedInput()
      reveal()
      onFocus?.(event)
    }}
    onBlur={(event) => { focused.current = null; onBlur?.(event) }}
    onLayout={(event) => { reveal(); onLayout?.(event) }}
    onContentSizeChange={(width, height) => { reveal(); onContentSizeChange?.(width, height) }}
    onScroll={(event) => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event) }}
  />
})
