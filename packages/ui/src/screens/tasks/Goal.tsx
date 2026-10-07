import React, { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Ellipsis, Flag, Link2, ListChecks, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { goalProgress, type TaskGoalInput } from '@ego/core'
import { formatIso } from '@ego/local/dates'
import { newId } from '@ego/local/sync/commands'
import { Screen, ScreenBody, ScreenHeader } from '../../components/screen'
import { GOAL_HORIZON_LABELS, GOAL_STATUS_LABELS, GoalLinkSheet, GoalSheet, MilestoneRow } from '../../components/tasks/goals'
import { TextSheet } from '../../components/tasks/sheets'
import { MenuSheet, SectionTitle, TasksError, TasksGate, TasksMessage, TextAction } from '../../components/tasks/ui'
import { Button, IconButton } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/ui/dialog'
import { useTasks } from '../../lib/tasks/context'
import { color } from '../../lib/tokens'
import { useBack, useOpenCard } from './nav'

function Chip({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className="rounded-full bg-surface-900 px-3 py-1.5 text-[13px] text-surface-200">{children}</span>
}

function GoalDetail({ goalId }: { goalId: string }): React.ReactElement {
  const tasks = useTasks()
  const navigate = useNavigate()
  const openCard = useOpenCard()
  const back = useBack('/tasks/goals')
  const goal = tasks.data?.goals?.find((item) => item.id === goalId)
  const [menu, setMenu] = useState(false)
  const [editing, setEditing] = useState(false)
  const [linking, setLinking] = useState(false)
  const [addingMilestone, setAddingMilestone] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const boards = useMemo(() => tasks.data?.boards.filter((board) => board.archivedAt === null) ?? [], [tasks.data?.boards])
  const cards = useMemo(() => tasks.data?.cards.filter((card) => card.archivedAt === null && card.doneAt === null) ?? [], [tasks.data?.cards])
  if (!tasks.data || !goal) {
    return <Screen>
      <ScreenHeader title="Goal" back={back} />
      <div className="min-h-0 flex-1">
        <TasksMessage Icon={Target} title="This goal is gone" detail="It was deleted, maybe on another device." action="Back to goals" onAction={() => { void navigate(back) }} />
      </div>
    </Screen>
  }

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

  return <Screen>
    <ScreenHeader title={goal.title} back={back} right={
      <IconButton label="Goal menu" onClick={() => setMenu(true)}><Ellipsis size={21} /></IconButton>
    } />
    <ScreenBody width="medium" className="pb-12">
      <TasksError className="mb-3" />
      <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <section className="rounded-3xl border-2 border-white bg-black p-5">
            <div className="flex items-start">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-surface-700 bg-surface-900"><Target color="#fafafa" size={23} /></span>
              <div className="ml-3 min-w-0 flex-1">
                <h2 className="break-words text-[24px] font-bold leading-8 text-white">{goal.title}</h2>
                <p className="mt-1 text-[14px] font-semibold uppercase tracking-wide text-surface-500">{GOAL_HORIZON_LABELS[goal.horizon]}</p>
              </div>
            </div>
            {goal.why.trim() !== '' && <p className="mt-4 whitespace-pre-wrap text-[16px] leading-6 text-surface-300">{goal.why}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip>{GOAL_STATUS_LABELS[goal.status]}</Chip>
              {goal.targetDate && <Chip>Target {formatIso(goal.targetDate)}</Chip>}
              {goal.reviewDate && <Chip>Review {formatIso(goal.reviewDate)}</Chip>}
            </div>
          </section>

          <SectionTitle Icon={ListChecks} title="Checkpoints" right={<span className="tabular text-[14px] text-surface-500">{done} of {total}</span>} />
          <div className="rounded-2xl border border-surface-800 bg-card px-4">
            {goal.milestones.map((milestone) => <MilestoneRow key={milestone.id} title={milestone.title} dueDate={milestone.dueDate} done={milestone.doneAt !== null} onToggle={() => toggleMilestone(milestone.id)} />)}
            <button type="button" onClick={() => setAddingMilestone(true)} className="flex min-h-14 w-full items-center rounded-lg hover:bg-surface-900/60">
              <Plus color={color.textMuted} size={18} /><span className="ml-2 text-[15px] font-semibold text-surface-300">Add checkpoint</span>
            </button>
          </div>
        </div>

        <div className="min-w-0 lg:-mt-6">
          <SectionTitle Icon={Link2} title="Linked work" right={<TextAction onClick={() => setLinking(true)}>Edit</TextAction>} />
          <div className="rounded-2xl border border-surface-800 bg-card p-4">
            {goal.boardIds.length === 0 && goal.cardIds.length === 0
              ? <p className="text-[15px] leading-5 text-surface-500">No boards or next actions linked yet.</p>
              : <>
                {goal.boardIds.map((boardId) => {
                  const board = boards.find((item) => item.id === boardId)
                  return board ? <div key={board.id} className="mb-2 flex items-center"><Target color={color.textMuted} size={16} className="shrink-0" /><span className="ml-2 min-w-0 truncate text-[15px] text-surface-200">{[board.icon, board.name].filter(Boolean).join(' ')}</span></div> : null
                })}
                {goal.cardIds.map((cardId) => {
                  const card = tasks.data?.cards.find((item) => item.id === cardId)
                  return card ? <button key={card.id} type="button" onClick={() => openCard(card.id)} className="mb-2 flex w-full items-center rounded-md text-left hover:underline">
                    <Flag color={color.textMuted} size={16} className="shrink-0" /><span className="ml-2 min-w-0 flex-1 truncate text-[15px] text-surface-200">{card.title}</span>
                  </button> : null
                })}
              </>}
            <Button variant="outline" className="mt-2 w-full" onClick={() => setLinking(true)}><Link2 color="#fafafa" size={17} />{goal.boardIds.length + goal.cardIds.length === 0 ? 'Link boards or actions' : 'Change links'}</Button>
          </div>

          <div className="mt-6 rounded-2xl border border-surface-800 bg-surface-900/50 p-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-surface-500">Keep it moving</h3>
            <p className="mt-2 text-[15px] leading-5 text-surface-300">A goal stays useful when it has one visible next action and a date to review it.</p>
            {goal.cardIds.length === 0 && <Button variant="outline" className="mt-3 w-full" onClick={() => setLinking(true)}>Choose a next action</Button>}
          </div>
        </div>
      </div>
    </ScreenBody>

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
    <ConfirmDialog
      visible={deleting}
      title="Delete this goal?"
      detail="Its checkpoints and links go with it. The task boards and cards stay untouched."
      confirmLabel="Delete"
      destructive
      onCancel={() => setDeleting(false)}
      onConfirm={() => {
        setDeleting(false)
        void navigate(back)
        void tasks.deleteGoal(goal.id)
      }}
    />
  </Screen>
}

export default function GoalScreen(): React.ReactElement {
  const { id = '' } = useParams()
  return <TasksGate title="Goal" back="/tasks/goals"><GoalDetail key={id} goalId={id} /></TasksGate>
}
