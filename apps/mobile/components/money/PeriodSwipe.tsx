import React, { useMemo, useRef } from 'react'
import { Animated, PanResponder, type StyleProp, type ViewStyle } from 'react-native'
import { usePeriod } from '../../lib/period-context'
import { isHorizontalSwipe, swipeStep } from '@ego/local/periods'
import { useReducedMotion } from './tokens'

/**
 * Steps the shared period on a horizontal swipe anywhere inside. Vertical scrolling and taps still
 * reach the content, and a child that holds its own gesture, like the chart scrubber, keeps it.
 */
export function PeriodSwipe({ enabled = true, style, onStep, canStep, children }: {
  enabled?: boolean
  style?: StyleProp<ViewStyle>
  /** Steps something other than the shared period, such as Budget's own month. */
  onStep?: (delta: -1 | 1) => void
  /** Limits `onStep`, which otherwise steps both ways. */
  canStep?: (delta: -1 | 1) => boolean
  children: React.ReactNode
}): React.ReactElement {
  const period = usePeriod()
  const reducedMotion = useReducedMotion()
  const live = useRef({ period, enabled, reducedMotion, onStep, canStep })
  live.current = { period, enabled, reducedMotion, onStep, canStep }
  const offset = useRef(new Animated.Value(0)).current

  const responder = useMemo(() => {
    const settle = (): void => {
      if (live.current.reducedMotion) offset.setValue(0)
      else Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 18 }).start()
    }
    const allowed = (delta: -1 | 1): boolean => live.current.onStep !== undefined
      ? live.current.canStep?.(delta) ?? true
      : delta === -1 ? live.current.period.canGoBack : live.current.period.canGoForward
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, state) => live.current.enabled && isHorizontalSwipe(state.dx, state.dy),
      onPanResponderTerminationRequest: () => true,
      onPanResponderMove: (_, state) => {
        if (live.current.reducedMotion) return
        const delta = state.dx < 0 ? -1 : 1
        offset.setValue(state.dx * (allowed(delta) ? 0.3 : 0.08))
      },
      onPanResponderRelease: (_, state) => {
        const delta = swipeStep(state.dx, state.vx)
        if (delta !== 0 && allowed(delta)) (live.current.onStep ?? live.current.period.step)(delta)
        settle()
      },
      onPanResponderTerminate: settle
    })
  }, [offset])

  return <Animated.View {...responder.panHandlers} style={[{ flex: 1, transform: [{ translateX: offset }] }, style]}>
    {children}
  </Animated.View>
}
