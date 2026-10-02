import React, { useState } from 'react'
import { FlatList, Pressable, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ClipboardList, EllipsisVertical, ListPlus, Pencil, Plus, Trash2 } from 'lucide-react-native'
import { ConfirmDialog } from '../../components/money/Common'
import { color } from '../../components/money/tokens'
import { GymGate, HeaderIcon, MenuSheet } from '../../components/gym/ui'
import { Button } from '../../components/ui/button'
import { Text } from '../../components/ui/text'
import { planExercises, startLabel } from '@ego/local/gym/plans'
import { useGym } from '../../lib/gym-context'
import type { GymPlanView } from '@ego/local/repositories/gym'

/** Named lists of exercises that can start any day's workout. */
export default function Plans(): React.ReactElement {
  const gym = useGym()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [menuFor, setMenuFor] = useState<GymPlanView | null>(null)
  const [deleting, setDeleting] = useState<GymPlanView | null>(null)

  const edit = (id?: string): void => router.push({ pathname: '/gym/plan-editor', params: id ? { id } : {} })

  const start = async (plan: GymPlanView): Promise<void> => {
    if (await gym.startPlan(gym.date, plan)) router.dismissTo('/gym')
  }

  const remove = async (): Promise<void> => {
    const target = deleting
    setDeleting(null)
    if (target) await gym.deletePlan(target.id)
  }

  return <>
    <Stack.Screen options={{
      headerRight: () => <HeaderIcon label="New plan" onPress={() => edit()}><Plus color={color.text} size={23} /></HeaderIcon>
    }} />
    <GymGate>
      <FlatList
        data={gym.plans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 24 }}
        renderItem={({ item }) => {
          const exercises = planExercises(item, gym.exercises)
          return <Pressable
            accessibilityRole="button"
            accessibilityHint="Edits this plan"
            onPress={() => edit(item.id)}
            className="min-h-[64px] flex-row items-center border-b border-border pl-4 active:bg-surface-900"
          >
            <View className="flex-1 py-2.5">
              <Text className="text-[17px] font-medium">{item.name}</Text>
              <Text numberOfLines={2} className="mt-0.5 text-[14px] leading-5 text-muted-foreground">
                {exercises.length > 0 ? exercises.map((exercise) => exercise.name).join(', ') : 'No exercises'}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${item.name}`} onPress={() => setMenuFor(item)} hitSlop={4} className="h-12 w-12 items-center justify-center active:bg-surface-800">
              <EllipsisVertical color={color.textMuted} size={20} />
            </Pressable>
          </Pressable>
        }}
        ListEmptyComponent={<View className="flex-1 items-center justify-center px-8">
          <ClipboardList color={color.textFaint} size={34} />
          <Text className="mt-3 text-center text-[20px] font-semibold">No plans yet</Text>
          <Text className="mt-2 text-center text-[16px] leading-6 text-muted-foreground">
            A plan is a list of exercises you can start on any day. To reuse a workout you already logged, open that day and pick Save day as plan from the menu.
          </Text>
          <Button size="lg" onPress={() => edit()} className="mt-6"><Plus color={color.screen} size={19} /><Text>New plan</Text></Button>
        </View>}
      />
    </GymGate>
    <MenuSheet visible={menuFor !== null} title={menuFor?.name ?? ''} onClose={() => setMenuFor(null)} items={menuFor ? [
      {
        label: startLabel(gym.date),
        Icon: ListPlus,
        disabled: planExercises(menuFor, gym.exercises).length === 0,
        onPress: () => void start(menuFor)
      },
      { label: 'Edit plan', Icon: Pencil, onPress: () => edit(menuFor.id) },
      { label: 'Delete plan', Icon: Trash2, destructive: true, onPress: () => setDeleting(menuFor) }
    ] : []} />
    <ConfirmDialog
      visible={deleting !== null}
      title={`Delete ${deleting?.name ?? 'this plan'}?`}
      detail="Days you already started from it keep their exercises and sets."
      confirmLabel="Delete"
      destructive
      hideNavigation={false}
      onCancel={() => setDeleting(null)}
      onConfirm={() => void remove()}
    />
  </>
}
