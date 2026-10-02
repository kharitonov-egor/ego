import React, { useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { KeyboardScrollView } from '../../components/ui/keyboard'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react-native'
import {
  DEFAULT_WEIGHT_UNIT, EXERCISE_TYPES, EXERCISE_TYPE_LABELS, usesWeight,
  type ExerciseType, type ExerciseWeightUnit
} from '@ego/core'
import { ConfirmDialog, inputClass } from '../../components/money/Common'
import { color } from '../../components/money/tokens'
import { CategorySheet, PickerSheet } from '../../components/gym/sheets'
import { Dot, GymGate, HeaderIcon, SectionLabel } from '../../components/gym/ui'
import { Button } from '../../components/ui/button'
import { Text } from '../../components/ui/text'
import { useGym } from '../../lib/gym-context'

const UNIT_LABELS: Record<ExerciseWeightUnit, string> = {
  default: `Default (${DEFAULT_WEIGHT_UNIT})`,
  lbs: 'lbs',
  kg: 'kg'
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <View className="mb-7">
    <SectionLabel>{label}</SectionLabel>
    <View className="mt-3">{children}</View>
  </View>
}

function Select({ label, swatch, disabled, onPress }: { label: string; swatch?: string; disabled?: boolean; onPress: () => void }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ disabled: Boolean(disabled) }}
    disabled={disabled}
    onPress={onPress}
    className={`min-h-[52px] flex-1 flex-row items-center rounded-xl border border-input bg-surface-900 px-4 active:bg-surface-800 ${disabled ? 'opacity-50' : ''}`}
  >
    {swatch && <View className="mr-3"><Dot color={swatch} size={10} /></View>}
    <Text numberOfLines={1} className="flex-1 text-[17px]">{label}</Text>
    <ChevronDown color={color.textMuted} size={18} />
  </Pressable>
}

export default function ExerciseEditor(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string; categoryId?: string; name?: string }>()
  const gym = useGym()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const existing = params.id ? gym.exercises.find((item) => item.id === params.id) ?? null : null
  const [name, setName] = useState(params.name ?? '')
  const [notes, setNotes] = useState('')
  const [categoryId, setCategoryId] = useState(params.categoryId ?? '')
  const [type, setType] = useState<ExerciseType>('weight_reps')
  const [weightUnit, setWeightUnit] = useState<ExerciseWeightUnit>('default')
  const [loaded, setLoaded] = useState(!params.id)
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
    if (saved) router.back()
  }

  const remove = async (): Promise<void> => {
    setDeleting(false)
    if (existing && await gym.deleteExercise(existing.id)) router.dismissTo('/gym')
  }

  return <>
    <Stack.Screen options={{
      title: existing ? 'Update exercise' : 'New exercise',
      headerRight: () => <HeaderIcon label="Save exercise" onPress={() => void save()}><Check color={color.text} size={24} /></HeaderIcon>
    }} />
    <GymGate>
      <KeyboardScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Field label="NAME">
          <TextInput value={name} onChangeText={setName} autoFocus={!params.id && !params.name} placeholder="Barbell Squat" placeholderTextColor={color.textFaint} className={inputClass} />
        </Field>
        <Field label="NOTES (OPTIONAL)">
          <TextInput value={notes} onChangeText={setNotes} multiline maxLength={1000} placeholder="Seat height, grip, cues" placeholderTextColor={color.textFaint} className={`${inputClass} min-h-[80px]`} textAlignVertical="top" />
        </Field>
        <Field label="CATEGORY">
          <View className="flex-row items-center gap-3">
            <Select label={category?.name ?? 'Choose a category'} swatch={category?.color} onPress={() => setPicker('category')} />
            <Pressable accessibilityRole="button" accessibilityLabel="New category" onPress={() => setCreatingCategory(true)} className="h-[52px] w-[52px] items-center justify-center rounded-xl border border-input active:bg-surface-800">
              <Plus color={color.text} size={22} />
            </Pressable>
          </View>
        </Field>
        <Field label="TYPE">
          <Select label={EXERCISE_TYPE_LABELS[type]} disabled={locked} onPress={() => setPicker('type')} />
          {locked && <Text className="mt-2 text-[14px] leading-5 text-muted-foreground">The type stays fixed once sets are logged, so old sets keep their meaning.</Text>}
        </Field>
        {usesWeight(type) && <Field label="WEIGHT UNIT">
          <Select label={UNIT_LABELS[weightUnit]} onPress={() => setPicker('unit')} />
          <Text className="mt-2 text-[14px] leading-5 text-muted-foreground">Sets logged in another unit are converted for display.</Text>
        </Field>}
        {problem && <Text className="mb-4 text-[15px] text-destructive">{problem}</Text>}
        <Button size="lg" disabled={gym.writing} onPress={() => void save()}><Text>{existing ? 'Save changes' : 'Create exercise'}</Text></Button>
        {existing && <Button variant="outline" size="lg" onPress={() => setDeleting(true)} className="mt-3 border-destructive/40">
          <Trash2 color={color.destructive} size={18} />
          <Text className="text-destructive">Delete exercise</Text>
        </Button>}
      </KeyboardScrollView>
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
      hideNavigation={false}
      onCancel={() => setDeleting(false)}
      onConfirm={() => void remove()}
    />
  </>
}
