import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { dateTimeLabel } from '@ego/local/diary/format'
import { Blurred, useBlur } from '../../lib/blur'
import type { ViewerItem } from '../../lib/diary/chat'
import { cn } from '../../lib/utils'
import { useChat } from './context'
import { ink } from './theme'

const MAX_ZOOM = 5
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 260

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

interface View {
  scale: number
  x: number
  y: number
}

/**
 * The wheel or a touchpad pinch zooms toward the pointer, a drag pans while zoomed, and a double
 * click toggles. A single click shows or hides the bars, as a tap does on the phone.
 */
function ZoomableImage({ full, preview, blur, onTap }: { full: string; preview: string | null; blur: string | undefined; onTap: () => void }): React.ReactElement {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const [panning, setPanning] = useState(false)
  const current = useRef(view)
  current.current = view
  const drag = useRef<{ startX: number; startY: number; fromX: number; fromY: number; moved: boolean } | null>(null)
  const lastTap = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestTap = useRef(onTap)
  latestTap.current = onTap

  const place = (scale: number, x: number, y: number): void => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const limitX = (rect.width * (scale - 1)) / 2
    const limitY = (rect.height * (scale - 1)) / 2
    setView(scale <= 1.01 ? { scale: 1, x: 0, y: 0 } : { scale, x: clamp(x, -limitX, limitX), y: clamp(y, -limitY, limitY) })
  }
  const placeRef = useRef(place)
  placeRef.current = place

  /** Keeps the point under the pointer still while the scale changes. */
  const zoomAt = (clientX: number, clientY: number, scale: number): void => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return
    const { scale: from, x, y } = current.current
    const pointX = clientX - (rect.left + rect.width / 2)
    const pointY = clientY - (rect.top + rect.height / 2)
    place(scale, pointX - (pointX - x) * (scale / from), pointY - (pointY - y) * (scale / from))
  }
  const zoomRef = useRef(zoomAt)
  zoomRef.current = zoomAt

  useEffect(() => {
    const element = box.current
    if (!element) return
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const speed = event.ctrlKey ? 0.01 : 0.0015
      zoomRef.current(event.clientX, event.clientY, clamp(current.current.scale * Math.exp(-event.deltaY * speed), 1, MAX_ZOOM))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current)
  }, [])

  const zoomed = view.scale > 1.01
  return <div
    ref={box}
    className="relative h-full w-full overflow-hidden"
    style={{ cursor: zoomed ? (panning ? 'grabbing' : 'grab') : 'zoom-in', touchAction: 'none' }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      drag.current = { startX: event.clientX, startY: event.clientY, fromX: current.current.x, fromY: current.current.y, moved: false }
      if (current.current.scale <= 1.01) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setPanning(true)
    }}
    onPointerMove={(event) => {
      const start = drag.current
      if (!start) return
      const dx = event.clientX - start.startX
      const dy = event.clientY - start.startY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) start.moved = true
      if (current.current.scale > 1.01) placeRef.current(current.current.scale, start.fromX + dx, start.fromY + dy)
    }}
    onPointerUp={(event) => {
      const start = drag.current
      drag.current = null
      setPanning(false)
      if (!start || start.moved) return
      const now = Date.now()
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        if (tapTimer.current) clearTimeout(tapTimer.current)
        lastTap.current = 0
        if (current.current.scale > 1.01) place(1, 0, 0)
        else zoomAt(event.clientX, event.clientY, DOUBLE_TAP_ZOOM)
        return
      }
      lastTap.current = now
      tapTimer.current = setTimeout(() => latestTap.current(), DOUBLE_TAP_MS)
    }}
    onPointerCancel={() => {
      drag.current = null
      setPanning(false)
    }}
  >
    <div
      className="h-full w-full transition-transform duration-150 ease-out motion-reduce:transition-none"
      style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transitionDuration: panning ? '0ms' : undefined }}
    >
      {preview && !loaded && <img src={preview} alt="" draggable={false} className={cn('absolute inset-0 h-full w-full object-contain', blur)} />}
      <img src={full} alt="" draggable={false} onLoad={() => setLoaded(true)} className={cn('relative h-full w-full object-contain', blur)} />
    </div>
  </div>
}

function Page({ item, onTap }: { item: ViewerItem; onTap: () => void }): React.ReactElement {
  const { source } = useChat()
  const blur = useBlur().blurred ? 'ego-blurred-media' : undefined
  const { attachment } = item
  const preview = attachment.previewId ? source(attachment.previewId) : null
  if (!attachment.mediaId) {
    return <button type="button" onClick={onTap} className="flex h-full w-full flex-col items-center justify-center">
      {preview && <img src={preview} alt="" draggable={false} className={cn('h-[60%] w-full object-contain', blur)} />}
      <span className="mt-4 text-[15px] text-muted-foreground">Not in the Telegram export</span>
    </button>
  }
  const full = source(attachment.mediaId)
  if (attachment.kind === 'photo') return <ZoomableImage full={full} preview={preview} blur={blur} onTap={onTap} />
  if (attachment.kind === 'animation') {
    return <button type="button" aria-label="GIF" onClick={onTap} className="flex h-full w-full items-center justify-center">
      <video src={full} poster={preview ?? undefined} autoPlay loop muted playsInline className={cn('h-full w-full object-contain', blur)} />
    </button>
  }
  return <div className="flex h-full w-full items-center justify-center px-16 py-20">
    <video src={full} poster={preview ?? undefined} autoPlay controls playsInline className={cn('max-h-full max-w-full', blur)} />
  </div>
}

function Arrow({ side, onPress }: { side: 'left' | 'right'; onPress: () => void }): React.ReactElement {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return <button
    type="button"
    aria-label={side === 'left' ? 'Previous' : 'Next'}
    title={side === 'left' ? 'Previous' : 'Next'}
    onClick={onPress}
    className={`absolute top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-white/20 ${side === 'left' ? 'left-4' : 'right-4'}`}
    style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
  ><Icon color={ink.text} size={28} /></button>
}

/**
 * Every photo, video, and GIF in the diary over the whole window, one at a time, starting from
 * the one clicked. The arrow buttons and keys step through them; Escape closes. Key it by `start`,
 * so each opening begins on the item clicked.
 */
export function MediaViewer({ items, start, onClose }: {
  items: readonly ViewerItem[]
  start: number | null
  onClose: () => void
}): React.ReactElement | null {
  const [index, setIndex] = useState(start ?? 0)
  const [chrome, setChrome] = useState(true)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const count = items.length
  const at = Math.max(0, Math.min(index, count - 1))

  useEffect(() => {
    if (start === null) return
    const step = (by: number): void => setIndex((value) => Math.max(0, Math.min(count - 1, Math.min(value, count - 1) + by)))
    const keys = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current()
      else if (event.key === 'ArrowLeft') step(-1)
      else if (event.key === 'ArrowRight') step(1)
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('keydown', keys, true)
    return () => document.removeEventListener('keydown', keys, true)
  }, [count, start])

  if (start === null) return null
  const current = items[at]
  return createPortal(<div role="dialog" aria-modal="true" aria-label="Photos and videos" className="fixed inset-0 z-50 select-none bg-black">
    {current && <Page key={current.key} item={current} onTap={() => setChrome((shown) => !shown)} />}
    {(chrome || !current) && <div className="absolute inset-x-0 top-0 flex items-center px-2 pb-2.5 pt-2" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <button type="button" aria-label="Close" title="Close" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10">
        <X color={ink.text} size={24} />
      </button>
      {current && <div className="ml-1 flex-1">
        <p className="text-[15px] font-semibold">{dateTimeLabel(current.sentAt)}</p>
        <p className="tabular text-[13px] text-surface-300">{at + 1} of {count}</p>
      </div>}
    </div>}
    {chrome && current && <>
      {current.caption.trim().length > 0 && <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-3" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <Blurred><p className="mx-auto line-clamp-5 max-w-3xl whitespace-pre-wrap text-[15px] leading-5">{current.caption}</p></Blurred>
      </div>}
      {at > 0 && <Arrow side="left" onPress={() => setIndex(at - 1)} />}
      {at < count - 1 && <Arrow side="right" onPress={() => setIndex(at + 1)} />}
    </>}
  </div>, document.body)
}
