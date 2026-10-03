import React, { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import type { DateRange } from '@ego/core'
import { formatIso, isoToday } from '@ego/local/dates'
import { cn } from '../../lib/utils'
import { CalendarDialog } from '../DatePicker'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'

function Edge({ label, value, placeholder, onClick }: {
  label: string
  value: string | null
  placeholder: string
  onClick: () => void
}): React.ReactElement {
  return <button
    type="button"
    aria-label={`${label}: ${value ? formatIso(value) : placeholder}`}
    onClick={onClick}
    className="flex min-h-[76px] min-w-0 flex-1 flex-col justify-center rounded-2xl border border-input bg-surface-900 px-4 text-left transition-colors hover:bg-surface-800"
  >
    <span className="text-[14px] text-muted-foreground">{label}</span>
    <span className="mt-1 flex items-center gap-2">
      <CalendarDays color="#d4d4d4" size={16} />
      <span className={cn('flex-1 truncate text-[17px] font-semibold', value ? 'text-foreground' : 'text-surface-500')}>{value ? formatIso(value) : placeholder}</span>
    </span>
  </button>
}

export function CustomPeriodSheet({ visible, value, onClose, onApply }: {
  visible: boolean
  value: DateRange
  onClose: () => void
  onApply: (range: DateRange) => void
}): React.ReactElement {
  const [from, setFrom] = useState<string | null>(value.from)
  const [to, setTo] = useState<string | null>(value.to)
  const [editing, setEditing] = useState<'from' | 'to' | null>(null)
  useEffect(() => {
    if (!visible) return
    setFrom(value.from)
    setTo(value.to)
    setEditing(null)
  }, [value.from, value.to, visible])
  const invalid = Boolean(from && to && from > to)
  return <>
    <Sheet visible={visible} title="Custom range" onClose={onClose} dismissOnBackdrop>
      <div className="flex gap-3">
        <Edge label="From" value={from} placeholder="Earliest" onClick={() => setEditing('from')} />
        <Edge label="To" value={to} placeholder="Today" onClick={() => setEditing('to')} />
      </div>
      {invalid && <p className="mt-3 text-[15px] text-destructive">The start date is after the end date.</p>}
      <div className="mt-5 flex gap-3">
        <Button variant="outline" size="lg" onClick={() => { setFrom(null); setTo(null) }} className="flex-1">Clear</Button>
        <Button size="lg" disabled={invalid} onClick={() => onApply({ from, to })} className="flex-1">Apply</Button>
      </div>
    </Sheet>
    <CalendarDialog
      visible={editing !== null}
      value={(editing === 'from' ? from : to) ?? isoToday()}
      onCancel={() => setEditing(null)}
      onConfirm={(iso) => { if (editing === 'from') setFrom(iso); else setTo(iso); setEditing(null) }}
    />
  </>
}
