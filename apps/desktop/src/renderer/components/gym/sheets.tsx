import React, { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { GYM_CATEGORY_COLORS } from '@ego/core'
import { planNameProblem } from '@ego/local/gym/plans'
import type { GymCategoryView } from '@ego/local/repositories/gym'
import { useGym } from '../../lib/gym/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { Dot } from './ui'

export interface PickerOption<T extends string> {
  value: T
  label: string
  detail?: string
  swatch?: string
}

export function PickerSheet<T extends string>({ visible, title, options, value, onPick, onClose }: {
  visible: boolean
  title: string
  options: readonly PickerOption<T>[]
  value: T | null
  onPick: (value: T) => void
  onClose: () => void
}): React.ReactElement | null {
  return <Sheet visible={visible} title={title} onClose={onClose} dismissOnBackdrop>
    {options.map((option) => {
      const selected = option.value === value
      return <button
        key={option.value}
        type="button"
        aria-pressed={selected}
        onClick={() => {
          onPick(option.value)
          onClose()
        }}
        className="flex min-h-14 w-full items-center border-b border-surface-900 py-2 text-left hover:bg-surface-900 active:bg-surface-900"
      >
        {option.swatch && <span className="mr-3 flex"><Dot color={option.swatch} size={12} /></span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn('text-[17px]', selected && 'font-semibold')}>{option.label}</span>
          {option.detail && <span className="text-[14px] text-muted-foreground">{option.detail}</span>}
        </span>
        {selected && <Check color={color.text} size={19} />}
      </button>
    })}
  </Sheet>
}

function nextColor(categories: readonly GymCategoryView[]): string {
  const used = new Set(categories.map((category) => category.color))
  return GYM_CATEGORY_COLORS.find((swatch) => !used.has(swatch)) ?? GYM_CATEGORY_COLORS[categories.length % GYM_CATEGORY_COLORS.length]
}

/** Creates a category, or renames and recolors one. Calls back with the saved ID. */
export function CategorySheet({ visible, category, onClose, onSaved }: {
  visible: boolean
  category: GymCategoryView | null
  onClose: () => void
  onSaved?: (id: string) => void
}): React.ReactElement | null {
  const gym = useGym()
  const [name, setName] = useState('')
  const [swatch, setSwatch] = useState<string>(GYM_CATEGORY_COLORS[0])
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setName(category?.name ?? '')
    setSwatch(category?.color ?? nextColor(gym.categories))
    setProblem(null)
  }, [visible, category])

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setProblem('Give the category a name')
      return
    }
    const clash = gym.categories.find((item) => item.id !== category?.id && item.name.toLowerCase() === trimmed.toLowerCase())
    if (clash) {
      setProblem('A category with this name already exists')
      return
    }
    const id = await gym.saveCategory(category?.id ?? null, { name: trimmed, color: swatch })
    if (!id) return
    onSaved?.(id)
    onClose()
  }

  return <Sheet visible={visible} title={category ? 'Edit category' : 'New category'} onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      void save()
    }}>
      <label htmlFor="gym-category-name" className="mb-2 block text-[15px] font-medium text-surface-200">Name</label>
      <input
        id="gym-category-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus={!category}
        placeholder="Forearms"
        className={inputClass}
      />
      <p className="mb-2 mt-5 text-[15px] font-medium text-surface-200">Color on the calendar</p>
      <div className="flex flex-wrap gap-3">
        {GYM_CATEGORY_COLORS.map((option) => <button
          key={option}
          type="button"
          aria-label={`Color ${option}`}
          aria-pressed={option === swatch}
          onClick={() => setSwatch(option)}
          className={cn('flex h-12 w-12 items-center justify-center rounded-full border-2 transition-transform hover:scale-105',
            option === swatch ? 'border-white' : 'border-transparent')}
        ><Dot color={option} size={32} /></button>)}
      </div>
      {problem && <p className="mt-4 text-[15px] text-destructive">{problem}</p>}
      <Button type="submit" size="lg" disabled={gym.writing} className="mt-6 w-full">Save category</Button>
    </form>
  </Sheet>
}

/** Names a new plan made from a logged day. */
export function PlanNameSheet({ visible, onClose, onSave }: {
  visible: boolean
  onClose: () => void
  onSave: (name: string) => void
}): React.ReactElement | null {
  const gym = useGym()
  const [name, setName] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    setName('')
    setProblem(null)
  }, [visible])

  const save = (): void => {
    const issue = planNameProblem(name, gym.plans, null)
    if (issue) return setProblem(issue)
    onSave(name.trim())
  }

  return <Sheet visible={visible} title="Save as plan" onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      save()
    }}>
      <label htmlFor="gym-plan-name" className="mb-2 block text-[15px] font-medium text-surface-200">Name</label>
      <input
        id="gym-plan-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
        maxLength={60}
        placeholder="Push day"
        className={inputClass}
      />
      <p className="mt-2 text-[14px] leading-5 text-muted-foreground">The plan keeps this day's exercises, their order, and supersets. Sets stay with the day.</p>
      {problem && <p className="mt-4 text-[15px] text-destructive">{problem}</p>}
      <Button type="submit" size="lg" disabled={gym.writing} className="mt-6 w-full">Save plan</Button>
    </form>
  </Sheet>
}

/** Enter saves the comment; Shift+Enter starts a new line. */
export function CommentSheet({ visible, initial, onClose, onSave }: {
  visible: boolean
  initial: string
  onClose: () => void
  onSave: (comment: string) => void
}): React.ReactElement | null {
  const [draft, setDraft] = useState(initial)
  useEffect(() => {
    if (visible) setDraft(initial)
  }, [visible, initial])
  return <Sheet visible={visible} title="Set comment" onClose={onClose}>
    <textarea
      aria-label="Set comment"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey) return
        event.preventDefault()
        onSave(draft.trim())
      }}
      autoFocus
      maxLength={500}
      placeholder="Spotter helped with the last two"
      className={cn(inputClass, 'min-h-[96px] resize-y')}
    />
    <div className="mt-5 flex gap-3">
      {initial !== '' && <Button variant="outline" size="lg" onClick={() => onSave('')} className="flex-1">Remove</Button>}
      <Button size="lg" onClick={() => onSave(draft.trim())} className="flex-1">Save comment</Button>
    </div>
  </Sheet>
}
