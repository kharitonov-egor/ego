import React, { memo, useMemo, useRef } from 'react'
import { Animated, PanResponder, Pressable, Vibration, View } from 'react-native'
import { Image } from 'expo-image'
import { AlertCircle, Check, Clock, CornerUpRight, Pin, Reply } from 'lucide-react-native'
import { diaryPreviewText, type DiaryAttachment } from '@ego/core'
import type { LocalDiaryMessage } from '@ego/local/diary/repository'
import { mediaSource } from '../../lib/diary/media'
import { dateTimeLabel, timeLabel } from '@ego/local/diary/format'
import { Text } from '../ui/text'
import { AudioRow, FileRow, VoiceRow } from './Attachments'
import { useChat } from './context'
import { MediaGrid, VISUAL_KINDS } from './MediaGrid'
import { RichText } from './RichText'
import { Sticker, VideoNote } from './Standalone'
import { BUBBLE_WIDTH, MESSAGE_GUTTER, ink } from './theme'

const REPLY_DISTANCE = 64
/** The retry icon and its gap, which a failed message gives up from its width. */
const RETRY_SPACE = 26

/** Drag a bubble left to reply, the way Telegram does. Vertical drags stay with the list. */
function SwipeToReply({ onReply, children }: { onReply: () => void; children: React.ReactNode }): React.ReactElement {
  const offset = useRef(new Animated.Value(0)).current
  const latest = useRef(onReply)
  latest.current = onReply
  const armed = useRef(false)
  const responder = useMemo(() => {
    const settle = (): void => {
      armed.current = false
      Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start()
    }
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dx < -12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, gesture) => {
        offset.setValue(Math.max(-96, Math.min(0, gesture.dx)))
        if (gesture.dx < -REPLY_DISTANCE && !armed.current) {
          armed.current = true
          Vibration.vibrate(8)
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -REPLY_DISTANCE) latest.current()
        settle()
      },
      onPanResponderTerminate: settle
    })
  }, [offset])
  return <View>
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', right: 18, top: 0, bottom: 0, justifyContent: 'center',
      opacity: offset.interpolate({ inputRange: [-REPLY_DISTANCE, -16, 0], outputRange: [1, 0.2, 0], extrapolate: 'clamp' })
    }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: ink.tile }} className="items-center justify-center">
        <Reply color={ink.text} size={17} />
      </View>
    </Animated.View>
    <Animated.View {...responder.panHandlers} style={{ transform: [{ translateX: offset }] }}>{children}</Animated.View>
  </View>
}

function Meta({ message, onMedia }: { message: LocalDiaryMessage; onMedia: boolean }): React.ReactElement {
  const color = onMedia ? ink.text : ink.meta
  const Icon = message.delivery === 'sending' ? Clock : message.delivery === 'failed' ? AlertCircle : Check
  return <View pointerEvents="none" style={[
    { flexDirection: 'row', alignItems: 'center', gap: 3 },
    onMedia && { backgroundColor: ink.scrim, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }
  ]}>
    {message.pinnedAt && <Pin color={color} size={10} />}
    <Text style={{ color, fontSize: 12 }}>{message.editedAt ? `edited ${timeLabel(message.sentAt)}` : timeLabel(message.sentAt)}</Text>
    <Icon color={message.delivery === 'failed' ? ink.failed : color} size={12} />
  </View>
}

/** Room at the end of the text for the time, so short lines keep it on the same row. */
function metaSpace(message: LocalDiaryMessage): string {
  const label = message.editedAt ? `edited ${timeLabel(message.sentAt)}` : timeLabel(message.sentAt)
  // Figure spaces reserve the timestamp's width without relying on transparent text on Android.
  return '\u2007'.repeat(label.length + 5 + (message.pinnedAt ? 3 : 0))
}

function ReplyQuote({ target, onJump }: { target: LocalDiaryMessage | null; onJump: (id: string) => void }): React.ReactElement {
  const { api, localFiles } = useChat()
  const thumbnail = target?.attachments.find((item) => VISUAL_KINDS.has(item.kind) || item.kind === 'sticker')
  const thumbId = thumbnail?.previewId ?? (thumbnail?.kind === 'photo' || thumbnail?.kind === 'sticker' ? thumbnail.mediaId : null)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Go to the message this replies to"
    disabled={!target}
    onPress={() => target && onJump(target.id)}
    style={{ marginHorizontal: 6, marginTop: 6, borderRadius: 8, backgroundColor: 'rgba(255, 255, 255, 0.07)', flexDirection: 'row', overflow: 'hidden' }}
  >
    <View style={{ width: 3, backgroundColor: ink.text }} />
    {thumbId && <Image source={mediaSource(api, localFiles, thumbId)} style={{ width: 36, height: 36, margin: 4, borderRadius: 4 }} contentFit="cover" />}
    <View style={{ flex: 1, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text numberOfLines={1} className="text-[13px] font-semibold">{target ? dateTimeLabel(target.sentAt) : 'Reply'}</Text>
      <Text numberOfLines={1} className="text-[13px] text-surface-300">{target ? diaryPreviewText(target) : 'Deleted message'}</Text>
    </View>
  </Pressable>
}

function Forwarded({ from }: { from: string | null }): React.ReactElement {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingTop: 7 }}>
    <CornerUpRight color={ink.meta} size={13} />
    <Text numberOfLines={1} style={{ flex: 1, color: ink.meta, fontSize: 13 }}>
      {from ? <>Forwarded from <Text style={{ color: ink.secondary, fontSize: 13, fontWeight: '600' }}>{from}</Text></> : 'Forwarded message'}
    </Text>
  </View>
}

function OtherAttachment({ attachment, onLongPress }: { attachment: DiaryAttachment; onLongPress: () => void }): React.ReactElement {
  switch (attachment.kind) {
    case 'audio': return <AudioRow attachment={attachment} />
    case 'voice': return <VoiceRow attachment={attachment} />
    case 'sticker': return <Sticker attachment={attachment} />
    case 'videoNote': return <VideoNote attachment={attachment} onLongPress={onLongPress} />
    default: return <FileRow attachment={attachment} onLongPress={onLongPress} />
  }
}

export interface MessageProps {
  message: LocalDiaryMessage
  /** Undefined when this is not a reply; null when the message it answered is gone. */
  replyTarget: LocalDiaryMessage | null | undefined
  highlighted: boolean
  onLongPress: (message: LocalDiaryMessage) => void
  onReply: (message: LocalDiaryMessage) => void
  onJump: (id: string) => void
  onRetry: (message: LocalDiaryMessage) => void
}

function MessageView({ message, replyTarget, highlighted, onLongPress, onReply, onJump, onRetry }: MessageProps): React.ReactElement {
  const { api, localFiles, onHashtag } = useChat()
  const visual = message.attachments.filter((item) => VISUAL_KINDS.has(item.kind))
  const others = message.attachments.filter((item) => !VISUAL_KINDS.has(item.kind))
  const hasText = message.text.trim().length > 0
  const lone = message.attachments.length === 1 && !hasText && !message.forwarded && replyTarget === undefined
    ? message.attachments[0]
    : null
  const standalone = lone && (lone.kind === 'sticker' || lone.kind === 'videoNote') ? lone : null
  const width = BUBBLE_WIDTH - (message.delivery === 'failed' ? RETRY_SPACE : 0)
  const longPress = (): void => {
    Vibration.vibrate(10)
    onLongPress(message)
  }

  const body = standalone
    ? <Pressable onLongPress={longPress} delayLongPress={280} style={{ alignItems: 'flex-end', opacity: highlighted ? 0.6 : 1 }}>
      {standalone.kind === 'sticker' ? <Sticker attachment={standalone} /> : <VideoNote attachment={standalone} onLongPress={longPress} />}
      <View style={{ marginTop: 4 }}><Meta message={message} onMedia /></View>
    </Pressable>
    : <Pressable
      onLongPress={longPress}
      delayLongPress={280}
      style={{
        width,
        backgroundColor: highlighted ? ink.flash : ink.bubble,
        borderColor: ink.bubbleEdge,
        borderWidth: 1,
        borderRadius: 18,
        overflow: 'hidden'
      }}
    >
      {message.forwarded && <Forwarded from={message.forwardedFrom} />}
      {replyTarget !== undefined && <ReplyQuote target={replyTarget} onJump={onJump} />}
      {visual.length > 0 && <View style={{ marginTop: message.forwarded || replyTarget !== undefined ? 6 : 0 }}>
        <MediaGrid messageId={message.id} attachments={visual} width={width - 2} onLongPress={longPress} />
        {!hasText && others.length === 0 && <View style={{ position: 'absolute', right: 8, bottom: 8 }}><Meta message={message} onMedia /></View>}
      </View>}
      {others.length > 0 && <View style={{ paddingHorizontal: 10, paddingTop: 8, gap: 6 }}>
        {others.map((attachment, index) => <OtherAttachment key={`${attachment.mediaId ?? 'missing'}-${index}`} attachment={attachment} onLongPress={longPress} />)}
      </View>}
      {hasText && <View style={{ paddingHorizontal: 11, paddingTop: 6, paddingBottom: 7 }}>
        <RichText text={message.text} entities={message.entities} api={api} localFiles={localFiles} onHashtag={onHashtag} trailing={metaSpace(message)} />
      </View>}
      {(hasText || others.length > 0) && <View style={{ position: 'absolute', right: 10, bottom: 6 }}><Meta message={message} onMedia={false} /></View>}
      {!hasText && others.length > 0 && <View style={{ height: 22 }} />}
    </Pressable>

  return <SwipeToReply onReply={() => onReply(message)}>
    <View style={{ paddingHorizontal: MESSAGE_GUTTER, paddingVertical: 3, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 6 }}>
      {message.delivery === 'failed' && <Pressable
        accessibilityRole="button"
        accessibilityLabel="This message did not send. Try again"
        onPress={() => onRetry(message)}
        hitSlop={8}
        style={{ marginBottom: 6 }}
      ><AlertCircle color={ink.failed} size={20} /></Pressable>}
      {body}
    </View>
  </SwipeToReply>
}

export const Message = memo(MessageView)

export function DaySeparator({ label }: { label: string }): React.ReactElement {
  return <View style={{ alignItems: 'center', paddingVertical: 10 }}>
    <View style={{ backgroundColor: ink.tile, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Text style={{ color: ink.secondary, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </View>
  </View>
}
