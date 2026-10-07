import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Plus, Target } from 'lucide-react'
import type { TaskGoalInput } from '@ego/core'
import { Screen, ScreenBody, ScreenHeader, TabLinks } from '../../components/screen'
import { GoalCard, GoalSheet } from '../../components/tasks/goals'
import { TasksError, TasksGate } from '../../components/tasks/ui'
import { Button, IconButton } from '../../components/ui/button'
import { SegmentedControl } from '../../components/ui/segmented-control'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { TASKS_TABS, goalPath } from './nav'

type GoalFilter = 'active' | 'someday' | 'all'

const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'someday', label: 'Someday' },
  { value: 'all', label: 'All' }
] as const

function Goals(): React.ReactElement {
  const tasks = useTasks()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<GoalFilter>('active')
  const [creating, setCreating] = useState(false)

  const goals = useMemo(() => {
    const all = [...(tasks.data?.goals ?? [])].filter((goal) => goal.archivedAt === null).sort((left, right) => left.position - right.position)
    if (filter === 'all') return all
    if (filter === 'someday') return all.filter((goal) => goal.status === 'someday' || goal.horizon === 'someday')
    return all.filter((goal) => goal.status === 'active' && goal.horizon !== 'someday')
  }, [filter, tasks.data?.goals])
  const boards = useMemo(() => tasks.data?.boards.filter((board) => board.archivedAt === null) ?? [], [tasks.data?.boards])
  const cards = useMemo(() => tasks.data?.cards.filter((card) => card.archivedAt === null && card.doneAt === null) ?? [], [tasks.data?.cards])

  const create = (input: TaskGoalInput): void => {
    setCreating(false)
    void tasks.createGoal(input).then((id) => { if (id) void navigate(goalPath(id)) })
  }

  return <Screen>
    <ScreenHeader title="Goals" tabs={<TabLinks items={TASKS_TABS} />} right={
      <IconButton label="New goal" onClick={() => setCreating(true)}><Plus size={23} /></IconButton>
    } />
    <ScreenBody width="medium" className="pb-9">
      <TasksError className="mb-3" />
      <div className="mb-5">
        <h2 className="text-[27px] font-bold tracking-tight text-white">Goals</h2>
        <p className="mt-1 text-[15px] leading-5 text-surface-400">Outcomes that give your task boards somewhere to go.</p>
      </div>
      <SegmentedControl options={FILTERS} value={filter} onValueChange={setFilter} className="max-w-md" />
      {goals.length === 0
        ? <div className="flex flex-col items-center px-5 py-16 text-center">
          <Target color={color.textMuted} size={34} />
          <h3 className="mt-3 text-[20px] font-semibold text-surface-100">No goals here yet</h3>
          <p className="mt-2 max-w-md text-[15px] leading-6 text-surface-400">Write the outcome first. Link the boards and next actions that can move it forward.</p>
          <Button className="mt-5" onClick={() => setCreating(true)}><Plus color="#0a0a0a" size={18} />Create a goal</Button>
        </div>
        : <div className="mt-4 grid gap-3 lg:grid-cols-2">{goals.map((goal) => <GoalCard
          key={goal.id}
          goal={goal}
          boards={boards}
          cards={cards}
          onPress={() => { void navigate(goalPath(goal.id)) }}
        />)}</div>}
    </ScreenBody>
    <GoalSheet visible={creating} goal={null} onSave={create} onClose={() => setCreating(false)} />
  </Screen>
}

export default function GoalsScreen(): React.ReactElement {
  return <TasksGate title="Goals" tabs={<TabLinks items={TASKS_TABS} />}><Goals /></TasksGate>
}
