import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Blurred } from '../../lib/blur'
import { cn } from '../../lib/utils'
import { Button } from './button'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Open layers, newest last. Only the top one answers Escape and Tab, so a confirm over a sheet closes first. */
const layers: symbol[] = []

/**
 * A layer over the window: Escape closes it, focus moves inside and returns afterwards, and Tab
 * stays within it. A click on the backdrop closes it only when asked, so a half-filled form
 * survives a stray click.
 */
export function Modal({ visible, onClose, dismissOnBackdrop = false, labelledBy, className, children }: {
  visible: boolean
  onClose: () => void
  dismissOnBackdrop?: boolean
  labelledBy?: string
  className?: string
  children: React.ReactNode
}): React.ReactElement | null {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!visible) return
    const layer = Symbol('layer')
    layers.push(layer)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select') ??
      panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (layers[layers.length - 1] !== layer) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return
      const focusable = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (focusable.length === 0) return
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
    return () => {
      document.removeEventListener('keydown', onKey, true)
      layers.splice(layers.indexOf(layer), 1)
      previous?.focus()
    }
  }, [visible])

  if (!visible) return null
  return createPortal(<div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6"
    onMouseDown={(event) => {
      if (dismissOnBackdrop && event.target === event.currentTarget) onClose()
    }}
  >
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={className}>
      {children}
    </div>
  </div>, document.body)
}

let sheetCount = 0

/**
 * The phone's bottom sheet, drawn as a panel in the middle of the window: a title, a close
 * button, and a body that scrolls.
 */
export function Sheet({ visible, title, onClose, dismissOnBackdrop = false, privateTitle = false, wide = false, footer, children }: {
  visible: boolean
  title: string
  onClose: () => void
  dismissOnBackdrop?: boolean
  /** Blurs the title while Blur is on, for a sheet named after personal data. */
  privateTitle?: boolean
  wide?: boolean
  /** Stays below the scrolling body, for the buttons that finish the sheet. */
  footer?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement | null {
  const titleId = useRef(`sheet-title-${(sheetCount += 1)}`).current
  return <Modal
    visible={visible}
    onClose={onClose}
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
  return <Modal visible={visible} onClose={onCancel} dismissOnBackdrop className="w-full max-w-md rounded-3xl border border-surface-800 bg-card p-6">
    <h2 className="text-[22px] font-bold">{title}</h2>
    <p className="mt-2 text-[16px] leading-6 text-muted-foreground">{detail}</p>
    <div className="mt-6 flex gap-3">
      <Button variant="outline" size="lg" disabled={busy} onClick={onCancel} className="flex-1">Cancel</Button>
      <Button variant={destructive ? 'destructive' : 'default'} size="lg" disabled={busy} onClick={onConfirm} className="flex-1">
        {busy ? 'Saving...' : confirmLabel}
      </Button>
    </div>
  </Modal>
}
