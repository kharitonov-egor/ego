import React, { useState } from 'react'
import { FileText, Music, Pause, Play } from 'lucide-react'
import type { DiaryAttachment } from '@ego/core'
import { durationLabel, extensionLabel, sizeLabel } from '@ego/local/diary/format'
import { Blurred, useBlur } from '../../lib/blur'
import { useDiaryAudio } from '../../lib/diary/audio'
import { openWithAnotherApp } from '../../lib/diary/media'
import { cn } from '../../lib/utils'
import { Spinner } from '../ui/spinner'
import { useChat } from './context'
import { UploadRing } from './MediaGrid'
import { ink } from './theme'

function PlayButton({ playing, disabled, onPress, label }: {
  playing: boolean
  disabled: boolean
  onPress: () => void
  label: string
}): React.ReactElement {
  return <button
    type="button"
    aria-label={playing ? `Pause ${label}` : `Play ${label}`}
    disabled={disabled}
    onClick={onPress}
    style={{ backgroundColor: disabled ? ink.tile : ink.text }}
    className="flex h-11 w-11 items-center justify-center rounded-full transition-opacity hover:opacity-90"
  >
    {playing
      ? <Pause color={ink.screen} fill={ink.screen} size={18} />
      : <Play color={disabled ? ink.faint : ink.screen} fill={disabled ? ink.faint : ink.screen} size={18} style={{ marginLeft: 2 }} />}
  </button>
}

function usePlayback(attachment: DiaryAttachment): {
  current: boolean
  playing: boolean
  position: number
  duration: number
  toggle: () => void
  seekAt: (event: React.MouseEvent<HTMLElement>) => void
} {
  const { source } = useChat()
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
      if (mediaId) audio.toggle(mediaId, source(mediaId))
    },
    seekAt: (event) => {
      const box = event.currentTarget.getBoundingClientRect()
      if (mediaId && box.width > 0) audio.seek(mediaId, (event.clientX - box.left) / box.width, attachment.durationSeconds ?? 0)
    }
  }
}

export function AudioRow({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const playback = usePlayback(attachment)
  const title = [attachment.performer, attachment.title].filter(Boolean).join(' - ') || attachment.fileName || 'Audio'
  const missing = attachment.mediaId === null
  const detail = missing
    ? 'Not in the Telegram export'
    : playback.current
      ? `${durationLabel(playback.position)} / ${durationLabel(playback.duration)}`
      : [durationLabel(playback.duration), sizeLabel(attachment.size)].filter(Boolean).join(' · ')
  return <div className="flex items-center gap-3 py-1">
    <div className="relative">
      <PlayButton playing={playback.playing} disabled={missing} onPress={playback.toggle} label={title} />
      <UploadRing mediaId={attachment.mediaId} size={44} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Music color={ink.meta} size={13} className="shrink-0" />
        <Blurred><span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</span></Blurred>
      </div>
      {playback.current && <button
        type="button"
        aria-label="Seek"
        onClick={playback.seekAt}
        className="block w-full cursor-pointer py-1.5"
      >
        <span className="block h-1 overflow-hidden rounded-full" style={{ backgroundColor: ink.line }}>
          <span className="block h-1" style={{ width: `${Math.min(100, (playback.position / Math.max(playback.duration, 1)) * 100)}%`, backgroundColor: ink.text }} />
        </span>
      </button>}
      <span className="tabular block text-[13px] text-muted-foreground">{detail}</span>
    </div>
  </div>
}

export function VoiceRow({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const playback = usePlayback(attachment)
  const bars = attachment.waveform && attachment.waveform.length > 0 ? attachment.waveform : Array.from({ length: 40 }, () => 12)
  const played = playback.current ? playback.position / Math.max(playback.duration, 0.1) : 0
  return <div className="flex items-center gap-3 py-1">
    <div className="relative">
      <PlayButton playing={playback.playing} disabled={attachment.mediaId === null} onPress={playback.toggle} label="voice message" />
      <UploadRing mediaId={attachment.mediaId} size={44} />
    </div>
    <div className="min-w-0 flex-1">
      <button
        type="button"
        aria-label="Seek"
        onClick={playback.seekAt}
        className="flex h-7 w-full cursor-pointer items-center"
        style={{ gap: 2 }}
      >
        {bars.map((bar, index) => <span key={index} className="block flex-1 rounded-sm" style={{
          maxWidth: 3,
          height: Math.max(3, Math.round(bar / 100 * 26)),
          backgroundColor: index / bars.length < played ? ink.text : ink.faint
        }} />)}
      </button>
      <span className="tabular mt-0.5 block text-[13px] text-muted-foreground">
        {playback.current ? durationLabel(playback.position) : durationLabel(playback.duration)}
      </span>
    </div>
  </div>
}

export function FileRow({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const { source } = useChat()
  const { blurred } = useBlur()
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const missing = attachment.mediaId === null
  const open = async (): Promise<void> => {
    if (missing || opening) return
    setProblem(null)
    setOpening(true)
    try {
      if (await openWithAnotherApp(attachment)) setProblem('No app on this computer opened it')
    } catch {
      setProblem('No app on this computer opened it')
    } finally {
      setOpening(false)
    }
  }
  const detail = missing
    ? 'Not in the Telegram export'
    : problem ?? [sizeLabel(attachment.size), extensionLabel(attachment.fileName, attachment.mimeType)].filter(Boolean).join(' · ')
  return <button
    type="button"
    aria-label={`Open ${attachment.fileName ?? 'file'}`}
    onClick={() => void open()}
    className="flex w-full items-center gap-3 rounded-xl py-1 text-left"
  >
    <span style={{ backgroundColor: ink.tile }} className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl">
      {attachment.previewId
        ? <img src={source(attachment.previewId)} alt="" draggable={false} className={cn('h-12 w-12 object-cover', blurred && 'ego-blurred-media')} />
        : <FileText color={ink.secondary} size={22} />}
      {opening && <span className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: ink.scrim }}>
        <Spinner size={18} />
      </span>}
      <UploadRing mediaId={attachment.mediaId} size={40} />
    </span>
    <span className="min-w-0 flex-1">
      <Blurred><span className="line-clamp-2 break-words text-[15px] font-semibold">{attachment.fileName ?? 'File'}</span></Blurred>
      <span className={cn('block text-[13px]', problem ? 'text-rose-300' : 'text-muted-foreground')}>{detail}</span>
    </span>
  </button>
}
