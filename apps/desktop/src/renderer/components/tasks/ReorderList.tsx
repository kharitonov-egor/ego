import React, { useLayoutEffect, useRef, useState } from 'react'
import { dropIndex, edgeScroll, usePointerDrag } from '../../lib/tasks/drag'
import { DraggingCursor } from './ui'

const GAP = 12
const EDGE = 64
const SCROLL_STEP = 14
const DEFAULT_HEIGHT = 76

interface Lifted {
  id: string
  fromIndex: number
  offsetY: number
  left: number
  width: number
}

/**
 * A vertical list that reorders by dragging a row with the mouse, the way boards are ordered.
 * Alt with the up or down arrow moves the focused row. The rows are measured when one lifts, so
 * the drop index comes straight from the pointer's height, and the list scrolls when the pointer
 * rests near its top or bottom.
 */
export function ReorderList<T extends { id: string }>({ items, renderItem, onPress, onMove, header, footer, label }: {
  items: readonly T[]
  renderItem: (item: T, lifted: boolean) => React.ReactElement
  onPress: (item: T) => void
  onMove: (id: string, index: number) => void
  header?: React.ReactNode
  footer?: React.ReactNode
  label: (item: T) => string
}): React.ReactElement {
  const [lifted, setLifted] = useState<Lifted | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const latest = useRef({ items, onMove, onPress })
  latest.current = { items, onMove, onPress }
  const liftedRef = useRef<Lifted | null>(null)
  const hoverRef = useRef<number | null>(null)
  const pointerY = useRef(0)
  const scroll = useRef<HTMLDivElement>(null)
  const rowsView = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const rowViews = useRef(new Map<string, HTMLElement>())
  const heights = useRef(new Map<string, number>())

  const updateHover = (): void => {
    const current = liftedRef.current
    const rows = rowsView.current
    if (!current || !rows) return
    const others = latest.current.items.filter((item) => item.id !== current.id)
    const index = dropIndex(pointerY.current - rows.getBoundingClientRect().top,
      others.map((item) => heights.current.get(item.id) ?? DEFAULT_HEIGHT), GAP)
    if (hoverRef.current === index) return
    hoverRef.current = index
    setHover(index)
  }

  const press = usePointerDrag<T>({
    onLift: (item, _x, y, element) => {
      for (const [id, view] of rowViews.current) heights.current.set(id, view.getBoundingClientRect().height)
      const rect = element.getBoundingClientRect()
      const fromIndex = latest.current.items.findIndex((entry) => entry.id === item.id)
      if (fromIndex < 0) return
      const next: Lifted = { id: item.id, fromIndex, offsetY: y - rect.top, left: rect.left, width: rect.width }
      liftedRef.current = next
      hoverRef.current = fromIndex
      pointerY.current = y
      setLifted(next)
      setHover(fromIndex)
    },
    onMove: (_x, y) => {
      pointerY.current = y
      const current = liftedRef.current
      if (current && ghost.current) ghost.current.style.transform = `translateY(${y - current.offsetY}px) rotate(1.5deg)`
      updateHover()
    },
    onFrame: (_x, y) => {
      const view = scroll.current
      if (!view || !liftedRef.current) return
      const rect = view.getBoundingClientRect()
      const delta = edgeScroll(y, rect.top, rect.bottom, EDGE, SCROLL_STEP)
      if (delta === 0) return
      const before = view.scrollTop
      view.scrollTop += delta
      if (view.scrollTop !== before) updateHover()
    },
    onDrop: (commit) => {
      const current = liftedRef.current
      const index = hoverRef.current
      liftedRef.current = null
      hoverRef.current = null
      setLifted(null)
      setHover(null)
      if (commit && current && index !== null && index !== current.fromIndex) latest.current.onMove(current.id, index)
    },
    onClick: (item) => latest.current.onPress(item)
  })

  useLayoutEffect(() => {
    if (lifted && ghost.current) ghost.current.style.transform = `translateY(${pointerY.current - lifted.offsetY}px) rotate(1.5deg)`
  }, [lifted])

  const liftedItem = lifted ? items.find((item) => item.id === lifted.id) : undefined
  const rows: Array<T | 'placeholder'> = items.filter((item) => item.id !== lifted?.id)
  if (lifted && hover !== null) rows.splice(Math.min(hover, rows.length), 0, 'placeholder')

  return <div className="relative flex min-h-0 flex-1 flex-col">
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 pb-10 pt-5">
        {header}
        <div ref={rowsView} className="flex flex-col" style={{ gap: GAP }}>
          {rows.map((item) => item === 'placeholder'
            ? <div key="placeholder" className="rounded-3xl border-[1.5px] border-dashed border-surface-600" style={{ height: liftedItem ? heights.current.get(liftedItem.id) ?? DEFAULT_HEIGHT : DEFAULT_HEIGHT }} />
            : <div
              key={item.id}
              ref={(view) => {
                if (view) rowViews.current.set(item.id, view)
                else rowViews.current.delete(item.id)
              }}
              role="button"
              tabIndex={0}
              aria-label={label(item)}
              onPointerDown={(event) => press(event, item)}
              onDragStart={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                const index = items.findIndex((entry) => entry.id === item.id)
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onPress(item)
                } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                  event.preventDefault()
                  const target = index + (event.key === 'ArrowUp' ? -1 : 1)
                  if (target >= 0 && target < items.length) onMove(item.id, target)
                }
              }}
              className="cursor-pointer select-none rounded-3xl"
            >{renderItem(item, false)}</div>)}
        </div>
        {footer}
      </div>
    </div>
    {lifted && liftedItem && <>
      <DraggingCursor />
      <div
        ref={ghost}
        className="pointer-events-none fixed z-40 opacity-95 shadow-[0_6px_24px_rgba(0,0,0,0.6)]"
        style={{ left: lifted.left, top: 0, width: lifted.width }}
      >{renderItem(liftedItem, true)}</div>
    </>}
  </div>
}
