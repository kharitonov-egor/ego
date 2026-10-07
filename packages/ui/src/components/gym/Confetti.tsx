import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trophy } from 'lucide-react'
import { GYM_CATEGORY_COLORS } from '@ego/core'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { useReducedMotion } from './ui'

const PIECE_COUNT = 90
const DURATION_MS = 2800
const LABEL_MS = 2200
const COLORS = [...GYM_CATEGORY_COLORS, color.attention, color.text]

interface Piece {
  color: string
  width: number
  height: number
  round: boolean
  drift: number
  rise: number
  fall: number
  sway: number
  swayRate: number
  phase: number
  turns: number
  flips: number
}

function between(low: number, high: number): number {
  return low + Math.random() * (high - low)
}

function makePiece(width: number, height: number): Piece {
  const size = between(6, 10)
  return {
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    width: size,
    height: Math.random() < 0.3 ? size : size * between(1.4, 2),
    round: Math.random() < 0.2,
    drift: between(-1, 1) * width * 0.6,
    rise: -between(0.8, 1.5) * height,
    fall: between(0.32, 0.5) * height,
    sway: between(6, 18),
    swayRate: between(3, 6),
    phase: between(0, Math.PI * 2),
    turns: between(-3, 3),
    flips: between(2, 6)
  }
}

/**
 * Each piece leaves the burst fast, slows under air drag toward a gentle falling speed, and sways,
 * the same path the phone samples for its native driver.
 */
function draw(context: CanvasRenderingContext2D, pieces: readonly Piece[], seconds: number, originX: number, originY: number): void {
  const drag = 3
  const slowed = (1 - Math.exp(-drag * seconds)) / drag
  const progress = seconds / (DURATION_MS / 1000)
  context.globalAlpha = progress < 0.7 ? 1 : Math.max(0, 1 - (progress - 0.7) / 0.3)
  for (const piece of pieces) {
    const x = originX + piece.drift * slowed + piece.sway * Math.sin(piece.swayRate * seconds + piece.phase)
    const y = originY + piece.fall * seconds + (piece.rise - piece.fall) * slowed
    context.save()
    context.translate(x, y)
    context.rotate(piece.turns * Math.PI * 2 * progress)
    context.scale(1, Math.cos(piece.flips * Math.PI * 2 * progress))
    context.fillStyle = piece.color
    if (piece.round) {
      context.beginPath()
      context.arc(0, 0, piece.width / 2, 0, Math.PI * 2)
      context.fill()
    } else {
      context.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height)
    }
    context.restore()
  }
}

/** A burst of confetti over the window and a short "New record" label. Clicks pass straight through. */
export function Confetti({ onDone }: { onDone: () => void }): React.ReactElement {
  const reducedMotion = useReducedMotion()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [labelShown, setLabelShown] = useState(false)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const show = requestAnimationFrame(() => setLabelShown(true))
    const hide = setTimeout(() => setLabelShown(false), LABEL_MS - 400)
    let frame = 0
    let clear: ReturnType<typeof setTimeout> | undefined
    const stop = (): void => {
      cancelAnimationFrame(show)
      cancelAnimationFrame(frame)
      clearTimeout(hide)
      clearTimeout(clear)
    }
    const element = canvas.current
    const context = element?.getContext('2d')
    if (reducedMotion || !element || !context) {
      clear = setTimeout(() => done.current(), LABEL_MS)
      return stop
    }
    const ratio = window.devicePixelRatio || 1
    const width = window.innerWidth
    const height = window.innerHeight
    element.width = width * ratio
    element.height = height * ratio
    context.scale(ratio, ratio)
    const pieces = Array.from({ length: PIECE_COUNT }, () => makePiece(width, height))
    const started = performance.now()
    const step = (at: number): void => {
      const elapsed = at - started
      context.clearRect(0, 0, width, height)
      if (elapsed >= DURATION_MS) {
        done.current()
        return
      }
      draw(context, pieces, elapsed / 1000, width / 2, height * 0.4)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return stop
  }, [reducedMotion])

  return createPortal(<div className="pointer-events-none fixed inset-0 z-[70]">
    {!reducedMotion && <canvas ref={canvas} className="absolute inset-0 h-full w-full" />}
    <div aria-live="polite" className="absolute inset-x-0 top-28 flex justify-center">
      <div className={cn('flex items-center gap-2 rounded-full bg-surface-800 px-4 py-2.5 shadow-xl transition duration-200 motion-reduce:transition-none',
        labelShown ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0')}>
        <Trophy color={color.attention} size={18} />
        <span className="text-[16px] font-semibold">New record</span>
      </div>
    </div>
  </div>, document.body)
}
