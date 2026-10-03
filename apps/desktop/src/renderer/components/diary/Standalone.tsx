import React, { useRef, useState } from 'react'
import { Play } from 'lucide-react'
import type { DiaryAttachment } from '@ego/core'
import { durationLabel } from '@ego/local/diary/format'
import { useDiaryAudio } from '../../lib/diary/audio'
import { useChat } from './context'
import { UploadRing } from './MediaGrid'
import { ink } from './theme'

const STICKER_SIZE = 168
const NOTE_SIZE = 220

function Emoji({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  return <span role="img" aria-label="Sticker" style={{ fontSize: 96, lineHeight: '120px' }}>{attachment.emoji ?? '🙂'}</span>
}

/**
 * Stickers sit on the background with no bubble, the way Telegram draws them. An animated
 * (Lottie) sticker shows its still preview here, since the desktop has no Lottie player.
 */
export function Sticker({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const { source } = useChat()
  const label = attachment.emoji ? `${attachment.emoji} sticker` : 'Sticker'
  const lottie = attachment.mimeType === 'application/json'
  const shownId = lottie ? attachment.previewId : attachment.mediaId ?? attachment.previewId
  if (!shownId) return <Emoji attachment={attachment} />
  const ratio = attachment.width && attachment.height ? attachment.height / attachment.width : 1
  const size = { width: STICKER_SIZE, height: Math.round(STICKER_SIZE * ratio) }
  if (!lottie && attachment.mimeType.startsWith('video/') && shownId === attachment.mediaId) {
    return <video src={source(shownId)} autoPlay loop muted playsInline aria-label={label} draggable={false} style={size} className="object-contain" />
  }
  return <img src={source(shownId)} alt={label} draggable={false} style={size} className="object-contain" />
}

function ProgressRing({ share, size }: { share: number; size: number }): React.ReactElement {
  const radius = size / 2 - 2
  const circumference = 2 * Math.PI * radius
  return <svg width={size} height={size} className="pointer-events-none absolute left-0 top-0 -rotate-90">
    <circle cx={size / 2} cy={size / 2} r={radius} stroke={ink.text} strokeWidth={3} fill="none"
      strokeDasharray={`${circumference}`} strokeDashoffset={circumference * (1 - share)} strokeLinecap="round" />
  </svg>
}

function RoundPlayer({ source, onEnd }: { source: string; onEnd: () => void }): React.ReactElement {
  const video = useRef<HTMLVideoElement>(null)
  const [share, setShare] = useState(0)
  return <button
    type="button"
    aria-label="Pause or play the video message"
    onClick={() => {
      const player = video.current
      if (!player) return
      if (player.paused) void player.play().catch(() => undefined)
      else player.pause()
    }}
    className="relative block"
    style={{ width: NOTE_SIZE, height: NOTE_SIZE }}
  >
    <video
      ref={video}
      src={source}
      autoPlay
      playsInline
      draggable={false}
      onTimeUpdate={(event) => {
        const player = event.currentTarget
        if (player.duration > 0 && Number.isFinite(player.duration)) setShare(player.currentTime / player.duration)
      }}
      onEnded={onEnd}
      style={{ width: NOTE_SIZE, height: NOTE_SIZE, borderRadius: NOTE_SIZE / 2 }}
      className="object-cover"
    />
    <ProgressRing share={share} size={NOTE_SIZE} />
  </button>
}

/** A round video message. It plays in place, with sound, and stops any voice note playing. */
export function VideoNote({ attachment }: { attachment: DiaryAttachment }): React.ReactElement {
  const { source } = useChat()
  const audio = useDiaryAudio()
  const [playing, setPlaying] = useState(false)
  const mediaId = attachment.mediaId
  if (playing && mediaId) return <RoundPlayer source={source(mediaId)} onEnd={() => setPlaying(false)} />
  return <button
    type="button"
    aria-label="Play the video message"
    disabled={!mediaId}
    onClick={() => {
      audio.stop()
      setPlaying(true)
    }}
    style={{ width: NOTE_SIZE, height: NOTE_SIZE, borderRadius: NOTE_SIZE / 2, backgroundColor: ink.tile }}
    className="relative block overflow-hidden"
  >
    {attachment.previewId && <img src={source(attachment.previewId)} alt="" draggable={false} style={{ width: NOTE_SIZE, height: NOTE_SIZE }} className="object-cover" />}
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: ink.scrim }} className="flex items-center justify-center">
        <Play color={ink.text} fill={ink.text} size={22} style={{ marginLeft: 3 }} />
      </span>
    </span>
    <span className="pointer-events-none absolute bottom-[18px] left-1/2 -translate-x-1/2 rounded-[10px] px-2 py-0.5 text-[12px] font-medium text-white" style={{ backgroundColor: ink.scrim }}>
      {mediaId ? durationLabel(attachment.durationSeconds) : 'Not in the export'}
    </span>
    <UploadRing mediaId={mediaId} />
  </button>
}
