import React from 'react'
import { cn } from '../../lib/utils'
import { money } from '../common'
import { cleanAmountText, isCalculation, typedAmountCents } from './amount'

/**
 * The phone's keypad as a text field. It takes the same sums (12+3.50, 4*2.25), so a split bill
 * still adds up before it is saved, and Enter saves.
 */
export function AmountInput({ value, onChange, onSubmit, color, size, label = 'Amount', autoFocus = false }: {
  value: string
  onChange: (text: string) => void
  onSubmit: () => void
  color: string
  size: number
  label?: string
  autoFocus?: boolean
}): React.ReactElement {
  const cents = typedAmountCents(value)
  const calculation = isCalculation(value)
  return <div className="flex flex-col items-center">
    <label className="flex w-full items-baseline justify-center font-bold tracking-tight tabular" style={{ color, fontSize: size }}>
      <span aria-hidden>$</span>
      <span className="inline-grid min-w-0 max-w-full">
        <span aria-hidden className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre pr-[0.08em]">{value || '0'}</span>
        <input
          value={value}
          onChange={(event) => onChange(cleanAmountText(event.target.value))}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            onSubmit()
          }}
          autoFocus={autoFocus}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          placeholder="0"
          size={1}
          className="col-start-1 row-start-1 w-full min-w-0 bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
        />
      </span>
    </label>
    <p aria-live="polite" className={cn('min-h-5 text-[14px] text-muted-foreground tabular', !calculation && 'invisible')}>
      {calculation && cents !== null ? `= ${money(cents)}` : 'Finish the sum'}
    </p>
  </div>
}
