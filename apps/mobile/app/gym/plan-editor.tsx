import React, { useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { KeyboardScrollView } from '../../components/ui/keyboard'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowDown, ArrowUp, Check, EllipsisVertical, Link2, Plus, Search, Trash2, Unlink, X
} from 'lucide-react-native'
import { linkSuperset, supersetOf, withoutSuperset, type GymArrangement } from '@ego/core'
import { BottomSheet, ConfirmDialog, inputClass } from '../../components/money/Common'
import { color } from '../../components/money/tokens'
import { PickerSheet } from '../../components/gym/sheets'
import { Dot, GymGate, HeaderIcon, MenuSheet, SectionLabel, type MenuItem } from '../../components/gym/ui'
import { Button } from '../../components/ui/button'
import { Text } from '../../components/ui/text'
import { exerciseCountLabel, planNameProblem } from '@ego/local/gym/plans'
import { useGym } from '../../lib/gym-context'
import { moveItem } from '../../lib/utils'

const EMPTY: GymArrangement = { exerciseOrder: [], supersets: [] }

function without(arrangement: GymArrangement, id: string): GymArrangement {
  return {
    exerciseOrder: arrangement.exerciseOrder.filter((entry) => entry !== id),
    supersets: withoutSuperset(arrangement.supersets, id)
  }
}

/** Tapping an exercise adds it to the plan or takes it out again. The sheet stays open for more. */
function ExercisePicker({ visible, chosen, onToggle, onClose }: {
  visible: boolean
  chosen: readonly string[]
  onToggle: (id: string) => void
  onClose: () => void
}): React.ReactElement {
  const gym = useGym()
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible])
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle ? gym.exercises.filter((exercise) => exercise.name.toLocaleLowerCase().includes(needle)) : gym.exercises
  return <BottomSheet visible={visible} title="Add exercises" onClose={onClose} dismissOnBackdrop>
    <View className="mb-2 flex-row items-center rounded-xl border border-input bg-surface-900 px-3">
      <Search color={color.textFaint} size={18} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises"
        placeholderTextColor={color.textFaint}
        autoCorrect={false}
        className="ml-2 min-h-[48px] flex-1 text-[17px] text-foreground"
      />
      {needle !== '' && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}><X color={color.textMuted} size={18} /></Pressable>}
    </View>
    {shown.map((exercise) => {
      const selected = chosen.includes(exercise.id)
      return <Pressable
        key={exercise.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected }}
        onPress={() => onToggle(exercise.id)}
        className="min-h-14 flex-row items-center border-b border-surface-900 py-2 active:bg-surface-900"
      >
        <View className="mr-3"><Dot color={exercise.categoryColor} size={10} /></View>
        <View className="flex-1">
          <Text className={`text-[17px] ${selected ? 'font-semibold' : ''}`}>{exercise.name}</Text>
          <Text className="text-[14px] text-muted-foreground">{exercise.categoryName}</Text>
        </View>
        {selected && <Check color={color.text} size={19} />}
      </Pressable>
    })}
    {shown.length === 0 && <Text className="py-6 text-center text-[16px] text-muted-foreground">Nothing called "{query.trim()}".</Text>}
  </BottomSheet>
}

export default function PlanEditor(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>()
  const gym = useGym()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const existing = params.id ? gym.plans.find((plan) => plan.id === params.id) ?? null : null
  const [name, setName] = useState('')
  const [arrangement, setArrangement] = useState<GymArrangement>(EMPTY)
  const [loaded, setLoaded] = useState(!params.id)
  const [adding, setAdding] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pairingFor, setPairingFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (loaded || !existing) return
    const live = new Set(gym.exercises.map((exercise) => exercise.id))
    setName(existing.name)
    setArrangement({
      exerciseOrder: existing.exerciseOrder.filter((id) => live.has(id)),
      supersets: existing.supersets.map((group) => group.filter((id) => live.has(id))).filter((group) => group.length >= 2)
    })
    setLoaded(true)
  }, [existing, gym.exercises, loaded])

  const byId = new Map(gym.exercises.map((exercise) => [exercise.id, exercise]))
  const items = arrangement.exerciseOrder.flatMap((id) => {
    const exercise = byId.get(id)
    return exercise ? [exercise] : []
  })
  const ids = items.map((exercise) => exercise.id)
  const nameOf = (id: string): string => byId.get(id)?.name ?? ''

  const toggle = (id: string): void => setArrangement((current) => current.exerciseOrder.includes(id)
    ? without(current, id)
    : { ...current, exerciseOrder: [...current.exerciseOrder, id] })

  const shift = (id: string, by: -1 | 1): void => setArrangement((current) => {
    const index = current.exerciseOrder.indexOf(id)
    return { ...current, exerciseOrder: moveItem(current.exerciseOrder, index, index + by) }
  })

  const menuItems = (id: string): MenuItem[] => {
    const index = ids.indexOf(id)
    const entries: MenuItem[] = [
      { label: 'Move up', Icon: ArrowUp, disabled: index <= 0, onPress: () => shift(id, -1) },
      { label: 'Move down', Icon: ArrowDown, disabled: index === -1 || index >= ids.length - 1, onPress: () => shift(id, 1) },
      { label: 'Add to superset', Icon: Link2, disabled: ids.length < 2, onPress: () => setPairingFor(id) }
    ]
    if (supersetOf(arrangement.supersets, id)) {
      entries.push({
        label: 'Remove from superset',
        Icon: Unlink,
        onPress: () => setArrangement((current) => ({ ...current, supersets: withoutSuperset(current.supersets, id) }))
      })
    }
    entries.push({ label: 'Remove from plan', Icon: Trash2, destructive: true, onPress: () => setArrangement((current) => without(current, id)) })
    return entries
  }

  const save = async (): Promise<void> => {
    const issue = planNameProblem(name, gym.plans, existing?.id ?? null)
    if (issue) return setProblem(issue)
    if (ids.length === 0) return setProblem('Add at least one exercise')
    setProblem(null)
    const saved = await gym.savePlan(existing?.id ?? null, {
      name: name.trim(),
      exerciseOrder: ids,
      supersets: arrangement.supersets.map((group) => group.filter((id) => byId.has(id))).filter((group) => group.length >= 2)
    })
    if (saved) router.back()
  }

  const remove = async (): Promise<void> => {
    setDeleting(false)
    if (existing && await gym.deletePlan(existing.id)) router.back()
  }

  const gone = Boolean(params.id) && !existing && gym.exercises.length > 0

  return <>
    <Stack.Screen options={{
      title: params.id ? 'Edit plan' : 'New plan',
      headerRight: () => gone ? null : <HeaderIcon label="Save plan" onPress={() => void save()}><Check color={color.text} size={24} /></HeaderIcon>
    }} />
    <GymGate>
      {gone
        ? <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-[18px] font-semibold">This plan is gone</Text>
          <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">It was deleted, possibly on another device.</Text>
          <Button onPress={() => router.back()} className="mt-5"><Text>Back to plans</Text></Button>
        </View>
        : <KeyboardScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          <SectionLabel>NAME</SectionLabel>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus={!params.id}
            maxLength={60}
            placeholder="Push day"
            placeholderTextColor={color.textFaint}
            className={`${inputClass} mb-7 mt-3`}
          />
          <SectionLabel right={items.length > 0 ? <Text className="text-[14px] text-muted-foreground">{exerciseCountLabel(items.length)}</Text> : undefined}>EXERCISES</SectionLabel>
          {items.map((exercise, index) => {
            const group = supersetOf(arrangement.supersets, exercise.id)
            const joinsPrevious = group !== null && index > 0 && group.includes(ids[index - 1])
            const joinsNext = group !== null && index < ids.length - 1 && group.includes(ids[index + 1])
            return <Pressable
              key={exercise.id}
              accessibilityRole="button"
              accessibilityHint="Reorder, superset, or remove"
              onPress={() => setMenuFor(exercise.id)}
              className="min-h-[60px] flex-row items-center border-b border-border active:bg-surface-900"
            >
              <View className="w-5 self-stretch">
                {group && <View style={{
                  position: 'absolute', left: 6, width: 3, top: joinsPrevious ? 0 : 14, bottom: joinsNext ? 0 : 14,
                  backgroundColor: color.text, borderRadius: 2
                }} />}
              </View>
              <View className="flex-1 py-2">
                <Text className="text-[16px]">{exercise.name}</Text>
                <Text className="text-[14px] text-muted-foreground">{exercise.categoryName}{group ? ', superset' : ''}</Text>
              </View>
              <View className="h-11 w-11 items-center justify-center"><EllipsisVertical color={color.textMuted} size={20} /></View>
            </Pressable>
          })}
          <Pressable accessibilityRole="button" onPress={() => setAdding(true)} className="min-h-14 flex-row items-center active:bg-surface-900">
            <Plus color={color.textSecondary} size={19} />
            <Text className="ml-3 text-[16px] font-medium text-surface-200">Add exercises</Text>
          </Pressable>
          {problem && <Text className="mb-2 mt-4 text-[15px] text-destructive">{problem}</Text>}
          <Button size="lg" disabled={gym.writing} onPress={() => void save()} className="mt-6"><Text>{existing ? 'Save changes' : 'Create plan'}</Text></Button>
          {existing && <Button variant="outline" size="lg" onPress={() => setDeleting(true)} className="mt-3 border-destructive/40">
            <Trash2 color={color.destructive} size={18} />
            <Text className="text-destructive">Delete plan</Text>
          </Button>}
        </KeyboardScrollView>}
    </GymGate>
    <ExercisePicker visible={adding} chosen={ids} onToggle={toggle} onClose={() => setAdding(false)} />
    <MenuSheet visible={menuFor !== null} title={menuFor ? nameOf(menuFor) : ''} items={menuFor ? menuItems(menuFor) : []} onClose={() => setMenuFor(null)} />
    <PickerSheet
      visible={pairingFor !== null}
      title={`Superset with ${pairingFor ? nameOf(pairingFor) : ''}`}
      options={items.filter((exercise) => exercise.id !== pairingFor).map((exercise) => ({ value: exercise.id, label: exercise.name, detail: exercise.categoryName }))}
      value={null}
      onPick={(other) => {
        const first = pairingFor
        if (first) setArrangement((current) => linkSuperset(current, first, other))
      }}
      onClose={() => setPairingFor(null)}
    />
    <ConfirmDialog
      visible={deleting}
      title={`Delete ${existing?.name ?? 'this plan'}?`}
      detail="Days you already started from it keep their exercises and sets."
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeleting(false)}
      onConfirm={() => void remove()}
    />
  </>
}
