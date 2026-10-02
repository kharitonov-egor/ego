import React from 'react'
import { cn } from '../../lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export function SegmentedControl<T extends string>({ options, value, onValueChange, className }: {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  className?: string
}): React.ReactElement {
  return <div role="tablist" className={cn('flex select-none rounded-xl border border-border bg-surface-900 p-1', className)}>
    {options.map((option) => {
      const active = option.value === value
      return <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => onValueChange(option.value)}
        className={cn('min-h-9 flex-1 truncate rounded-lg px-2 text-[14px] transition-colors',
          active ? 'bg-surface-700 font-semibold text-foreground' : 'font-medium text-muted-foreground hover:bg-surface-800')}
      >{option.label}</button>
    })}
  </div>
}
