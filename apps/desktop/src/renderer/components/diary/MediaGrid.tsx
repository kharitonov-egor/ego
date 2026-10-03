import React, { useEffect, useRef, useState } from 'react'
import { Film, ImageOff, Play } from 'lucide-react'
import type { DiaryAttachment } from '@ego/core'
import { durationLabel } from '@ego/local/diary/format'
import { useUploadProgress } from '../../lib/diary/progress'
import { cn } from '../../lib/utils'
import { useChat } from './context'
import { MEDIA_MAX_HEIGHT, MEDIA_MIN_HEIGHT, ink } from './theme'

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

/** True while at least 40% of the element is on screen, so only the GIFs in view loop. */
export function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.4 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, visible]
}

export function UploadRing({ mediaId, size = 44 }: { mediaId: string | null; size?: number }): React.ReactElement | null {
  const progress = useUploadProgress(mediaId)
  if (progress === null) return null
  const radius = size / 2 - 3
  const circumference = 2 * Math.PI * radius
  return <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
    <div style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ink.scrim }}>
      <svg width={size} height={size} className="-rotate-90" role="progressbar" aria-label="Uploading" aria-valuenow={Math.round(progress * 100)}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.25)" strokeWidth={3} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={ink.text} strokeWidth={3} fill="none"
          strokeDasharray={`${circumference}`} strokeDashoffset={circumference * (1 - progress)} strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none" />
      </svg>
    </div>
  </div>
}

function Pill({ children, className }: { children: string; className: string }): React.ReactElement {
  return <span className={cn('pointer-events-none absolute rounded-[10px] px-[7px] py-0.5 text-[12px] font-medium text-white', className)} style={{ backgroundColor: ink.scrim }}>
    {children}
  </span>
}

export function MissingTile({ attachment, width, height }: { attachment: DiaryAttachment; width: number; height: number }): React.ReactElement {
  const Icon = attachment.kind === 'photo' ? ImageOff : Film
  return <div style={{ width, height, backgroundColor: ink.tile }} className="flex shrink-0 flex-col items-center justify-center px-4">
    <Icon color={ink.faint} size={26} />
    <span className="mt-2 text-center text-[13px] leading-4 text-muted-foreground">Not in the Telegram export</span>
    {attachment.fileName && <span className="mt-1 max-w-full truncate text-center text-[12px] text-surface-500">{attachment.fileName}</span>}
  </div>
}

function LoopingVideo({ src, width, height }: { src: string; width: number; height: number }): React.ReactElement {
  return <video src={src} autoPlay loop muted playsInline draggable={false} style={{ width, height }} className="object-cover" />
}

function Tile({ attachment, width, height }: {
  attachment: DiaryAttachment
  width: number
  height: number
}): React.ReactElement {
  const { source, openViewer } = useChat()
  const [ref, visible] = useInView<HTMLButtonElement>()
  const shownId = attachment.previewId ?? (attachment.kind === 'photo' ? attachment.mediaId : null)
  if (!attachment.mediaId && !shownId) return <MissingTile attachment={attachment} width={width} height={height} />
  const loops = attachment.kind === 'animation' && attachment.mediaId !== null && visible
  return <button
    ref={ref}
    type="button"
    aria-label={attachment.kind === 'photo' ? 'Photo' : attachment.kind === 'animation' ? 'GIF' : 'Video'}
    onClick={() => attachment.mediaId && openViewer(attachment.mediaId)}
    style={{ width, height, backgroundColor: ink.tile }}
    className="relative block shrink-0 cursor-zoom-in overflow-hidden"
  >
    {loops && attachment.mediaId
      ? <LoopingVideo src={source(attachment.mediaId)} width={width} height={height} />
      : shownId
        ? <img src={source(shownId)} alt="" draggable={false} loading="lazy" style={{ width, height }} className="object-cover" />
        : <span style={{ width, height }} className="flex items-center justify-center"><Film color={ink.faint} size={28} /></span>}
    {attachment.kind === 'video' && <>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: ink.scrim }} className="flex items-center justify-center">
          <Play color={ink.text} fill={ink.text} size={20} style={{ marginLeft: 3 }} />
        </span>
      </span>
      <Pill className="left-2 top-2">{durationLabel(attachment.durationSeconds)}</Pill>
    </>}
    {attachment.kind === 'animation' && !loops && <Pill className="left-2 top-2">GIF</Pill>}
    {!attachment.mediaId && <Pill className="bottom-2 left-2">Not in the export</Pill>}
    <UploadRing mediaId={attachment.mediaId} />
  </button>
}

/** Photos, videos, and GIFs of one message, laid out edge to edge at the top of the bubble. */
export function MediaGrid({ attachments, width }: {
  attachments: readonly DiaryAttachment[]
  width: number
}): React.ReactElement {
  if (attachments.length === 1) {
    const only = attachments[0]
    return <Tile attachment={only} width={width} height={singleHeight(only, width)} />
  }
  const rows = rowsFor(attachments.length)
  let taken = 0
  return <div className="flex flex-col" style={{ gap: GAP }}>
    {rows.map((count, row) => {
      const items = attachments.slice(taken, taken + count)
      taken += count
      const itemWidth = (width - GAP * (count - 1)) / count
      const height = count === 1 ? Math.round(width * 0.62) : Math.round(itemWidth * (count === 2 ? 1 : 1.05))
      return <div key={row} className="flex" style={{ gap: GAP }}>
        {items.map((attachment, index) => <Tile
          key={`${attachment.mediaId ?? 'missing'}-${index}`}
          attachment={attachment}
          width={itemWidth}
          height={height}
        />)}
      </div>
    })}
  </div>
}
