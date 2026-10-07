import React from 'react'
import { cn } from '../../lib/utils'

/** The phone's switch: a white track when on, with a black knob. */
export function Switch({ checked, onCheckedChange, label, disabled = false }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): React.ReactElement {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
      checked ? 'bg-primary' : 'bg-surface-700')}
  >
    <span className={cn('inline-block h-5 w-5 rounded-full transition-transform',
      checked ? 'translate-x-[22px] bg-primary-foreground' : 'translate-x-0.5 bg-surface-300')} />
  </button>
}
