import React from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * A failed save or sync, shown above the screen until clicked away. `bar` runs edge to edge under
 * a header; `card` sits inside a page's column. The live region makes a screen reader say it as
 * soon as it appears.
 */
export function ErrorBanner({ message, onDismiss, variant = 'card', className }: {
  message: string | null | undefined
  onDismiss: () => void
  variant?: 'bar' | 'card'
  className?: string
}): React.ReactElement | null {
  if (!message) return null
  return <div role="alert" className={cn('shrink-0', className)}>
    <button
      type="button"
      title="Dismiss"
      onClick={onDismiss}
      className={cn('flex w-full items-center gap-2 bg-red-500/10 text-left transition-colors hover:bg-red-500/15',
        variant === 'bar' ? 'min-h-11 px-5 py-2' : 'rounded-2xl px-4 py-3')}
    >
      <span className="flex-1 text-[14px] leading-5 text-red-300">{message}</span>
      <X aria-hidden color="#fca5a5" size={16} className="shrink-0" />
    </button>
  </div>
}
