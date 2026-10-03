import React, { useLayoutEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { Plus, Target } from 'lucide-react-native'
import { useNavigation, useRouter } from 'expo-router'
import type { TaskGoalInput } from '@ego/core'
import { HeaderIcon } from '../../../components/gym/ui'
import { GoalCard, GoalSheet } from '../../../components/tasks/goals'
import { TasksError, TasksGate, TasksHeaderRight, TasksMessage } from '../../../components/tasks/ui'
import { SegmentedControl } from '../../../components/ui/segmented-control'
import { color } from '../../../components/money/tokens'
import { useTasks } from '../../../lib/tasks/context'

type GoalFilter = 'active' | 'someday' | 'all'

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'someday', label: 'Someday' },
  { value: 'all', label: 'All' }
] as const

function Goals(): React.ReactElement {
  const tasks = useTasks()
  const router = useRouter()
  const navigation = useNavigation()
  const [filter, setFilter] = useState<GoalFilter>('active')
  const [creating, setCreating] = useState(false)
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <TasksHeaderRight><HeaderIcon label="New goal" onPress={() => setCreating(true)}><Plus color="#fafafa" size={24} /></HeaderIcon></TasksHeaderRight>
    })
  }, [navigation])

  const goals = useMemo(() => {
    const all = [...(tasks.data?.goals ?? [])].filter((goal) => goal.archivedAt === null).sort((left, right) => left.position - right.position)
    if (filter === 'all') return all
    if (filter === 'someday') return all.filter((goal) => goal.status === 'someday' || goal.horizon === 'someday')
    return all.filter((goal) => goal.status === 'active' && goal.horizon !== 'someday')
  }, [filter, tasks.data?.goals])

  const create = (input: TaskGoalInput): void => {
    setCreating(false)
    void tasks.createGoal(input).then((id) => { if (id) router.push({ pathname: '/tasks/goal/[id]', params: { id } }) })
  }

  if (!tasks.data) return <TasksMessage Icon={Target} title="Loading goals" detail="Goals live beside your task boards and use the same offline copy." />
  return <View className="flex-1 bg-surface-950">
    <TasksError />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 36 }}>
      <View className="mb-5">
        <Text className="text-[27px] font-bold tracking-tight text-white">Goals</Text>
        <Text className="mt-1 text-[15px] leading-5 text-surface-400">Outcomes that give your task boards somewhere to go.</Text>
      </View>
      <SegmentedControl options={FILTERS} value={filter} onValueChange={setFilter} />
      {goals.length === 0
        ? <View className="items-center px-5 py-16">
          <Target color={color.textMuted} size={34} />
          <Text className="mt-3 text-center text-[20px] font-semibold text-surface-100">No goals here yet</Text>
          <Text className="mt-2 text-center text-[15px] leading-6 text-surface-400">Write the outcome first. Link the boards and next actions that can move it forward.</Text>
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} className="mt-5 min-h-12 flex-row items-center rounded-xl bg-primary px-4 active:opacity-80">
            <Plus color="#0a0a0a" size={18} /><Text className="ml-2 text-[15px] font-semibold text-primary-foreground">Create a goal</Text>
          </Pressable>
        </View>
        : <View className="gap-3">{goals.map((goal) => <GoalCard
          key={goal.id}
          goal={goal}
          boards={tasks.data?.boards.filter((board) => board.archivedAt === null) ?? []}
          cards={tasks.data?.cards.filter((card) => card.archivedAt === null && card.doneAt === null) ?? []}
          onPress={() => router.push({ pathname: '/tasks/goal/[id]', params: { id: goal.id } })}
        />)}</View>}
    </ScrollView>
    <GoalSheet visible={creating} goal={null} onSave={create} onClose={() => setCreating(false)} />
  </View>
}

export default function GoalsScreen(): React.ReactElement {
  return <TasksGate><Goals /></TasksGate>
}
