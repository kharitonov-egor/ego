import React, { useLayoutEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { Ellipsis, Flag, Link2, ListChecks, Pencil, Plus, Target, Trash2 } from 'lucide-react-native'
import { goalProgress, type TaskGoalInput } from '@ego/core'
import { GOAL_HORIZON_LABELS, GOAL_STATUS_LABELS, GoalLinkSheet, GoalSheet, MilestoneRow } from '../../../components/tasks/goals'
import { TasksError, TasksGate, TasksHeaderRight, TasksMessage, SectionTitle } from '../../../components/tasks/ui'
import { HeaderIcon, MenuSheet } from '../../../components/gym/ui'
import { ConfirmDialog } from '../../../components/money/Common'
import { color } from '../../../components/money/tokens'
import { Button } from '../../../components/ui/button'
import { Text as UiText } from '../../../components/ui/text'
import { TextSheet } from '../../../components/tasks/sheets'
import { formatIso } from '../../../lib/dates'
import { newId } from '../../../lib/sync/commands'
import { useTasks } from '../../../lib/tasks/context'

function GoalDetail({ goalId }: { goalId: string }): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const navigation = useNavigation()
  const goal = tasks.data?.goals?.find((item) => item.id === goalId)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [addingMilestone, setAddingMilestone] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useLayoutEffect(() => {
    navigation.setOptions({
      title: goal?.title ?? 'Goal',
      headerRight: () => <TasksHeaderRight><HeaderIcon label="Goal menu" onPress={() => setMenu(true)}><Ellipsis color="#fafafa" size={22} /></HeaderIcon></TasksHeaderRight>
    })
  }, [goal?.title, navigation])

  const boards = useMemo(() => tasks.data?.boards.filter((board) => board.archivedAt === null) ?? [], [tasks.data?.boards])
  const cards = useMemo(() => tasks.data?.cards.filter((card) => card.archivedAt === null && card.doneAt === null) ?? [], [tasks.data?.cards])
  if (!tasks.data || !goal) return <TasksMessage Icon={Target} title="This goal is gone" detail="It was deleted, maybe on another device." action="Back to goals" onAction={() => router.back()} />

  const { done, total } = goalProgress(goal)
  const toggleMilestone = (milestoneId: string): void => {
    void tasks.updateGoal(goal.id, (input) => ({ ...input, milestones: input.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, doneAt: milestone.doneAt ? null : new Date().toISOString() } : milestone) }))
  }
  const addMilestone = (title: string): void => {
    setAddingMilestone(false)
    const trimmed = title.trim()
    if (!trimmed) return
    void tasks.updateGoal(goal.id, (input) => ({ ...input, milestones: [...input.milestones, { id: newId(), title: trimmed, dueDate: null, doneAt: null }] }))
  }
  const saveEdits = (input: TaskGoalInput): void => {
    setEditing(false)
    void tasks.updateGoal(goal.id, () => input)
  }

  return <View className="flex-1 bg-surface-950">
    <TasksError />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 52 }}>
      <View className="rounded-3xl border-2 border-white bg-black p-5">
        <View className="flex-row items-start">
          <View className="h-12 w-12 items-center justify-center rounded-2xl border border-surface-700 bg-surface-900"><Target color="#fafafa" size={23} /></View>
          <View className="ml-3 flex-1">
            <Text className="text-[24px] font-bold leading-8 text-white">{goal.title}</Text>
            <Text className="mt-1 text-[14px] font-semibold uppercase tracking-wide text-surface-500">{GOAL_HORIZON_LABELS[goal.horizon]}</Text>
          </View>
        </View>
        {goal.why.trim() !== '' && <Text className="mt-4 text-[16px] leading-6 text-surface-300">{goal.why}</Text>}
        <View className="mt-5 flex-row flex-wrap gap-2">
          <View className="rounded-full bg-surface-900 px-3 py-1.5"><Text className="text-[13px] text-surface-200">{GOAL_STATUS_LABELS[goal.status]}</Text></View>
          {goal.targetDate && <View className="rounded-full bg-surface-900 px-3 py-1.5"><Text className="text-[13px] text-surface-200">Target {formatIso(goal.targetDate)}</Text></View>}
          {goal.reviewDate && <View className="rounded-full bg-surface-900 px-3 py-1.5"><Text className="text-[13px] text-surface-200">Review {formatIso(goal.reviewDate)}</Text></View>}
        </View>
      </View>

      <SectionTitle Icon={ListChecks} title="Checkpoints" right={<Text className="text-[14px] text-surface-500">{done} of {total}</Text>} />
      <View className="rounded-2xl border border-surface-800 bg-card px-4">
        {goal.milestones.map((milestone) => <MilestoneRow key={milestone.id} title={milestone.title} dueDate={milestone.dueDate} done={milestone.doneAt !== null} onToggle={() => toggleMilestone(milestone.id)} />)}
        <Pressable accessibilityRole="button" onPress={() => setAddingMilestone(true)} className="min-h-14 flex-row items-center"><Plus color={color.textMuted} size={18} /><Text className="ml-2 text-[15px] font-semibold text-surface-300">Add checkpoint</Text></Pressable>
      </View>

      <SectionTitle Icon={Link2} title="Linked work" right={<Pressable accessibilityRole="button" onPress={() => setLinking(true)} hitSlop={8}><Text className="text-[15px] font-semibold text-white">Edit</Text></Pressable>} />
      <View className="rounded-2xl border border-surface-800 bg-card p-4">
        {goal.boardIds.length === 0 && goal.cardIds.length === 0
          ? <Text className="text-[15px] leading-5 text-surface-500">No boards or next actions linked yet.</Text>
          : <>
            {goal.boardIds.map((boardId) => {
              const board = boards.find((item) => item.id === boardId)
              return board ? <View key={board.id} className="mb-2 flex-row items-center"><Target color={color.textMuted} size={16} /><Text className="ml-2 text-[15px] text-surface-200">{[board.icon, board.name].filter(Boolean).join(' ')}</Text></View> : null
            })}
            {goal.cardIds.map((cardId) => {
              const card = tasks.data?.cards.find((item) => item.id === cardId)
              return card ? <Pressable key={card.id} accessibilityRole="button" onPress={() => router.push({ pathname: '/tasks/card/[id]', params: { id: card.id } })} className="mb-2 flex-row items-center"><Flag color={color.textMuted} size={16} /><Text numberOfLines={1} className="ml-2 flex-1 text-[15px] text-surface-200">{card.title}</Text></Pressable> : null
            })}
          </>}
        <Button variant="outline" className="mt-2" onPress={() => setLinking(true)}><Link2 color="#fafafa" size={17} /><UiText>{goal.boardIds.length + goal.cardIds.length === 0 ? 'Link boards or actions' : 'Change links'}</UiText></Button>
      </View>

      <View className="mt-6 rounded-2xl border border-surface-800 bg-surface-900/50 p-4">
        <Text className="text-[13px] font-semibold uppercase tracking-wide text-surface-500">Keep it moving</Text>
        <Text className="mt-2 text-[15px] leading-5 text-surface-300">A goal stays useful when it has one visible next action and a date to review it.</Text>
        {goal.cardIds.length === 0 && <Button variant="outline" className="mt-3" onPress={() => setLinking(true)}><UiText>Choose a next action</UiText></Button>}
      </View>
    </ScrollView>

    <MenuSheet visible={menu} title={goal.title} onClose={() => setMenu(false)} items={[
      { label: 'Edit goal', Icon: Pencil, onPress: () => setEditing(true) },
      { label: 'Link work', Icon: Link2, onPress: () => setLinking(true) },
      { label: 'Delete goal', Icon: Trash2, destructive: true, onPress: () => setDeleting(true) }
    ]} />
    <GoalSheet visible={editing} goal={goal} onSave={saveEdits} onClose={() => setEditing(false)} />
    <GoalLinkSheet
      visible={linking}
      goal={goal}
      boards={boards}
      cards={cards}
      onToggleBoard={(boardId) => void tasks.updateGoal(goal.id, (input) => ({ ...input, boardIds: input.boardIds.includes(boardId) ? input.boardIds.filter((id) => id !== boardId) : [...input.boardIds, boardId] }))}
      onToggleCard={(cardId) => void tasks.updateGoal(goal.id, (input) => ({ ...input, cardIds: input.cardIds.includes(cardId) ? input.cardIds.filter((id) => id !== cardId) : [...input.cardIds, cardId] }))}
      onClose={() => setLinking(false)}
    />
    <TextSheet visible={addingMilestone} title="Add checkpoint" value="" placeholder="Checkpoint" confirm="Add" onClose={() => setAddingMilestone(false)} onSave={addMilestone} />
    <ConfirmDialog visible={deleting} title="Delete this goal?" detail="Its checkpoints and links go with it. The task boards and cards stay untouched." confirmLabel="Delete" destructive hideNavigation={false} onCancel={() => setDeleting(false)} onConfirm={() => { setDeleting(false); router.back(); void tasks.deleteGoal(goal.id) }} />
  </View>
}

export default function GoalScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <TasksGate><GoalDetail goalId={id} /></TasksGate>
}
