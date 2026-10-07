import React from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

/** `color` fills the checked box, so a chart toggle doubles as that series' legend key. */
export function Checkbox({ checked, onCheckedChange, label, color, disabled = false, className }: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  color?: string
  disabled?: boolean
  className?: string
}): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onCheckedChange(!checked)}
    className={cn('inline-flex min-h-9 select-none items-center gap-2.5 pr-1 disabled:opacity-40', className)}
  >
    <span
      className={cn('flex h-5 w-5 items-center justify-center rounded-md border', checked ? 'border-transparent' : 'border-surface-500')}
      style={checked ? { backgroundColor: color ?? '#fafafa' } : undefined}
    >
      {checked && <Check color="#0a0a0a" size={14} strokeWidth={3} />}
    </span>
    <span className={cn('text-[14px] font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
  </button>
}
