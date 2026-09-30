import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, FlatList, Modal, PanResponder, Pressable, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { VideoView, useVideoPlayer } from 'expo-video'
import { X } from 'lucide-react-native'
import type { DiaryAttachment } from '@ego/core'
import { dateTimeLabel } from '../../lib/diary/format'
import { mediaSource, type MediaSource } from '../../lib/diary/media'
import { Text } from '../ui/text'
import { useChat } from './context'
import { ink } from './theme'

export interface ViewerItem {
  key: string
  messageId: string
  attachment: DiaryAttachment
  sentAt: string
  caption: string
}

const MAX_ZOOM = 5
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 260

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

type Touch = { pageX: number; pageY: number }

function spread(touches: readonly Touch[]): number {
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)
}

/**
 * Pinch to zoom, drag while zoomed, double tap to toggle. At normal size a one-finger swipe is
 * left alone so the pager behind it turns the page.
 */
export function ZoomableImage({ full, preview, width, height, onZoom, onTap }: {
  full: MediaSource
  preview: MediaSource | null
  width: number
  height: number
  onZoom: (zoomed: boolean) => void
  onTap: () => void
}): React.ReactElement {
  const scale = useRef(new Animated.Value(1)).current
  const shiftX = useRef(new Animated.Value(0)).current
  const shiftY = useRef(new Animated.Value(0)).current
  const view = useRef({ scale: 1, x: 0, y: 0, mode: 'idle' as 'idle' | 'pinch' | 'pan', startScale: 1, startSpread: 1, panX: 0, panY: 0, lastTap: 0 })
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ onZoom, onTap })
  latest.current = { onZoom, onTap }

  const handlers = useMemo(() => {
    const place = (nextScale: number, x: number, y: number, animated: boolean): void => {
      const limitX = (width * (nextScale - 1)) / 2
      const limitY = (height * (nextScale - 1)) / 2
      const state = view.current
      state.scale = nextScale
      state.x = clamp(x, -limitX, limitX)
      state.y = clamp(y, -limitY, limitY)
      if (animated) {
        Animated.parallel([
          Animated.spring(scale, { toValue: state.scale, useNativeDriver: false, bounciness: 0 }),
          Animated.spring(shiftX, { toValue: state.x, useNativeDriver: false, bounciness: 0 }),
          Animated.spring(shiftY, { toValue: state.y, useNativeDriver: false, bounciness: 0 })
        ]).start()
      } else {
        scale.setValue(state.scale)
        shiftX.setValue(state.x)
        shiftY.setValue(state.y)
      }
    }
    const settle = (): void => {
      const state = view.current
      state.mode = 'idle'
      if (state.scale < 1.05) place(1, 0, 0, true)
      latest.current.onZoom(state.scale >= 1.05)
    }
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: (event) => event.nativeEvent.touches.length >= 2,
      onMoveShouldSetPanResponder: (event, gesture) => event.nativeEvent.touches.length >= 2 ||
        (view.current.scale > 1.01 && (Math.abs(gesture.dx) > 3 || Math.abs(gesture.dy) > 3)),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        view.current.mode = 'idle'
        if (event.nativeEvent.touches.length >= 2) latest.current.onZoom(true)
      },
      onPanResponderMove: (event, gesture) => {
        const state = view.current
        const touches = event.nativeEvent.touches
        if (touches.length >= 2) {
          const distance = spread(touches)
          if (state.mode !== 'pinch') {
            state.mode = 'pinch'
            state.startSpread = Math.max(distance, 1)
            state.startScale = state.scale
          }
          place(clamp(state.startScale * distance / state.startSpread, 1, MAX_ZOOM), state.x, state.y, false)
          return
        }
        if (state.mode !== 'pan') {
          state.mode = 'pan'
          state.panX = state.x - gesture.dx
          state.panY = state.y - gesture.dy
        }
        if (state.scale > 1.01) place(state.scale, state.panX + gesture.dx, state.panY + gesture.dy, false)
      },
      onPanResponderRelease: settle,
      onPanResponderTerminate: settle
    })
    const tap = (): void => {
      const state = view.current
      const now = Date.now()
      if (now - state.lastTap < DOUBLE_TAP_MS) {
        if (tapTimer.current) clearTimeout(tapTimer.current)
        state.lastTap = 0
        const zoomIn = state.scale < 1.05
        place(zoomIn ? DOUBLE_TAP_ZOOM : 1, 0, 0, true)
        latest.current.onZoom(zoomIn)
        return
      }
      state.lastTap = now
      tapTimer.current = setTimeout(() => latest.current.onTap(), DOUBLE_TAP_MS)
    }
    return { pan: responder.panHandlers, tap }
  }, [height, scale, shiftX, shiftY, width])

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current)
  }, [])

  return <View {...handlers.pan} style={{ width, height, overflow: 'hidden' }}>
    <Pressable onPress={handlers.tap} style={{ width, height }}>
      <Animated.View style={{ width, height, transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] }}>
        <Image source={full} placeholder={preview ?? undefined} placeholderContentFit="contain" style={{ width, height }} contentFit="contain" transition={150} />
      </Animated.View>
    </Pressable>
  </View>
}

export function PlayingVideo({ source, loop, width, height }: { source: MediaSource; loop: boolean; width: number; height: number }): React.ReactElement {
  const player = useVideoPlayer({ uri: source.uri, headers: source.headers, useCaching: true }, (created) => {
    created.loop = loop
    created.play()
  })
  return <VideoView
    player={player}
    style={{ width, height }}
    contentFit="contain"
    nativeControls={!loop}
    fullscreenOptions={{ enable: false }}
    allowsPictureInPicture={false}
  />
}

function Page({ item, active, width, height, onZoom, onTap }: {
  item: ViewerItem
  active: boolean
  width: number
  height: number
  onZoom: (zoomed: boolean) => void
  onTap: () => void
}): React.ReactElement {
  const { api, localFiles } = useChat()
  const { attachment } = item
  const preview = attachment.previewId ? mediaSource(api, localFiles, attachment.previewId) : null
  if (!attachment.mediaId) {
    return <Pressable onPress={onTap} style={{ width, height }} className="items-center justify-center">
      {preview && <Image source={preview} style={{ width, height: height * 0.6 }} contentFit="contain" />}
      <Text className="mt-4 text-[15px] text-muted-foreground">Not in the Telegram export</Text>
    </Pressable>
  }
  const full = mediaSource(api, localFiles, attachment.mediaId)
  if (attachment.kind === 'photo') {
    return <ZoomableImage full={full} preview={preview} width={width} height={height} onZoom={onZoom} onTap={onTap} />
  }
  if (!active) {
    return <View style={{ width, height }}>
      {preview && <Image source={preview} style={{ width, height }} contentFit="contain" />}
    </View>
  }
  return <View style={{ width, height }}>
    <PlayingVideo source={full} loop={attachment.kind === 'animation'} width={width} height={height} />
    {attachment.kind === 'animation' && <Pressable onPress={onTap} style={{ position: 'absolute', inset: 0 }} />}
  </View>
}

/** Every photo, video, and GIF in the diary, one per page, starting from the one tapped. */
export function MediaViewer({ items, start, onClose }: {
  items: readonly ViewerItem[]
  start: number | null
  onClose: () => void
}): React.ReactElement {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(start ?? 0)
  const [chrome, setChrome] = useState(true)
  const [zoomed, setZoomed] = useState(false)

  useEffect(() => {
    if (start === null) return
    setIndex(start)
    setChrome(true)
    setZoomed(false)
  }, [start])

  const current = items[index]
  return <Modal visible={start !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      {start !== null && <FlatList
        data={items}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        initialScrollIndex={start}
        getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
        keyExtractor={(item) => item.key}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: position }) => <Page
          item={item}
          active={position === index}
          width={width}
          height={height}
          onZoom={setZoomed}
          onTap={() => setChrome((shown) => !shown)}
        />}
      />}
      {chrome && current && <>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 8, backgroundColor: 'rgba(0,0,0,0.45)', flexDirection: 'row', alignItems: 'center' }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} className="h-11 w-11 items-center justify-center">
            <X color={ink.text} size={24} />
          </Pressable>
          <View style={{ flex: 1, marginLeft: 4 }}>
            <Text className="text-[15px] font-semibold">{dateTimeLabel(current.sentAt)}</Text>
            <Text className="text-[13px] text-surface-300">{index + 1} of {items.length}</Text>
          </View>
        </View>
        {current.caption.trim().length > 0 && <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 16, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <Text numberOfLines={5} className="text-[15px] leading-5">{current.caption}</Text>
        </View>}
      </>}
    </View>
  </Modal>
}
