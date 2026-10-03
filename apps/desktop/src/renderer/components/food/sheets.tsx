import React, { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, PenLine, ScanBarcode, Trash2, type LucideIcon } from 'lucide-react'
import { FOOD_TEXT_LIMIT, isFoodBarcode, type FoodGoalInput, type FridgeItemInput } from '@ego/core'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { FridgeIcon } from './ui'

function Option({ Icon, label, detail, onPress }: { Icon: LucideIcon; label: string; detail: string; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    onClick={onPress}
    className="mb-2 flex min-h-16 w-full items-center gap-4 rounded-2xl bg-surface-900 px-4 py-3 text-left transition-colors hover:bg-surface-800 active:bg-surface-800"
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary"><Icon color={color.screen} size={20} /></span>
    <span className="min-w-0 flex-1">
      <span className="block text-[16px] font-semibold">{label}</span>
      <span className="block text-[14px] text-muted-foreground">{detail}</span>
    </span>
  </button>
}

/** The computer has no camera, so a photo comes from a file, a paste, or a drop. */
export type AddChoice = 'library' | 'barcode' | 'type'

/** Every way in, for the log or for the fridge. */
export function AddSheet({ visible, mode, onPick, onClose }: {
  visible: boolean
  mode: 'log' | 'fridge'
  onPick: (choice: AddChoice) => void
  onClose: () => void
}): React.ReactElement | null {
  const log = mode === 'log'
  return <Sheet visible={visible} title={log ? 'Log food' : 'Add to the fridge'} onClose={onClose} dismissOnBackdrop>
    <Option Icon={ImageIcon} label="Choose a photo" detail={log ? 'Of the plate or the nutrition label' : 'Of groceries, a shelf, or a bag'} onPress={() => onPick('library')} />
    <Option Icon={ScanBarcode} label="Barcode" detail={log ? 'Label numbers for one serving' : 'The product name from its barcode'} onPress={() => onPick('barcode')} />
    <Option Icon={PenLine} label={log ? 'Describe it' : 'Type a name'} detail={log ? '"Two eggs and toast"' : 'For anything without a barcode'} onPress={() => onPick('type')} />
    <p className="mt-2 text-[13px] leading-5 text-muted-foreground">A photo can also be pasted with Ctrl+V or dropped anywhere on this page.</p>
  </Sheet>
}

/**
 * The phone points its camera at the bars. Here the digits are typed, or come from a USB barcode
 * scanner, which types them and presses Enter.
 */
export function BarcodeSheet({ visible, mode, onLookUp, onClose }: {
  visible: boolean
  mode: 'log' | 'fridge'
  onLookUp: (barcode: string) => void
  onClose: () => void
}): React.ReactElement | null {
  const [text, setText] = useState('')
  const [tried, setTried] = useState(false)
  useEffect(() => {
    if (!visible) return
    setText('')
    setTried(false)
  }, [visible])
  const barcode = text.replace(/\D/g, '')
  const valid = isFoodBarcode(barcode)
  return <Sheet visible={visible} title="Barcode" onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      if (valid) onLookUp(barcode)
      else setTried(true)
    }}>
      <input
        value={text}
        onChange={(event) => {
          setText(event.target.value.replace(/[^\d\s-]/g, ''))
          setTried(false)
        }}
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        maxLength={24}
        placeholder="012345678905"
        aria-label="Barcode number"
        className={cn(inputClass, 'tabular tracking-wider')}
      />
      <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
        {mode === 'fridge' ? 'Type the barcode of something you bought' : 'Type the barcode on the package'}, or scan it with a USB barcode scanner.
      </p>
      {tried && !valid && <p className="mt-2 text-[14px] text-destructive">A barcode has 6 to 14 digits.</p>}
      <Button type="submit" size="lg" className="mt-4 w-full" disabled={barcode === ''}>Look it up</Button>
    </form>
  </Sheet>
}

export function DescribeSheet({ visible, onSend, onClose }: {
  visible: boolean
  onSend: (text: string) => void
  onClose: () => void
}): React.ReactElement | null {
  const [text, setText] = useState('')
  useEffect(() => { if (visible) setText('') }, [visible])
  const send = (): void => {
    if (text.trim()) onSend(text.trim())
  }
  return <Sheet visible={visible} title="Describe it" onClose={onClose}>
    <textarea
      value={text}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
        event.preventDefault()
        send()
      }}
      placeholder="A chicken burrito bowl with guac, about half eaten"
      aria-label="What you ate"
      autoFocus
      maxLength={FOOD_TEXT_LIMIT}
      rows={4}
      className={cn(inputClass, 'min-h-28 resize-none')}
    />
    <p className="mt-2 text-[13px] leading-5 text-muted-foreground">Amounts help: "two slices", "a large bowl", "about 200 g".</p>
    <Button size="lg" className="mt-4 w-full" disabled={text.trim() === ''} onClick={send}>Work it out</Button>
  </Sheet>
}

function NumberField({ label, unit, value, onChange }: { label: string; unit: string; value: string; onChange: (text: string) => void }): React.ReactElement {
  return <div className="mb-4">
    <label className="mb-2 block text-[15px] font-medium text-surface-200">
      {label}
      <span className="mt-2 flex items-center">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ''))}
          placeholder="No target"
          aria-label={`${label} target`}
          inputMode="decimal"
          maxLength={6}
          className={cn(inputClass, 'tabular flex-1 font-normal')}
        />
        <span className="ml-3 w-10 text-[16px] font-normal text-muted-foreground">{unit}</span>
      </span>
    </label>
  </div>
}

function targetText(value: number | null): string {
  return value === null ? '' : String(value)
}

function targetValue(text: string): number | null {
  const value = Number(text)
  return text.trim() === '' || !Number.isFinite(value) || value <= 0 ? null : Math.round(value)
}

export function TargetsSheet({ visible, goal, onSave, onClose }: {
  visible: boolean
  goal: FoodGoalInput
  onSave: (goal: FoodGoalInput) => void
  onClose: () => void
}): React.ReactElement | null {
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const saved = useRef(goal)
  saved.current = goal
  // Only opening the sheet refills it. A sync landing while it is open would wipe what was typed.
  useEffect(() => {
    if (!visible) return
    setCalories(targetText(saved.current.calories))
    setProtein(targetText(saved.current.protein))
    setCarbs(targetText(saved.current.carbs))
    setFat(targetText(saved.current.fat))
  }, [visible])
  return <Sheet visible={visible} title="Daily targets" onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      onSave({ calories: targetValue(calories), protein: targetValue(protein), carbs: targetValue(carbs), fat: targetValue(fat) })
    }}>
      <NumberField label="Calories" unit="kcal" value={calories} onChange={setCalories} />
      <NumberField label="Protein" unit="g" value={protein} onChange={setProtein} />
      <NumberField label="Carbs" unit="g" value={carbs} onChange={setCarbs} />
      <NumberField label="Fat" unit="g" value={fat} onChange={setFat} />
      <p className="text-[13px] leading-5 text-muted-foreground">Leave a box empty for no target. Every day compares against these.</p>
      <Button type="submit" size="lg" className="mt-4 w-full">Save</Button>
    </form>
  </Sheet>
}

/** The items a fridge photo turned up, with a way to drop the ones it got wrong. */
export function FridgeDraftSheet({ visible, items, onChange, onSave, onClose }: {
  visible: boolean
  items: readonly FridgeItemInput[]
  onChange: (items: FridgeItemInput[]) => void
  onSave: () => void
  onClose: () => void
}): React.ReactElement | null {
  return <Sheet
    visible={visible}
    title="Add to the fridge"
    onClose={onClose}
    footer={<Button size="lg" className="w-full" disabled={items.length === 0} onClick={onSave}>
      {items.length === 1 ? 'Add 1 item' : `Add ${items.length} items`}
    </Button>}
  >
    {items.map((item, index) => <div key={`${index}-${item.name}`} className="flex min-h-14 items-center border-b border-surface-900">
      <FridgeIcon icon={item.icon} size={36} />
      <div className="ml-3 min-w-0 flex-1 py-2">
        <p className="truncate text-[16px]">{item.name}</p>
        {item.brand && <p className="truncate text-[13px] text-muted-foreground">{item.brand}</p>}
      </div>
      <button
        type="button"
        aria-label={`Leave out ${item.name}`}
        title={`Leave out ${item.name}`}
        onClick={() => onChange(items.filter((_, position) => position !== index))}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-800 active:bg-surface-800"
      ><Trash2 color={color.textMuted} size={18} /></button>
    </div>)}
  </Sheet>
}
