import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Blurred } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { Button } from './button'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open layers, newest last. Only the top one answers Escape and Tab, so a confirm over a sheet closes first. */
const layers: symbol[] = []

/** Whether any dialog is open, for a page that answers Escape itself only when none is. */
export function hasOpenLayer(): boolean {
  return layers.length > 0
}

/**
 * The last element focused outside any dialog. A field with `autoFocus` takes focus before the
 * dialog's effect runs, so the effect cannot ask the document what was focused before it opened.
 */
let focusedOutside: HTMLElement | null = null
if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLElement && !event.target.closest('[role="dialog"], [role="menu"]')) focusedOutside = event.target
  }, true)
}

/**
 * A layer over the window: Escape closes it, focus moves inside and returns afterwards, and focus
 * cannot leave it. A click on the backdrop closes it only when asked, so a half-filled form
 * survives a stray click.
 */
export function Modal({ visible, onClose, onEscape, dismissOnBackdrop = false, labelledBy, className, backdropClassName, children }: {
  visible: boolean
  onClose: () => void
  /** What Escape does when it should differ from closing, like dropping a draft the close button would keep. */
  onEscape?: () => void
  dismissOnBackdrop?: boolean
  labelledBy?: string
  className?: string
  backdropClassName?: string
  children: React.ReactNode
}): React.ReactElement | null {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape

  useEffect(() => {
    if (!visible) return
    const layer = Symbol('layer')
    layers.push(layer)
    const previous = focusedOutside
    const isTop = (): boolean => layers[layers.length - 1] === layer
    const focusInside = (): void => {
      const target = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select') ??
        panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current
      target?.focus()
    }
    if (!panel.current?.contains(document.activeElement)) focusInside()
    // A menu opened from inside the dialog is portaled to the body and keeps its own focus.
    const onFocus = (event: FocusEvent): void => {
      if (!isTop() || !(event.target instanceof Node) || panel.current?.contains(event.target)) return
      if (!(event.target instanceof Element && event.target.closest('[role="menu"]'))) focusInside()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        ;(escapeRef.current ?? closeRef.current)()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0 || !panel.current.contains(document.activeElement) || document.activeElement === panel.current) {
        event.preventDefault()
        ;(event.shiftKey ? focusable[focusable.length - 1] : focusable[0])?.focus()
        return
      }
      const head = focusable[0]
      const tail = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', onFocus, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', onFocus, true)
      layers.splice(layers.indexOf(layer), 1)
      if (layers.length === 0) previous?.focus()
    }
  }, [visible])

  if (!visible) return null
  return createPortal(<div
    className={cn('fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6', backdropClassName)}
    onMouseDown={(event) => {
      if (dismissOnBackdrop && event.target === event.currentTarget) onClose()
    }}
  >
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={cn('outline-none', className)}>
      {children}
    </div>
  </div>, document.body)
}

/**
 * The phone's bottom sheet, drawn as a panel in the middle of the window: a title, a close
 * button, and a body that scrolls.
 */
export function Sheet({ visible, title, onClose, onEscape, dismissOnBackdrop = false, privateTitle = false, wide = false, footer, children }: {
  visible: boolean
  title: string
  onClose: () => void
  onEscape?: () => void
  dismissOnBackdrop?: boolean
  /** Blurs the title while Blur is on, for a sheet named after personal data. */
  privateTitle?: boolean
  wide?: boolean
  /** Stays below the scrolling body, for the buttons that finish the sheet. */
  footer?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement | null {
  const titleId = useId()
  return <Modal
    visible={visible}
    onClose={onClose}
    onEscape={onEscape}
    dismissOnBackdrop={dismissOnBackdrop}
    labelledBy={titleId}
    className={cn('flex max-h-[88vh] w-full flex-col rounded-[28px] border border-surface-800 bg-background shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')}
  >
    <div className="flex items-center justify-between gap-3 px-6 pb-1 pt-5">
      <Blurred active={privateTitle}><h2 id={titleId} className="min-w-0 flex-1 truncate text-[22px] font-bold">{title}</h2></Blurred>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-900 text-surface-300 hover:bg-surface-800"
      ><X size={18} /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">{children}</div>
    {footer && <div className="border-t border-surface-800 px-6 py-4">{footer}</div>}
  </Modal>
}

export function ConfirmDialog({ visible, title, detail, confirmLabel, destructive = false, busy = false, onCancel, onConfirm }: {
  visible: boolean
  title: string
  detail: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.ReactElement | null {
  const titleId = useId()
  return <Modal visible={visible} onClose={onCancel} dismissOnBackdrop labelledBy={titleId} className="w-full max-w-md rounded-3xl border border-surface-800 bg-card p-6">
    <h2 id={titleId} className="text-[22px] font-bold">{title}</h2>
    <p className="mt-2 text-[16px] leading-6 text-muted-foreground">{detail}</p>
    <div className="mt-6 flex gap-3">
      <Button variant="outline" size="lg" disabled={busy} onClick={onCancel} className="flex-1">Cancel</Button>
      <Button variant={destructive ? 'destructive' : 'default'} size="lg" disabled={busy} onClick={onConfirm} className="flex-1">
        {busy ? 'Saving...' : confirmLabel}
      </Button>
    </div>
  </Modal>
}
