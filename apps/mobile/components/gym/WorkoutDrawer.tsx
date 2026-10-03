import React, { useEffect, useRef, useState } from 'react'
import { Animated, Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowDown, ArrowUp, EllipsisVertical, House, Link2, Plus, Trash2, Unlink
} from 'lucide-react-native'
import { linkSuperset, supersetOf, withoutSuperset } from '@ego/core'
import { useGym } from '../../lib/gym-context'
import { setCountLabel } from '@ego/local/gym/format'
import type { GymDay } from '@ego/local/repositories/gym'
import { moveItem } from '../../lib/utils'
import { ConfirmDialog } from '../money/Common'
import { color, useReducedMotion } from '../money/tokens'
import { Text } from '../ui/text'
import { PickerSheet } from './sheets'
import { MenuSheet, type MenuItem } from './ui'

function Action({ Icon, label, onPress }: { Icon: typeof Plus; label: string; onPress: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="button" onPress={onPress} className="min-h-14 flex-row items-center px-5 active:bg-surface-800">
    <Icon color={color.textSecondary} size={20} />
    <Text className="ml-4 text-[15px] font-bold tracking-wide">{label}</Text>
  </Pressable>
}

/** FitNotes' side panel: the day's exercises, their order, and their supersets. */
export function WorkoutDrawer({ visible, day, currentId, onClose, onSelect, onAddExercise, onHome }: {
  visible: boolean
  day: GymDay | null
  currentId: string
  onClose: () => void
  onSelect: (exerciseId: string) => void
  onAddExercise: () => void
  onHome: () => void
}): React.ReactElement {
  const gym = useGym()
  const { width } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const reducedMotion = useReducedMotion()
  const panel = Math.min(360, Math.round(width * 0.82))
  const offset = useRef(new Animated.Value(-panel)).current
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [pairingFor, setPairingFor] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) return
    if (reducedMotion) offset.setValue(0)
    else {
      offset.setValue(-panel)
      Animated.timing(offset, { toValue: 0, duration: 180, useNativeDriver: true }).start()
    }
  }, [visible])

  const exercises = day?.exercises ?? []
  const supersets = day?.supersets ?? []
  const ids = exercises.map((item) => item.exercise.id)
  const nameOf = (id: string): string => exercises.find((item) => item.exercise.id === id)?.exercise.name ?? ''

  const menuItems = (id: string): MenuItem[] => {
    const index = ids.indexOf(id)
    const group = supersetOf(supersets, id)
    const items: MenuItem[] = [
      { label: 'Move up', Icon: ArrowUp, disabled: index <= 0, onPress: () => void gym.arrange(day!.date, (current) => ({ ...current, exerciseOrder: moveItem(current.exerciseOrder, index, index - 1) })) },
      { label: 'Move down', Icon: ArrowDown, disabled: index === -1 || index >= ids.length - 1, onPress: () => void gym.arrange(day!.date, (current) => ({ ...current, exerciseOrder: moveItem(current.exerciseOrder, index, index + 1) })) },
      { label: 'Add to superset', Icon: Link2, disabled: ids.length < 2, onPress: () => setPairingFor(id) }
    ]
    if (group) items.push({ label: 'Remove from superset', Icon: Unlink, onPress: () => void gym.arrange(day!.date, (current) => ({ ...current, supersets: withoutSuperset(current.supersets, id) })) })
    items.push({ label: 'Delete from this workout', Icon: Trash2, destructive: true, onPress: () => setRemoving(id) })
    return items
  }

  const pairWith = (other: string): void => {
    const first = pairingFor
    if (!first || !day) return
    void gym.arrange(day.date, (current) => linkSuperset(current, first, other))
  }

  const removeFromWorkout = async (): Promise<void> => {
    const id = removing
    setRemoving(null)
    const item = exercises.find((entry) => entry.exercise.id === id)
    if (!item || !day) return
    const exerciseId = item.exercise.id
    if (item.sets.length > 0 && !await gym.deleteSets(item.sets.map((set) => set.id))) return
    if (day.workout?.exerciseOrder.includes(exerciseId) || supersetOf(supersets, exerciseId)) {
      await gym.arrange(day.date, (current) => ({
        exerciseOrder: current.exerciseOrder.filter((entry) => entry !== exerciseId),
        supersets: withoutSuperset(current.supersets, exerciseId)
      }))
    }
    if (exerciseId === currentId) onClose()
  }

  const removingSets = exercises.find((entry) => entry.exercise.id === removing)?.sets.length ?? 0

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <View className="flex-1 flex-row">
      <Animated.View style={{ width: panel, transform: [{ translateX: offset }] }}>
        <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }} className="flex-1 border-r border-border bg-card">
          <View className="border-b border-border px-5 pb-4 pt-5">
            <Text accessibilityRole="header" className="text-[17px] font-bold tracking-wide">{`${exercises.length} ${exercises.length === 1 ? 'EXERCISE' : 'EXERCISES'}`}</Text>
            <Text className="mt-0.5 text-[14px] text-muted-foreground">Hold an exercise to reorder or superset it</Text>
          </View>
          <ScrollView className="flex-1">
            {exercises.map((item, index) => {
              const id = item.exercise.id
              const group = supersetOf(supersets, id)
              const joinsPrevious = group !== null && index > 0 && group.includes(ids[index - 1])
              const joinsNext = group !== null && index < ids.length - 1 && group.includes(ids[index + 1])
              const current = id === currentId
              return <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: current }}
                accessibilityHint="Opens this exercise. Hold for more options."
                onPress={() => {
                  onSelect(id)
                  onClose()
                }}
                onLongPress={() => setMenuFor(id)}
                className={`min-h-[64px] flex-row items-center pr-2 ${current ? 'bg-surface-800' : 'active:bg-surface-900'}`}
              >
                <View className="w-5 self-stretch items-center">
                  {group && <View style={{
                    position: 'absolute', left: 8, width: 3, top: joinsPrevious ? 0 : 14, bottom: joinsNext ? 0 : 14,
                    backgroundColor: color.text, borderRadius: 2
                  }} />}
                </View>
                <View className="flex-1 py-2">
                  <Text numberOfLines={2} className={`text-[16px] ${current ? 'font-semibold' : ''}`}>{item.exercise.name}</Text>
                  <Text className="text-[14px] text-muted-foreground">{setCountLabel(item.sets.length)}{group ? ', superset' : ''}</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${item.exercise.name}`} onPress={() => setMenuFor(id)} hitSlop={6} className="h-11 w-11 items-center justify-center rounded-full active:bg-surface-700">
                  <EllipsisVertical color={color.textMuted} size={20} />
                </Pressable>
              </Pressable>
            })}
            {exercises.length === 0 && <Text className="px-5 py-6 text-[15px] leading-6 text-muted-foreground">Nothing logged this day yet. Save a set or start a plan and it shows up here.</Text>}
          </ScrollView>
          <View className="border-t border-border bg-surface-900">
            <Action Icon={Plus} label="ADD EXERCISE" onPress={() => { onClose(); onAddExercise() }} />
            <Action Icon={Link2} label="ADD TO SUPERSET" onPress={() => setPairingFor(currentId)} />
            <Action Icon={House} label="HOME" onPress={() => { onClose(); onHome() }} />
          </View>
        </View>
      </Animated.View>
      <Pressable accessibilityLabel="Close the workout panel" onPress={onClose} className="flex-1 bg-black/60" />
    </View>

    <MenuSheet visible={menuFor !== null} title={menuFor ? nameOf(menuFor) : ''} items={menuFor ? menuItems(menuFor) : []} onClose={() => setMenuFor(null)} />
    <PickerSheet
      visible={pairingFor !== null}
      title={`Superset with ${pairingFor ? nameOf(pairingFor) || 'this exercise' : ''}`}
      options={exercises.filter((item) => item.exercise.id !== pairingFor).map((item) => ({
        value: item.exercise.id, label: item.exercise.name, detail: setCountLabel(item.sets.length)
      }))}
      value={null}
      onPick={pairWith}
      onClose={() => setPairingFor(null)}
    />
    <ConfirmDialog
      visible={removing !== null}
      title={removingSets > 0 ? 'Delete from this workout?' : 'Remove from this workout?'}
      detail={removingSets > 0
        ? `The ${removing ? nameOf(removing) : ''} sets logged this day are deleted. Other days keep theirs.`
        : `${removing ? nameOf(removing) : 'It'} leaves this day's list.`}
      confirmLabel={removingSets > 0 ? 'Delete sets' : 'Remove'}
      destructive
      hideNavigation={false}
      onCancel={() => setRemoving(null)}
      onConfirm={() => void removeFromWorkout()}
    />
  </Modal>
}
