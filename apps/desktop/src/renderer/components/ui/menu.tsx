import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

export interface MenuItem {
  label: string
  Icon?: LucideIcon
  destructive?: boolean
  disabled?: boolean
  onPress: () => void
}

/** Where a menu opens: at the pointer for a right-click, or under the button that opened it. */
export interface MenuAnchor {
  x: number
  y: number
  align?: 'start' | 'end'
}

export function anchorAtPointer(event: React.MouseEvent): MenuAnchor {
  return { x: event.clientX, y: event.clientY }
}

/** Under the element, lined up with its right edge by default or its left edge with `start`. */
export function anchorBelow(element: Element, align: 'start' | 'end' = 'end'): MenuAnchor {
  const rect = element.getBoundingClientRect()
  return { x: align === 'end' ? rect.right : rect.left, y: rect.bottom + 4, align }
}

/** A click from the keyboard has no pointer position, so its menu opens under the button instead. */
export function anchorForClick(event: React.MouseEvent): MenuAnchor {
  return event.detail === 0 ? anchorBelow(event.currentTarget) : anchorAtPointer(event)
}

const EDGE = 8

/**
 * The phone's menu sheet, as a desktop menu: it opens at the pointer or under its button, arrow
 * keys move through it, and Escape, a click elsewhere, or the window losing focus closes it.
 */
export function PopupMenu({ anchor, title, items, onClose }: {
  anchor: MenuAnchor | null
  title?: string
  items: MenuItem[]
  onClose: () => void
}): React.ReactElement | null {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor || !panel.current) {
      setPosition(null)
      return
    }
    const { width, height } = panel.current.getBoundingClientRect()
    const wanted = anchor.align === 'end' ? anchor.x - width : anchor.x
    const left = Math.max(EDGE, Math.min(wanted, window.innerWidth - width - EDGE))
    const below = anchor.y + height + EDGE <= window.innerHeight
    const top = below ? anchor.y : Math.max(EDGE, anchor.y - height)
    setPosition({ left, top })
  }, [anchor])

  useEffect(() => {
    if (!anchor) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
      const entries = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
      if (entries.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const index = entries.findIndex((entry) => entry === document.activeElement)
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? entries.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
      entries[next].focus()
    }
    const close = (): void => closeRef.current()
    // Capture on the window runs before the dialogs' own Escape handling, so a menu over a sheet closes alone.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      previous?.focus({ preventScroll: true })
    }
  }, [anchor])

  if (!anchor) return null
  return createPortal(<div
    className="fixed inset-0 z-[60]"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    onContextMenu={(event) => {
      event.preventDefault()
      if (event.target === event.currentTarget) onClose()
    }}
  >
    <div
      ref={panel}
      role="menu"
      aria-label={title}
      style={{ left: position?.left ?? anchor.x, top: position?.top ?? anchor.y, opacity: position ? 1 : 0 }}
      className="fixed min-w-56 max-w-80 rounded-2xl border border-surface-800 bg-popover py-1.5 shadow-2xl"
    >
      {title && <p className="truncate border-b border-surface-800 px-4 pb-2 pt-1.5 text-[13px] font-semibold text-muted-foreground">{title}</p>}
      {items.map((item) => <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          onClose()
          item.onPress()
        }}
        className="flex min-h-10 w-full items-center gap-3 px-4 text-left outline-none hover:bg-surface-800 focus-visible:bg-surface-800 active:bg-surface-700 disabled:pointer-events-none disabled:opacity-40"
      >
        {item.Icon && <item.Icon color={item.destructive ? color.destructive : color.textSecondary} size={18} />}
        <span className={cn('truncate text-[15px]', item.destructive && 'text-destructive')}>{item.label}</span>
      </button>)}
    </div>
  </div>, document.body)
}
