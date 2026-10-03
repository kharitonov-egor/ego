import React, { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw, Trash2, TriangleAlert, X } from 'lucide-react'
import { formatCalories, type FoodEntryInput } from '@ego/core'
import { clockOf, entryAt } from '@ego/local/food/drafts'
import { Label } from '../../components/common'
import { DateField } from '../../components/DatePicker'
import { FoodMessage, FoodPhotoView, macroText } from '../../components/food/ui'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { useFood } from '../../lib/food/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

type Meridiem = 'am' | 'pm'

interface Clock {
  hour: string
  minute: string
  meridiem: Meridiem
}

const MERIDIEMS = [{ value: 'am', label: 'AM' }, { value: 'pm', label: 'PM' }] as const

function clockFrom(time: string): Clock {
  const [hours, minutes] = time.split(':').map(Number)
  return { hour: String(hours % 12 === 0 ? 12 : hours % 12), minute: String(minutes).padStart(2, '0'), meridiem: hours < 12 ? 'am' : 'pm' }
}

function timeFrom(clock: Clock): string | null {
  const hour = Number(clock.hour)
  const minute = Number(clock.minute)
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const hours = (hour % 12) + (clock.meridiem === 'pm' ? 12 : 0)
  return `${String(hours).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function numberText(value: number): string {
  return String(Math.round(value * 10) / 10)
}

function NumberInput({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (text: string) => void }): React.ReactElement {
  return <label className="block min-w-0 flex-1">
    <span className="mb-1.5 block text-[14px] font-medium text-surface-200">{label}</span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ''))}
      onFocus={(event) => event.target.select()}
      aria-label={`${label} in ${unit}`}
      inputMode="decimal"
      maxLength={7}
      className={cn(inputClass, 'tabular px-3')}
    />
    <span className="mt-1 block text-[12px] text-muted-foreground">{unit}</span>
  </label>
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }): React.ReactElement {
  return <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-5">
    <h2 className="min-w-0 flex-1 truncate text-[17px] font-bold">{title}</h2>
    <IconButton label="Close" onClick={onClose} className="-mr-2"><X size={20} /></IconButton>
  </div>
}

/**
 * The phone's entry screen, opened beside the log. `id` is an entry's ID, or `draft` for the card
 * counting down, which stays held while this is open.
 */
export function FoodEntryPanel({ id, onClose }: { id: string; onClose: () => void }): React.ReactElement {
  const food = useFood()
  const isDraft = id === 'draft'
  const draft = isDraft && food.draft?.kind === 'meal' && food.draft.state === 'ready' ? food.draft : null
  const record = isDraft ? null : food.data?.entries.find((entry) => entry.id === id) ?? null
  const source = draft?.entry ?? record
  if (!source) {
    return <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader title="" onClose={onClose} />
      <FoodMessage title={isDraft ? 'That food already saved' : 'That entry is gone'} detail="It may have been deleted on another device." action="Back" onAction={onClose} />
    </div>
  }
  return <Editor key={record?.id ?? 'draft'} initial={source} onClose={onClose} />
}

function Editor({ initial, onClose }: { initial: FoodEntryInput & { id?: string }; onClose: () => void }): React.ReactElement {
  const food = useFood()
  const record = initial.id ? food.data?.entries.find((entry) => entry.id === initial.id) ?? null : null
  const isDraft = record === null
  const [name, setName] = useState(initial.name)
  const [serving, setServing] = useState(initial.serving)
  const [date, setDate] = useState(initial.date)
  const [clock, setClock] = useState(() => clockFrom(clockOf(initial.eatenAt)))
  const [calories, setCalories] = useState(numberText(initial.calories))
  const [protein, setProtein] = useState(numberText(initial.protein))
  const [carbs, setCarbs] = useState(numberText(initial.carbs))
  const [fat, setFat] = useState(numberText(initial.fat))
  const [note, setNote] = useState(initial.note)
  const [deleting, setDeleting] = useState(false)
  const saved = useRef(false)
  const { pauseDraft } = food

  // Reaching the draft's editor any other way than its card, like the back button, holds it too.
  useEffect(() => {
    if (!isDraft) return
    pauseDraft(true)
    return () => {
      if (!saved.current) pauseDraft(false)
    }
  }, [isDraft, pauseDraft])

  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const time = timeFrom(clock)
  const edited = useMemo<FoodEntryInput | null>(() => {
    if (time === null) return null
    const amounts = [calories, protein, carbs, fat].map(Number)
    if (amounts.some((value) => !Number.isFinite(value))) return null
    const [kcal, grams, carb, fats] = amounts
    return entryAt({ ...initial, name, serving, note, calories: kcal, protein: grams, carbs: carb, fat: fats }, date, time)
  }, [calories, carbs, date, fat, initial, name, note, protein, serving, time])
  const canSave = edited !== null && name.trim() !== ''

  const save = async (): Promise<void> => {
    if (!edited || !canSave) return
    if (isDraft) {
      saved.current = true
      food.editDraftEntry(edited)
      onClose()
      await food.saveDraft()
      return
    }
    if (record && await food.saveEntry(record, edited)) onClose()
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <PanelHeader title={isDraft ? 'New food' : 'Food'} onClose={onClose} />
    <form
      className="min-h-0 flex-1 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="mx-auto w-full max-w-2xl p-5">
        {record && food.failedUploads.has(record.id) && <div className="mb-4 rounded-2xl bg-attention/10 p-4">
          <div className="flex items-start">
            <TriangleAlert color={color.attention} size={18} className="mt-0.5 shrink-0" />
            <p className="ml-2.5 flex-1 text-[15px] leading-6 text-attention">The photo did not upload, so this entry is only on this computer.</p>
          </div>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void food.retryUpload(record.id)}>
            <RotateCcw color={color.text} size={16} />Try again
          </Button>
        </div>}
        {initial.photo && <div className="mb-5 overflow-hidden rounded-3xl">
          <FoodPhotoView
            photo={initial.photo}
            uri={isDraft && food.draft?.photo ? food.draft.photo.uri : null}
            size="large"
            className="aspect-[3/2] w-full"
          />
        </div>}
        <Label text="Name" htmlFor="food-name">
          <input
            id="food-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="What it was"
            className={inputClass}
          />
        </Label>
        <Label text="Day">
          <DateField value={date} onChange={setDate} label="Day" />
        </Label>
        <p className="mb-2 text-[15px] font-medium text-surface-200">Time</p>
        <div className="mb-5 flex items-center gap-2">
          <input
            value={clock.hour}
            onChange={(event) => setClock({ ...clock, hour: event.target.value.replace(/\D/g, '') })}
            onFocus={(event) => event.target.select()}
            aria-label="Hour"
            inputMode="numeric"
            maxLength={2}
            className={cn(inputClass, 'tabular w-16 px-2 text-center')}
          />
          <span className="text-[20px] font-bold">:</span>
          <input
            value={clock.minute}
            onChange={(event) => setClock({ ...clock, minute: event.target.value.replace(/\D/g, '') })}
            onFocus={(event) => event.target.select()}
            aria-label="Minute"
            inputMode="numeric"
            maxLength={2}
            className={cn(inputClass, 'tabular w-16 px-2 text-center')}
          />
          <SegmentedControl options={MERIDIEMS} value={clock.meridiem} onValueChange={(meridiem) => setClock({ ...clock, meridiem })} className="ml-1 flex-1" />
        </div>
        {time === null && <p className="-mt-3 mb-4 text-[14px] text-destructive">Enter a time like 12:30.</p>}
        <Label text="Serving" htmlFor="food-serving">
          <input
            id="food-serving"
            value={serving}
            onChange={(event) => setServing(event.target.value)}
            maxLength={80}
            placeholder="1 bowl"
            className={inputClass}
          />
        </Label>
        <div className="mb-5 flex gap-2">
          <NumberInput label="Calories" unit="kcal" value={calories} onChange={setCalories} />
          <NumberInput label="Protein" unit="g" value={protein} onChange={setProtein} />
          <NumberInput label="Carbs" unit="g" value={carbs} onChange={setCarbs} />
          <NumberInput label="Fat" unit="g" value={fat} onChange={setFat} />
        </div>
        {initial.parts.length > 1 && <div className="mb-5 rounded-2xl border border-border bg-card px-4 py-3">
          <p className="mb-1 text-[14px] font-medium text-muted-foreground">What the estimate counted</p>
          {initial.parts.map((part, index) => <div key={`${index}-${part.name}`} className="flex gap-3 py-1">
            <span className="min-w-0 flex-1 text-[15px]">{part.name}</span>
            <span className="tabular text-[14px] text-muted-foreground">{formatCalories(part.calories)} kcal · {macroText(part)}</span>
          </div>)}
        </div>}
        <Label text="Note" htmlFor="food-note">
          <textarea
            id="food-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
              event.preventDefault()
              void save()
            }}
            maxLength={1000}
            rows={3}
            placeholder="Anything worth remembering"
            className={cn(inputClass, 'min-h-20 resize-y')}
          />
        </Label>
        {initial.barcode && <p className="tabular mb-4 text-[13px] text-surface-500">Barcode {initial.barcode}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={!canSave}>Save</Button>
        {record && <Button variant="ghost" size="lg" className="mt-3 w-full" onClick={() => setDeleting(true)}>
          <Trash2 color={color.destructive} size={18} />
          <span className="text-destructive">Delete</span>
        </Button>}
      </div>
    </form>
    <ConfirmDialog
      visible={deleting}
      title="Delete this food?"
      detail="It comes off the log on every device."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(false)}
      onConfirm={() => {
        setDeleting(false)
        if (record) void food.removeEntry(record).then((done) => { if (done) onClose() })
      }}
    />
  </div>
}
