import React, { useContext } from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { VideoView, useVideoPlayer } from 'expo-video'
import Svg, { Circle } from 'react-native-svg'
import { Film, ImageOff, Play } from 'lucide-react-native'
import type { DiaryAttachment } from '@ego/core'
import { mediaSource } from '../../lib/diary/media'
import { useUploadProgress } from '../../lib/diary/progress'
import { durationLabel } from '@ego/local/diary/format'
import { Text } from '../ui/text'
import { VisibleContext, useChat } from './context'
import { MEDIA_MAX_HEIGHT, MEDIA_MIN_HEIGHT, ink } from './theme'

export const VISUAL_KINDS: ReadonlySet<DiaryAttachment['kind']> = new Set(['photo', 'video', 'animation'])

/** Telegram's album shapes: a lone photo keeps its proportions, a group fills rows of two or three. */
const ROWS: Record<number, number[]> = {
  2: [2], 3: [1, 2], 4: [2, 2], 5: [2, 3], 6: [3, 3], 7: [2, 2, 3], 8: [2, 3, 3], 9: [3, 3, 3], 10: [2, 2, 3, 3]
}
const GAP = 2

function rowsFor(count: number): number[] {
  if (ROWS[count]) return ROWS[count]
  const rows: number[] = []
  for (let left = count; left > 0; left -= 3) rows.push(Math.min(3, left))
  return rows
}

function singleHeight(attachment: DiaryAttachment, width: number): number {
  if (!attachment.width || !attachment.height) return Math.round(width * 0.75)
  return Math.round(Math.max(MEDIA_MIN_HEIGHT, Math.min(MEDIA_MAX_HEIGHT, width * attachment.height / attachment.width)))
}

export function UploadRing({ mediaId, size = 44 }: { mediaId: string | null; size?: number }): React.ReactElement | null {
  const progress = useUploadProgress(mediaId)
  if (progress === null) return null
  const radius = size / 2 - 3
  const circumference = 2 * Math.PI * radius
  return <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ink.scrim }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.25)" strokeWidth={3} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={ink.text} strokeWidth={3} fill="none"
          strokeDasharray={`${circumference}`} strokeDashoffset={circumference * (1 - progress)} strokeLinecap="round" />
      </Svg>
    </View>
  </View>
}

function Pill({ children, style }: { children: string; style?: StyleProp<ViewStyle> }): React.ReactElement {
  return <View pointerEvents="none" style={[{ position: 'absolute', borderRadius: 10, backgroundColor: ink.scrim, paddingHorizontal: 7, paddingVertical: 2 }, style]}>
    <Text className="text-[12px] font-medium text-white">{children}</Text>
  </View>
}

export function MissingTile({ attachment, width, height }: { attachment: DiaryAttachment; width: number; height: number }): React.ReactElement {
  const Icon = attachment.kind === 'photo' ? ImageOff : Film
  return <View style={{ width, height, backgroundColor: ink.tile }} className="items-center justify-center px-4">
    <Icon color={ink.faint} size={26} />
    <Text className="mt-2 text-center text-[13px] leading-4 text-muted-foreground">Not in the Telegram export</Text>
    {attachment.fileName && <Text numberOfLines={1} className="mt-1 text-center text-[12px] text-surface-500">{attachment.fileName}</Text>}
  </View>
}

function LoopingVideo({ mediaId, width, height }: { mediaId: string; width: number; height: number }): React.ReactElement {
  const { api, localFiles } = useChat()
  const source = mediaSource(api, localFiles, mediaId)
  const player = useVideoPlayer({ uri: source.uri, headers: source.headers, useCaching: true }, (created) => {
    created.loop = true
    created.muted = true
    created.play()
  })
  return <VideoView player={player} style={{ width, height }} contentFit="cover" nativeControls={false} surfaceType="textureView" />
}

function Tile({ messageId, attachment, width, height, onLongPress }: {
  messageId: string
  attachment: DiaryAttachment
  width: number
  height: number
  onLongPress?: () => void
}): React.ReactElement {
  const { api, localFiles, openViewer } = useChat()
  const visible = useContext(VisibleContext).has(messageId)
  const shownId = attachment.previewId ?? (attachment.kind === 'photo' ? attachment.mediaId : null)
  if (!attachment.mediaId && !shownId) return <MissingTile attachment={attachment} width={width} height={height} />
  const poster = shownId ? mediaSource(api, localFiles, shownId) : null
  const loops = attachment.kind === 'animation' && attachment.mediaId !== null && visible
  return <Pressable
    accessibilityRole="imagebutton"
    accessibilityLabel={attachment.kind === 'photo' ? 'Photo' : attachment.kind === 'animation' ? 'GIF' : 'Video'}
    onPress={() => attachment.mediaId && openViewer(attachment.mediaId)}
    onLongPress={onLongPress}
    delayLongPress={280}
    style={{ width, height, backgroundColor: ink.tile }}
  >
    {loops && attachment.mediaId
      ? <LoopingVideo mediaId={attachment.mediaId} width={width} height={height} />
      : poster
        ? <Image source={poster} style={{ width, height }} contentFit="cover" transition={120} recyclingKey={shownId} />
        : <View style={{ width, height }} className="items-center justify-center"><Film color={ink.faint} size={28} /></View>}
    {attachment.kind === 'video' && <>
      <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: ink.scrim }} className="items-center justify-center">
          <Play color={ink.text} fill={ink.text} size={20} style={{ marginLeft: 3 }} />
        </View>
      </View>
      <Pill style={{ left: 8, top: 8 }}>{durationLabel(attachment.durationSeconds)}</Pill>
    </>}
    {attachment.kind === 'animation' && !loops && <Pill style={{ left: 8, top: 8 }}>GIF</Pill>}
    {!attachment.mediaId && <Pill style={{ left: 8, bottom: 8 }}>Not in the export</Pill>}
    <UploadRing mediaId={attachment.mediaId} />
  </Pressable>
}

/** Photos, videos, and GIFs of one message, laid out edge to edge at the top of the bubble. */
export function MediaGrid({ messageId, attachments, width, onLongPress }: {
  messageId: string
  attachments: readonly DiaryAttachment[]
  width: number
  onLongPress?: () => void
}): React.ReactElement {
  if (attachments.length === 1) {
    const only = attachments[0]
    return <Tile messageId={messageId} attachment={only} width={width} height={singleHeight(only, width)} onLongPress={onLongPress} />
  }
  const rows = rowsFor(attachments.length)
  let taken = 0
  return <View style={{ gap: GAP }}>
    {rows.map((count, row) => {
      const items = attachments.slice(taken, taken + count)
      taken += count
      const itemWidth = (width - GAP * (count - 1)) / count
      const height = count === 1 ? Math.round(width * 0.62) : Math.round(itemWidth * (count === 2 ? 1 : 1.05))
      return <View key={row} style={{ flexDirection: 'row', gap: GAP }}>
        {items.map((attachment, index) => <Tile
          key={`${attachment.mediaId ?? 'missing'}-${index}`}
          messageId={messageId}
          attachment={attachment}
          width={itemWidth}
          height={height}
          onLongPress={onLongPress}
        />)}
      </View>
    })}
  </View>
}
