import React, { useState } from 'react'
import { ActivityIndicator, Pressable, View, type GestureResponderEvent } from 'react-native'
import { Image } from 'expo-image'
import { FileText, Music, Pause, Play } from 'lucide-react-native'
import type { DiaryAttachment } from '@ego/core'
import { useDiaryAudio } from '../../lib/diary/audio'
import { durationLabel, extensionLabel, sizeLabel } from '@ego/local/diary/format'
import { fileForOpening, mediaSource, openWithAnotherApp } from '../../lib/diary/media'
import { Text } from '../ui/text'
import { useChat } from './context'
import { UploadRing } from './MediaGrid'
import { ink } from './theme'

function PlayButton({ playing, disabled, onPress, label }: {
  playing: boolean
  disabled: boolean
  onPress: () => void
  label: string
}): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={playing ? `Pause ${label}` : `Play ${label}`}
    disabled={disabled}
    onPress={onPress}
    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: disabled ? ink.tile : ink.text }}
    className="items-center justify-center"
  >
    {playing
      ? <Pause color={ink.screen} fill={ink.screen} size={18} />
      : <Play color={disabled ? ink.faint : ink.screen} fill={disabled ? ink.faint : ink.screen} size={18} style={{ marginLeft: 2 }} />}
  </Pressable>
}

function usePlayback(attachment: DiaryAttachment): {
  current: boolean
  playing: boolean
  position: number
  duration: number
  toggle: () => void
  seekAt: (event: GestureResponderEvent, width: number) => void
} {
  const { api, localFiles } = useChat()
  const audio = useDiaryAudio()
  const mediaId = attachment.mediaId
  const current = mediaId !== null && audio.currentId === mediaId
  const duration = current && audio.duration > 0 ? audio.duration : attachment.durationSeconds ?? 0
  return {
    current,
    playing: current && audio.playing,
    position: current ? audio.position : 0,
    duration,
    toggle: () => {
      if (mediaId) audio.toggle(mediaId, mediaSource(api, localFiles, mediaId))
    },
    seekAt: (event, width) => {
      if (mediaId && width > 0) audio.seek(mediaId, event.nativeEvent.locationX / width)
    }
  }
}

export function AudioRow({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const playback = usePlayback(attachment)
  const [barWidth, setBarWidth] = useState(0)
  const title = [attachment.performer, attachment.title].filter(Boolean).join(' - ') || attachment.fileName || 'Audio'
  const missing = attachment.mediaId === null
  const detail = missing
    ? 'Not in the Telegram export'
    : playback.current
      ? `${durationLabel(playback.position)} / ${durationLabel(playback.duration)}`
      : [durationLabel(playback.duration), sizeLabel(attachment.size)].filter(Boolean).join(' · ')
  return <View className="flex-row items-center gap-3 py-1">
    <View>
      <PlayButton playing={playback.playing} disabled={missing} onPress={playback.toggle} label={title} />
      <UploadRing mediaId={attachment.mediaId} size={44} />
    </View>
    <View className="flex-1">
      <View className="flex-row items-center gap-1.5">
        <Music color={ink.meta} size={13} />
        <Text numberOfLines={1} className="flex-1 text-[15px] font-semibold">{title}</Text>
      </View>
      {playback.current && <Pressable
        accessibilityLabel="Seek"
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
        onPress={(event) => playback.seekAt(event, barWidth)}
        hitSlop={8}
        className="my-1.5 h-1 overflow-hidden rounded-full"
        style={{ backgroundColor: ink.line }}
      >
        <View style={{ width: `${Math.min(100, (playback.position / Math.max(playback.duration, 1)) * 100)}%`, height: 4, backgroundColor: ink.text }} />
      </Pressable>}
      <Text className="text-[13px] text-muted-foreground">{detail}</Text>
    </View>
  </View>
}

export function VoiceRow({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const playback = usePlayback(attachment)
  const [width, setWidth] = useState(0)
  const bars = attachment.waveform && attachment.waveform.length > 0 ? attachment.waveform : Array.from({ length: 40 }, () => 12)
  const played = playback.current ? playback.position / Math.max(playback.duration, 0.1) : 0
  return <View className="flex-row items-center gap-3 py-1">
    <View>
      <PlayButton playing={playback.playing} disabled={attachment.mediaId === null} onPress={playback.toggle} label="voice message" />
      <UploadRing mediaId={attachment.mediaId} size={44} />
    </View>
    <View className="flex-1">
      <Pressable
        accessibilityLabel="Seek"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => playback.seekAt(event, width)}
        className="h-7 flex-row items-center"
        style={{ gap: 2 }}
      >
        {bars.map((bar, index) => <View key={index} style={{
          flex: 1,
          maxWidth: 3,
          height: Math.max(3, Math.round(bar / 100 * 26)),
          borderRadius: 2,
          backgroundColor: index / bars.length < played ? ink.text : ink.faint
        }} />)}
      </Pressable>
      <Text className="mt-0.5 text-[13px] text-muted-foreground">
        {playback.current ? durationLabel(playback.position) : durationLabel(playback.duration)}
      </Text>
    </View>
  </View>
}

export function FileRow({ attachment, onLongPress }: { attachment: DiaryAttachment; onLongPress?: () => void }): React.ReactElement {
  const { api, localFiles } = useChat()
  const [progress, setProgress] = useState<number | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const missing = attachment.mediaId === null
  const open = async (): Promise<void> => {
    if (missing || progress !== null) return
    setProblem(null)
    setProgress(0)
    try {
      const file = await fileForOpening(api, localFiles, attachment, setProgress)
      setProgress(null)
      await openWithAnotherApp(file, attachment.mimeType)
    } catch {
      setProgress(null)
      setProblem('No app on this phone opened it')
    }
  }
  const detail = missing
    ? 'Not in the Telegram export'
    : problem ?? [sizeLabel(attachment.size), extensionLabel(attachment.fileName, attachment.mimeType)].filter(Boolean).join(' · ')
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`Open ${attachment.fileName ?? 'file'}`}
    onPress={() => void open()}
    onLongPress={onLongPress}
    delayLongPress={280}
    className="flex-row items-center gap-3 py-1"
  >
    <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: ink.tile, overflow: 'hidden' }} className="items-center justify-center">
      {attachment.previewId
        ? <Image source={mediaSource(api, localFiles, attachment.previewId)} style={{ width: 48, height: 48 }} contentFit="cover" />
        : <FileText color={ink.secondary} size={22} />}
      {progress !== null && <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: ink.scrim }}>
        <ActivityIndicator color={ink.text} size="small" />
      </View>}
      <UploadRing mediaId={attachment.mediaId} size={40} />
    </View>
    <View className="flex-1">
      <Text numberOfLines={2} className="text-[15px] font-semibold">{attachment.fileName ?? 'File'}</Text>
      <Text className={`text-[13px] ${problem ? 'text-rose-300' : 'text-muted-foreground'}`}>
        {progress !== null && progress > 0 ? `Downloading ${Math.round(progress * 100)}%` : detail}
      </Text>
    </View>
  </Pressable>
}
