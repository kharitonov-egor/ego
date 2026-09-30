import React, { useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { GYM_CATEGORY_COLORS } from '@ego/core'
import { useGym } from '../../lib/gym-context'
import { planNameProblem } from '../../lib/gym/plans'
import type { GymCategoryView } from '../../lib/repositories/gym'
import { BottomSheet, inputClass } from '../money/Common'
import { color } from '../money/tokens'
import { Button } from '../ui/button'
import { Text } from '../ui/text'
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
}): React.ReactElement {
  return <BottomSheet visible={visible} title={title} onClose={onClose} dismissOnBackdrop>
    {options.map((option) => {
      const selected = option.value === value
      return <Pressable
        key={option.value}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          onPick(option.value)
          onClose()
        }}
        className="min-h-14 flex-row items-center border-b border-surface-900 py-2 active:bg-surface-900"
      >
        {option.swatch && <View className="mr-3"><Dot color={option.swatch} size={12} /></View>}
        <View className="flex-1">
          <Text className={`text-[17px] ${selected ? 'font-semibold' : ''}`}>{option.label}</Text>
          {option.detail && <Text className="text-[14px] text-muted-foreground">{option.detail}</Text>}
        </View>
        {selected && <Check color={color.text} size={19} />}
      </Pressable>
    })}
  </BottomSheet>
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
}): React.ReactElement {
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

  return <BottomSheet visible={visible} title={category ? 'Edit category' : 'New category'} onClose={onClose}>
    <Text className="mb-2 text-[15px] font-medium text-surface-200">Name</Text>
    <TextInput
      value={name}
      onChangeText={setName}
      autoFocus={!category}
      placeholder="Forearms"
      placeholderTextColor={color.textFaint}
      className={inputClass}
    />
    <Text className="mb-2 mt-5 text-[15px] font-medium text-surface-200">Color on the calendar</Text>
    <View className="flex-row flex-wrap gap-3">
      {GYM_CATEGORY_COLORS.map((option) => <Pressable
        key={option}
        accessibilityRole="button"
        accessibilityLabel={`Color ${option}`}
        accessibilityState={{ selected: option === swatch }}
        onPress={() => setSwatch(option)}
        className={`h-12 w-12 items-center justify-center rounded-full border-2 ${option === swatch ? 'border-white' : 'border-transparent'}`}
      ><Dot color={option} size={32} /></Pressable>)}
    </View>
    {problem && <Text className="mt-4 text-[15px] text-destructive">{problem}</Text>}
    <Button size="lg" disabled={gym.writing} onPress={() => void save()} className="mt-6"><Text>Save category</Text></Button>
  </BottomSheet>
}

/** Names a new plan made from a logged day. */
export function PlanNameSheet({ visible, onClose, onSave }: {
  visible: boolean
  onClose: () => void
  onSave: (name: string) => void
}): React.ReactElement {
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

  return <BottomSheet visible={visible} title="Save as plan" onClose={onClose}>
    <Text className="mb-2 text-[15px] font-medium text-surface-200">Name</Text>
    <TextInput
      value={name}
      onChangeText={setName}
      autoFocus
      maxLength={60}
      placeholder="Push day"
      placeholderTextColor={color.textFaint}
      onSubmitEditing={save}
      className={inputClass}
    />
    <Text className="mt-2 text-[14px] leading-5 text-muted-foreground">The plan keeps this day's exercises, their order, and supersets. Sets stay with the day.</Text>
    {problem && <Text className="mt-4 text-[15px] text-destructive">{problem}</Text>}
    <Button size="lg" disabled={gym.writing} onPress={save} className="mt-6"><Text>Save plan</Text></Button>
  </BottomSheet>
}

export function CommentSheet({ visible, initial, onClose, onSave }: {
  visible: boolean
  initial: string
  onClose: () => void
  onSave: (comment: string) => void
}): React.ReactElement {
  const [draft, setDraft] = useState(initial)
  useEffect(() => {
    if (visible) setDraft(initial)
  }, [visible, initial])
  return <BottomSheet visible={visible} title="Set comment" onClose={onClose}>
    <TextInput
      value={draft}
      onChangeText={setDraft}
      autoFocus
      multiline
      maxLength={500}
      placeholder="Spotter helped with the last two"
      placeholderTextColor={color.textFaint}
      className={`${inputClass} min-h-[96px]`}
      textAlignVertical="top"
    />
    <View className="mt-5 flex-row gap-3">
      {initial !== '' && <Button variant="outline" size="lg" onPress={() => onSave('')} className="flex-1"><Text>Remove</Text></Button>}
      <Button size="lg" onPress={() => onSave(draft.trim())} className="flex-1"><Text>Save comment</Text></Button>
    </View>
  </BottomSheet>
}
