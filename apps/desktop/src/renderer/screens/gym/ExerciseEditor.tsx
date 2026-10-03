import React, { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import {
  DEFAULT_WEIGHT_UNIT, EXERCISE_TYPES, EXERCISE_TYPE_LABELS, usesWeight,
  type ExerciseType, type ExerciseWeightUnit
} from '@ego/core'
import { CategorySheet, PickerSheet } from '../../components/gym/sheets'
import { Dot, GymGate, SectionLabel, backFrom } from '../../components/gym/ui'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { inputClass } from '../../components/ui/input'
import { useGym } from '../../lib/gym/context'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'

const UNIT_LABELS: Record<ExerciseWeightUnit, string> = {
  default: `Default (${DEFAULT_WEIGHT_UNIT})`,
  lbs: 'lbs',
  kg: 'kg'
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <div className="mb-7">
    <SectionLabel>{label}</SectionLabel>
    <div className="mt-3">{children}</div>
  </div>
}

function Select({ label, swatch, disabled, onPress }: { label: string; swatch?: string; disabled?: boolean; onPress: () => void }): React.ReactElement {
  return <button
    type="button"
    disabled={disabled}
    onClick={onPress}
    className={cn('flex min-h-[52px] w-full flex-1 items-center rounded-xl border border-input bg-surface-900 px-4 text-left transition-colors hover:bg-surface-800 active:bg-surface-800',
      disabled && 'pointer-events-none opacity-50')}
  >
    {swatch && <span className="mr-3 flex"><Dot color={swatch} size={10} /></span>}
    <span className="flex-1 truncate text-[17px]">{label}</span>
    <ChevronDown color={color.textMuted} size={18} />
  </button>
}

export default function ExerciseEditor(): React.ReactElement {
  const [params] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const gym = useGym()
  const id = params.get('id')
  const back = backFrom(location.state, '/gym/exercises')
  const existing = id ? gym.exercises.find((item) => item.id === id) ?? null : null
  const [name, setName] = useState(params.get('name') ?? '')
  const [notes, setNotes] = useState('')
  const [categoryId, setCategoryId] = useState(params.get('categoryId') ?? '')
  const [type, setType] = useState<ExerciseType>('weight_reps')
  const [weightUnit, setWeightUnit] = useState<ExerciseWeightUnit>('default')
  const [loaded, setLoaded] = useState(!id)
  const [picker, setPicker] = useState<'category' | 'type' | 'unit' | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const category = gym.categories.find((item) => item.id === categoryId) ?? null
  const locked = (existing?.setCount ?? 0) > 0

  useEffect(() => {
    if (loaded || !existing) return
    setName(existing.name)
    setNotes(existing.notes)
    setCategoryId(existing.categoryId)
    setType(existing.type)
    setWeightUnit(existing.weightUnit)
    setLoaded(true)
  }, [existing, loaded])

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return setProblem('Give the exercise a name')
    if (!category) return setProblem('Choose a category')
    const clash = gym.exercises.find((item) => item.id !== existing?.id && item.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
    if (clash) return setProblem(`${clash.name} already exists in ${clash.categoryName}`)
    setProblem(null)
    const saved = await gym.saveExercise(existing?.id ?? null, {
      name: trimmed, categoryId: category.id, type, weightUnit: usesWeight(type) ? weightUnit : 'default', notes: notes.trim()
    })
    if (saved) navigate(back)
  }

  const remove = async (): Promise<void> => {
    setDeleting(false)
    if (existing && await gym.deleteExercise(existing.id)) navigate('/gym')
  }

  return <Screen>
    <ScreenHeader title={existing ? 'Update exercise' : 'New exercise'} back={back} right={
      <IconButton label="Save exercise" onClick={() => void save()}><Check color={color.text} size={22} /></IconButton>
    } />
    <GymGate>
      <ScreenBody className="pb-10 pt-6">
        <form onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}>
          <Field label="NAME">
            <input aria-label="Name" value={name} onChange={(event) => setName(event.target.value)} autoFocus={!id && !params.get('name')} placeholder="Barbell Squat" className={inputClass} />
          </Field>
          <Field label="NOTES (OPTIONAL)">
            <textarea aria-label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Seat height, grip, cues" className={cn(inputClass, 'min-h-[80px] resize-y')} />
          </Field>
          <Field label="CATEGORY">
            <div className="flex items-center gap-3">
              <Select label={category?.name ?? 'Choose a category'} swatch={category?.color} onPress={() => setPicker('category')} />
              <button type="button" aria-label="New category" title="New category" onClick={() => setCreatingCategory(true)} className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-input hover:bg-surface-800 active:bg-surface-800">
                <Plus color={color.text} size={22} />
              </button>
            </div>
          </Field>
          <Field label="TYPE">
            <Select label={EXERCISE_TYPE_LABELS[type]} disabled={locked} onPress={() => setPicker('type')} />
            {locked && <p className="mt-2 text-[14px] leading-5 text-muted-foreground">The type stays fixed once sets are logged, so old sets keep their meaning.</p>}
          </Field>
          {usesWeight(type) && <Field label="WEIGHT UNIT">
            <Select label={UNIT_LABELS[weightUnit]} onPress={() => setPicker('unit')} />
            <p className="mt-2 text-[14px] leading-5 text-muted-foreground">Sets logged in another unit are converted for display.</p>
          </Field>}
          {problem && <p className="mb-4 text-[15px] text-destructive">{problem}</p>}
          <Button type="submit" size="lg" disabled={gym.writing} className="w-full">{existing ? 'Save changes' : 'Create exercise'}</Button>
          {existing && <Button variant="outline" size="lg" onClick={() => setDeleting(true)} className="mt-3 w-full border-destructive/40">
            <Trash2 color={color.destructive} size={18} />
            <span className="text-destructive">Delete exercise</span>
          </Button>}
        </form>
      </ScreenBody>
    </GymGate>
    <PickerSheet
      visible={picker === 'category'}
      title="Category"
      options={gym.categories.map((item) => ({ value: item.id, label: item.name, swatch: item.color }))}
      value={categoryId || null}
      onPick={setCategoryId}
      onClose={() => setPicker(null)}
    />
    <PickerSheet
      visible={picker === 'type'}
      title="Type"
      options={EXERCISE_TYPES.map((value) => ({ value, label: EXERCISE_TYPE_LABELS[value] }))}
      value={type}
      onPick={setType}
      onClose={() => setPicker(null)}
    />
    <PickerSheet
      visible={picker === 'unit'}
      title="Weight unit"
      options={(['default', 'lbs', 'kg'] as const).map((value) => ({ value, label: UNIT_LABELS[value] }))}
      value={weightUnit}
      onPick={setWeightUnit}
      onClose={() => setPicker(null)}
    />
    <CategorySheet visible={creatingCategory} category={null} onClose={() => setCreatingCategory(false)} onSaved={setCategoryId} />
    <ConfirmDialog
      visible={deleting}
      title={`Delete ${existing?.name ?? 'this exercise'}?`}
      detail={locked
        ? `Its ${existing?.setCount ?? 0} logged sets disappear from your history and graphs on every device.`
        : 'It leaves the list on every device.'}
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(false)}
      onConfirm={() => void remove()}
    />
  </Screen>
}
