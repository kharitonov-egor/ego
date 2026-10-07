import React, { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { imageIn } from '../../lib/food/photo'
import { cn } from '../../lib/utils'

function hasFiles(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes('Files')
}

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
}

/**
 * The computer's stand-in for the camera: a photo pasted with Ctrl+V anywhere on the page, or
 * dropped on this area. A paste into a text field, or while a dialog is open, is left alone.
 */
export function PhotoDropZone({ label, onPhoto, className, children }: {
  label: string
  onPhoto: (file: File) => void
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(onPhoto)
  latest.current = onPhoto

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (event.defaultPrevented || isTextField(event.target) || document.querySelector('[aria-modal="true"]')) return
      const file = imageIn(event.clipboardData)
      if (!file) return
      event.preventDefault()
      latest.current(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  return <div
    className={cn('relative', className)}
    onDragEnter={(event) => { if (hasFiles(event)) setDragging(true) }}
    onDragOver={(event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }}
    onDragLeave={(event) => {
      if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false)
    }}
    onDrop={(event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragging(false)
      const file = imageIn(event.dataTransfer) ?? event.dataTransfer.files[0]
      if (file) latest.current(file)
    }}
  >
    {children}
    {dragging && <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-surface-500 bg-background/85">
      <p className="flex items-center gap-2 text-[18px] font-semibold"><ImagePlus size={22} />{label}</p>
    </div>}
  </div>
}
