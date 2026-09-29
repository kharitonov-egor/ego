import React, { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useEventListener } from 'expo'
import { VideoView, useVideoPlayer } from 'expo-video'
import LottieView, { type AnimationObject } from 'lottie-react-native'
import Svg, { Circle } from 'react-native-svg'
import { Play } from 'lucide-react-native'
import type { DiaryAttachment } from '@ego/core'
import { useDiaryAudio } from '../../lib/diary/audio'
import { durationLabel } from '../../lib/diary/format'
import { mediaSource, readLottie, type MediaSource } from '../../lib/diary/media'
import { Text } from '../ui/text'
import { useChat } from './context'
import { UploadRing } from './MediaGrid'
import { ink } from './theme'

const STICKER_SIZE = 168
const NOTE_SIZE = 220

function isLottie(value: object): value is AnimationObject {
  return 'layers' in value && 'fr' in value && 'ip' in value && 'op' in value
}

function LottieSticker({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const { api, localFiles } = useChat()
  const [animation, setAnimation] = useState<AnimationObject | null>(null)
  const mediaId = attachment.mediaId
  useEffect(() => {
    if (!mediaId) return
    let active = true
    void readLottie(api, localFiles, mediaId).then((parsed) => {
      if (active && parsed && isLottie(parsed)) setAnimation(parsed)
    })
    return () => { active = false }
  }, [api, localFiles, mediaId])
  if (animation) return <LottieView source={animation} autoPlay loop style={{ width: STICKER_SIZE, height: STICKER_SIZE }} />
  if (attachment.previewId) {
    return <Image source={mediaSource(api, localFiles, attachment.previewId)} style={{ width: STICKER_SIZE, height: STICKER_SIZE }} contentFit="contain" />
  }
  return <Text style={{ fontSize: 96, lineHeight: 120 }}>{attachment.emoji ?? '🙂'}</Text>
}

/** Stickers sit on the background with no bubble, the way Telegram draws them. */
export function Sticker({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const { api, localFiles } = useChat()
  if (attachment.mimeType === 'application/json') return <LottieSticker attachment={attachment} />
  const shownId = attachment.mediaId ?? attachment.previewId
  if (!shownId) return <Text style={{ fontSize: 96, lineHeight: 120 }}>{attachment.emoji ?? '🙂'}</Text>
  const ratio = attachment.width && attachment.height ? attachment.height / attachment.width : 1
  return <Image
    source={mediaSource(api, localFiles, shownId)}
    style={{ width: STICKER_SIZE, height: Math.round(STICKER_SIZE * ratio) }}
    contentFit="contain"
    accessibilityLabel={attachment.emoji ? `${attachment.emoji} sticker` : 'Sticker'}
  />
}

function ProgressRing({ share, size }: { share: number; size: number }): React.ReactElement {
  const radius = size / 2 - 2
  const circumference = 2 * Math.PI * radius
  return <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }} pointerEvents="none">
    <Circle cx={size / 2} cy={size / 2} r={radius} stroke={ink.text} strokeWidth={3} fill="none"
      strokeDasharray={`${circumference}`} strokeDashoffset={circumference * (1 - share)} strokeLinecap="round" />
  </Svg>
}

function RoundPlayer({ source, onEnd }: { source: MediaSource; onEnd: () => void }): React.ReactElement {
  const [share, setShare] = useState(0)
  const player = useVideoPlayer({ uri: source.uri, headers: source.headers, useCaching: true }, (created) => {
    created.timeUpdateEventInterval = 0.2
    created.play()
  })
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (player.duration > 0) setShare(currentTime / player.duration)
  })
  useEventListener(player, 'playToEnd', onEnd)
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Pause or play the video message"
    onPress={() => (player.playing ? player.pause() : player.play())}
  >
    <View style={{ width: NOTE_SIZE, height: NOTE_SIZE, borderRadius: NOTE_SIZE / 2, overflow: 'hidden' }}>
      <VideoView player={player} style={{ width: NOTE_SIZE, height: NOTE_SIZE }} contentFit="cover" nativeControls={false} surfaceType="textureView" />
    </View>
    <ProgressRing share={share} size={NOTE_SIZE} />
  </Pressable>
}

/** A round video message. It plays in place, with sound, and stops any voice note playing. */
export function VideoNote({ attachment, onLongPress }: { attachment: DiaryAttachment; onLongPress?: () => void }): React.ReactElement {
  const { api, localFiles } = useChat()
  const audio = useDiaryAudio()
  const [playing, setPlaying] = useState(false)
  const mediaId = attachment.mediaId
  if (playing && mediaId) return <RoundPlayer source={mediaSource(api, localFiles, mediaId)} onEnd={() => setPlaying(false)} />
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel="Play the video message"
    disabled={!mediaId}
    onPress={() => {
      audio.stop()
      setPlaying(true)
    }}
    onLongPress={onLongPress}
    delayLongPress={280}
    style={{ width: NOTE_SIZE, height: NOTE_SIZE, borderRadius: NOTE_SIZE / 2, overflow: 'hidden', backgroundColor: ink.tile }}
  >
    {attachment.previewId && <Image source={mediaSource(api, localFiles, attachment.previewId)} style={{ width: NOTE_SIZE, height: NOTE_SIZE }} contentFit="cover" />}
    <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: ink.scrim }} className="items-center justify-center">
        <Play color={ink.text} fill={ink.text} size={22} style={{ marginLeft: 3 }} />
      </View>
    </View>
    <View pointerEvents="none" style={{ position: 'absolute', bottom: 18, alignSelf: 'center', borderRadius: 10, backgroundColor: ink.scrim, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text className="text-[12px] font-medium text-white">{mediaId ? durationLabel(attachment.durationSeconds) : 'Not in the export'}</Text>
    </View>
    <UploadRing mediaId={mediaId} />
  </Pressable>
}
