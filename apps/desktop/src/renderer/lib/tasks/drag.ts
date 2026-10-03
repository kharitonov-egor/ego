import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'

/** A press turns into a drag once the pointer has moved this far, so a plain click still opens. */
export const DRAG_THRESHOLD = 5

/**
 * Where a dragged item lands among items of `heights`, laid out from the top with `gap` between
 * them and without the dragged item: before the first one whose middle is below `offset`. The
 * layout ignores the drop gap on screen, so the answer does not flip as the gap moves.
 */
export function dropIndex(offset: number, heights: readonly number[], gap: number): number {
  let top = 0
  for (let index = 0; index < heights.length; index += 1) {
    if (offset < top + heights[index] / 2) return index
    top += heights[index] + gap
  }
  return heights.length
}

/** The column under `offset`, measured from the left edge of the first column. */
export function columnAt(offset: number, step: number, gap: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor((offset + gap / 2) / step)))
}

/**
 * How far to scroll in one frame while the pointer rests within `band` of an edge: faster the
 * closer it gets, negative toward the start, and nothing away from the edges.
 */
export function edgeScroll(position: number, start: number, end: number, band: number, fastest: number): number {
  if (position < start + band) return -Math.ceil(fastest * Math.min(1, (start + band - position) / band))
  if (position > end - band) return Math.ceil(fastest * Math.min(1, (position - end + band) / band))
  return 0
}

export interface PointerDragHandlers<T> {
  /** The press moved far enough. `x` and `y` are where the press began. */
  onLift: (item: T, x: number, y: number, element: HTMLElement) => void
  onMove: (x: number, y: number) => void
  /** Called on every animation frame while lifted, for scrolling at the edges. */
  onFrame: (x: number, y: number) => void
  /** `commit` is false when Escape or a lost pointer cancels the drag. */
  onDrop: (commit: boolean) => void
  /** The press ended without moving. */
  onClick: (item: T) => void
}

/**
 * Mouse drag and drop for the board and the board list: press an item and move to lift it, let go
 * to drop it, Escape to put it back. Returns the pointer-down handler for each item.
 */
export function usePointerDrag<T>(handlers: PointerDragHandlers<T>): (event: React.PointerEvent<HTMLElement>, item: T) => void {
  const latest = useRef(handlers)
  latest.current = handlers
  const press = useRef<{ item: T; x: number; y: number; element: HTMLElement; lifted: boolean } | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const stopFrames = (): void => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const tick = (): void => {
      latest.current.onFrame(pointer.current.x, pointer.current.y)
      frame.current = requestAnimationFrame(tick)
    }
    const end = (commit: boolean): void => {
      const current = press.current
      press.current = null
      stopFrames()
      if (!current) return
      if (current.lifted) latest.current.onDrop(commit)
      else if (commit) latest.current.onClick(current.item)
    }
    const onMove = (event: PointerEvent): void => {
      const current = press.current
      if (!current) return
      pointer.current = { x: event.clientX, y: event.clientY }
      if (!current.lifted) {
        if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return
        current.lifted = true
        window.getSelection()?.removeAllRanges()
        latest.current.onLift(current.item, current.x, current.y, current.element)
        frame.current = requestAnimationFrame(tick)
      }
      latest.current.onMove(event.clientX, event.clientY)
    }
    const onUp = (): void => end(true)
    const onCancel = (): void => end(false)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !press.current?.lifted) return
      event.preventDefault()
      event.stopPropagation()
      end(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      window.removeEventListener('keydown', onKey, true)
      stopFrames()
    }
  }, [])

  return useCallback((event: React.PointerEvent<HTMLElement>, item: T): void => {
    if (event.button !== 0 || press.current) return
    press.current = { item, x: event.clientX, y: event.clientY, element: event.currentTarget, lifted: false }
    pointer.current = { x: event.clientX, y: event.clientY }
  }, [])
}
