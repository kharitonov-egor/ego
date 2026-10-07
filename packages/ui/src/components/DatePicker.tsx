import React, { useEffect, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import { WEEKDAYS, formatIso, isoFromParts, isoToday, monthGrid, parseIso, shiftIso } from '@ego/local/dates'
import { cn } from '../lib/utils'
import { Button, IconButton } from './ui/button'
import { Modal, Sheet } from './ui/dialog'
import { inputClass } from './ui/input'

export function CalendarDialog({ visible, value, onCancel, onConfirm, max }: {
  visible: boolean
  value: string
  onCancel: () => void
  onConfirm: (iso: string) => void
  /** The last day that can be picked, for journals that cannot be written ahead. */
  max?: string
}): React.ReactElement | null {
  const [draft, setDraft] = useState(value)
  const [cursor, setCursor] = useState(() => parseIso(value))
  useEffect(() => {
    if (!visible) return
    setDraft(value)
    setCursor(parseIso(value))
  }, [value, visible])
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const today = isoToday()
  const step = (delta: number): void => setCursor(new Date(year, month + delta, 1))
  return <Modal visible={visible} onClose={onCancel} dismissOnBackdrop className="w-full max-w-sm rounded-3xl border border-surface-800 bg-card p-5">
    <p className="text-[15px] font-medium text-muted-foreground">Select a day</p>
    <p className="mt-1 text-[24px] font-bold">{formatIso(draft)}</p>
    <div className="mt-4 flex items-center justify-between">
      <span className="text-[17px] font-semibold">{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
      <div className="flex gap-2">
        <IconButton label="Previous month" onClick={() => step(-1)} className="bg-surface-800 hover:bg-surface-700"><ChevronLeft color="#fafafa" size={18} /></IconButton>
        <IconButton label="Next month" onClick={() => step(1)} className="bg-surface-800 hover:bg-surface-700"><ChevronRight color="#fafafa" size={18} /></IconButton>
      </div>
    </div>
    <div className="mt-4 grid grid-cols-7">{WEEKDAYS.map((day, index) => <span key={index} className="text-center text-[14px] font-medium text-muted-foreground">{day}</span>)}</div>
    <div className="mt-1">{monthGrid(year, month).map((week, weekIndex) => <div key={weekIndex} className="grid grid-cols-7">{week.map((day, dayIndex) => {
      if (day === null) return <span key={dayIndex} className="h-11" />
      const iso = isoFromParts(year, month, day)
      const selected = iso === draft
      const disabled = max !== undefined && iso > max
      return <button
        key={dayIndex}
        type="button"
        aria-pressed={selected}
        aria-label={parseIso(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        disabled={disabled}
        onClick={() => setDraft(iso)}
        onDoubleClick={() => onConfirm(iso)}
        className="flex h-11 items-center justify-center disabled:opacity-30"
      >
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-[15px]',
          selected ? 'bg-primary font-bold text-primary-foreground' : iso === today ? 'border border-surface-500' : 'hover:bg-surface-800')}>{day}</span>
      </button>
    })}</div>)}</div>
    <div className="mt-4 flex gap-3">
      <Button variant="outline" onClick={onCancel} className="flex-1">Cancel</Button>
      <Button onClick={() => onConfirm(draft)} className="flex-1">Done</Button>
    </div>
  </Modal>
}

/** A form field that shows the date in words and opens the calendar, instead of a YYYY-MM-DD text box. */
export function DateField({ value, onChange, label = 'Date' }: { value: string; onChange: (iso: string) => void; label?: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <button
      type="button"
      aria-label={`${label}: ${formatIso(value)}`}
      onClick={() => setOpen(true)}
      className={cn(inputClass, 'flex items-center justify-between text-left')}
    >
      <span className="min-w-0 flex-1 truncate">{formatIso(value)}</span>
      <CalendarDays color="#a3a3a3" size={18} />
    </button>
    <CalendarDialog visible={open} value={value} onCancel={() => setOpen(false)} onConfirm={(iso) => { onChange(iso); setOpen(false) }} />
  </>
}

function dayMonth(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function DayTile({ label, detail, active, Icon, onClick }: { label: string; detail: string; active: boolean; Icon: typeof Sun; onClick: () => void }): React.ReactElement {
  return <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={cn('flex flex-1 flex-col items-center rounded-2xl border py-5 transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface-900 hover:bg-surface-800')}
  >
    <Icon color={active ? '#0a0a0a' : '#fafafa'} size={22} />
    <span className="mt-2 text-[17px] font-semibold">{label}</span>
    <span className={cn('mt-0.5 text-[15px]', active ? 'text-surface-700' : 'text-muted-foreground')}>{detail}</span>
  </button>
}

export function DateSheet({ visible, value, onClose, onChange }: { visible: boolean; value: string; onClose: () => void; onChange: (iso: string) => void }): React.ReactElement {
  const [calendarOpen, setCalendarOpen] = useState(false)
  const today = isoToday()
  const yesterday = shiftIso(today, -1)
  const pick = (iso: string): void => { onChange(iso); onClose() }
  const other = value !== today && value !== yesterday
  return <>
    <Sheet visible={visible} title="Date" onClose={onClose} dismissOnBackdrop>
      <div className="flex gap-3">
        <DayTile label="Yesterday" detail={dayMonth(yesterday)} active={value === yesterday} Icon={Moon} onClick={() => pick(yesterday)} />
        <DayTile label="Today" detail={dayMonth(today)} active={value === today} Icon={Sun} onClick={() => pick(today)} />
      </div>
      <button
        type="button"
        onClick={() => setCalendarOpen(true)}
        className={cn('mt-3 flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl border text-[17px] font-semibold transition-colors',
          other ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-surface-900 hover:bg-surface-800')}
      >
        <CalendarDays color={other ? '#0a0a0a' : '#fafafa'} size={20} />
        {other ? formatIso(value) : 'Pick another day'}
      </button>
    </Sheet>
    <CalendarDialog visible={calendarOpen} value={value} onCancel={() => setCalendarOpen(false)} onConfirm={(iso) => { setCalendarOpen(false); pick(iso) }} />
  </>
}
