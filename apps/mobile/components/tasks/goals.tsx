import React, { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { CalendarDays, Check, Circle, CircleCheck, Link2, Target } from 'lucide-react-native'
import type { TaskBoardRecord, TaskCardRecord, TaskGoalRecord } from '@ego/api-contracts'
import {
  goalProgress, nextGoalMilestone, TASK_GOAL_HORIZONS, TASK_GOAL_STATUSES,
  type TaskGoalHorizon, type TaskGoalInput, type TaskGoalStatus
} from '@ego/core'
import { formatIso, isoToday } from '@ego/local/dates'
import { BottomSheet, inputClass } from '../money/Common'
import { CalendarDialog } from '../money/DatePicker'
import { color } from '../money/tokens'
import { Button } from '../ui/button'
import { SegmentedControl } from '../ui/segmented-control'
import { Text as UiText } from '../ui/text'
import { SectionTitle } from './ui'

export const GOAL_HORIZON_LABELS: Record<TaskGoalHorizon, string> = {
  quarter: 'This quarter', year: 'This year', longTerm: 'Long term', someday: 'Someday'
}

export const GOAL_STATUS_LABELS: Record<TaskGoalStatus, string> = {
  active: 'Active', paused: 'Paused', someday: 'Someday', achieved: 'Achieved'
}

const HORIZON_OPTIONS = TASK_GOAL_HORIZONS.map((value) => ({ value, label: GOAL_HORIZON_LABELS[value] }))
const STATUS_OPTIONS = TASK_GOAL_STATUSES.map((value) => ({ value, label: GOAL_STATUS_LABELS[value] }))

function OptionalDateField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <View className="mt-4">
      <Text className="mb-2 text-[15px] font-medium text-surface-200">{label}</Text>
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)} className={`${inputClass} flex-1 flex-row items-center active:bg-surface-800`}>
          <CalendarDays color={color.textSecondary} size={18} />
          <Text className="ml-2 flex-1 text-[16px] text-foreground">{value ? formatIso(value) : `No ${label.toLowerCase()}`}</Text>
        </Pressable>
        {value && <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange(null)} className="h-[52px] w-[52px] items-center justify-center rounded-xl border border-input bg-surface-900 active:bg-surface-800">
          <Text className="text-[20px] text-surface-300">×</Text>
        </Pressable>}
      </View>
    </View>
    <CalendarDialog visible={open} value={value ?? isoToday()} onCancel={() => setOpen(false)} onConfirm={(next) => { setOpen(false); onChange(next) }} />
  </>
}

export function GoalSheet({ visible, goal, onSave, onClose }: {
  visible: boolean
  goal: TaskGoalRecord | null
  onSave: (input: TaskGoalInput) => void
  onClose: () => void
}): React.ReactElement {
  const [title, setTitle] = useState('')
  const [why, setWhy] = useState('')
  const [horizon, setHorizon] = useState<TaskGoalHorizon>('year')
  const [status, setStatus] = useState<TaskGoalStatus>('active')
  const [targetDate, setTargetDate] = useState<string | null>(null)
  const [reviewDate, setReviewDate] = useState<string | null>(null)
  useEffect(() => {
    if (!visible) return
    setTitle(goal?.title ?? '')
    setWhy(goal?.why ?? '')
    setHorizon(goal?.horizon ?? 'year')
    setStatus(goal?.status ?? 'active')
    setTargetDate(goal?.targetDate ?? null)
    setReviewDate(goal?.reviewDate ?? null)
  }, [goal, visible])
  const save = (): void => {
    onSave({
      title: title.trim(), why, horizon, targetDate, status,
      position: goal?.position ?? 0, reviewDate, milestones: goal?.milestones ?? [],
      boardIds: goal?.boardIds ?? [], cardIds: goal?.cardIds ?? [], archivedAt: goal?.archivedAt ?? null
    })
  }
  return <BottomSheet visible={visible} title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
    <Text className="mb-2 text-[15px] font-medium text-surface-200">Outcome</Text>
    <TextInput value={title} onChangeText={setTitle} autoFocus={!goal} maxLength={160} placeholder="What do you want to make true?" placeholderTextColor="#737373" accessibilityLabel="Goal title" className={inputClass} />
    <Text className="mb-2 mt-4 text-[15px] font-medium text-surface-200">Why it matters</Text>
    <TextInput value={why} onChangeText={setWhy} multiline maxLength={4000} placeholder="A sentence you will still understand later" placeholderTextColor="#737373" accessibilityLabel="Why this goal matters" className={`${inputClass} min-h-[96px]`} style={{ textAlignVertical: 'top' }} />
    <Text className="mb-2 mt-5 text-[15px] font-medium text-surface-200">Horizon</Text>
    <SegmentedControl options={HORIZON_OPTIONS} value={horizon} onValueChange={setHorizon} />
    <OptionalDateField label="Target date" value={targetDate} onChange={setTargetDate} />
    <OptionalDateField label="Review date" value={reviewDate} onChange={setReviewDate} />
    <Text className="mb-2 mt-5 text-[15px] font-medium text-surface-200">Status</Text>
    <SegmentedControl options={STATUS_OPTIONS} value={status} onValueChange={setStatus} />
    <Button size="lg" className="mt-5" disabled={title.trim() === ''} onPress={save}><UiText>{goal ? 'Save changes' : 'Create goal'}</UiText></Button>
  </BottomSheet>
}

export function GoalCard({ goal, boards, cards, onPress }: {
  goal: TaskGoalRecord
  boards: readonly TaskBoardRecord[]
  cards: readonly TaskCardRecord[]
  onPress: () => void
}): React.ReactElement {
  const { done, total } = goalProgress(goal)
  const next = nextGoalMilestone(goal)
  const linkedBoards = goal.boardIds.flatMap((id) => boards.filter((board) => board.id === id))
  const linkedCards = goal.cardIds.flatMap((id) => cards.filter((card) => card.id === id && card.doneAt === null))
  return <Pressable accessibilityRole="button" onPress={onPress} className="rounded-3xl border-2 border-white bg-black p-4 active:bg-surface-900">
    <View className="flex-row items-start">
      <View className="h-11 w-11 items-center justify-center rounded-2xl border border-surface-700 bg-surface-900">
        <Target color="#fafafa" size={21} />
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-center">
          <Text numberOfLines={2} className="flex-1 text-[19px] font-semibold text-white">{goal.title}</Text>
          <Text className="ml-2 text-[12px] font-semibold uppercase tracking-wide text-surface-500">{GOAL_HORIZON_LABELS[goal.horizon]}</Text>
        </View>
        {goal.why.trim() !== '' && <Text numberOfLines={2} className="mt-1 text-[14px] leading-5 text-surface-400">{goal.why}</Text>}
      </View>
    </View>
    <View className="mt-4 h-px bg-surface-800" />
    <View className="mt-3 flex-row items-center">
      <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
        <View className="h-full rounded-full bg-white" style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} />
      </View>
      <Text className="ml-3 text-[13px] font-medium text-surface-400">{total === 0 ? 'No checkpoints' : `${done} of ${total} checkpoints`}</Text>
    </View>
    {next && <View className="mt-3 flex-row items-center"><Circle color={color.textMuted} size={15} /><Text numberOfLines={1} className="ml-2 flex-1 text-[15px] text-surface-200">Next: {next.title}</Text></View>}
    <View className="mt-3 flex-row flex-wrap items-center gap-2">
      {linkedBoards.map((board) => <View key={board.id} className="rounded-full bg-surface-900 px-2.5 py-1"><Text className="text-[12px] text-surface-300">{[board.icon, board.name].filter(Boolean).join(' ')}</Text></View>)}
      {linkedCards.length > 0 && <View className="rounded-full bg-surface-900 px-2.5 py-1"><Text className="text-[12px] text-surface-300">{linkedCards.length} linked {linkedCards.length === 1 ? 'action' : 'actions'}</Text></View>}
      {goal.reviewDate && <Text className="ml-auto text-[12px] text-surface-500">Review {formatIso(goal.reviewDate)}</Text>}
    </View>
  </Pressable>
}

export function GoalLinkSheet({ visible, goal, boards, cards, onToggleBoard, onToggleCard, onClose }: {
  visible: boolean
  goal: TaskGoalRecord
  boards: readonly TaskBoardRecord[]
  cards: readonly TaskCardRecord[]
  onToggleBoard: (boardId: string) => void
  onToggleCard: (cardId: string) => void
  onClose: () => void
}): React.ReactElement {
  return <BottomSheet visible={visible} title="Link work" onClose={onClose}>
    <SectionTitle Icon={Link2} title="Boards" />
    <Text className="mb-2 text-[14px] leading-5 text-surface-500">Link a whole board when the goal depends on a stream of work.</Text>
    {boards.length === 0 && <Text className="text-[15px] text-surface-500">Create a board first.</Text>}
    {boards.map((board) => {
      const selected = goal.boardIds.includes(board.id)
      return <Pressable key={board.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => onToggleBoard(board.id)} className="min-h-14 flex-row items-center border-b border-surface-800">
        <View className={`h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-transparent bg-primary' : 'border-surface-500'}`}>{selected && <Check color="#0a0a0a" size={16} strokeWidth={3} />}</View>
        <Text className="ml-3 flex-1 text-[16px] text-surface-100">{[board.icon, board.name].filter(Boolean).join(' ')}</Text>
      </Pressable>
    })}
    <SectionTitle Icon={CircleCheck} title="Next actions" />
    <Text className="mb-2 text-[14px] leading-5 text-surface-500">Pin the cards that should move this goal forward.</Text>
    {cards.length === 0 && <Text className="text-[15px] text-surface-500">No open cards yet.</Text>}
    {cards.map((card) => {
      const selected = goal.cardIds.includes(card.id)
      return <Pressable key={card.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => onToggleCard(card.id)} className="min-h-14 flex-row items-center border-b border-surface-800">
        <View className={`h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-transparent bg-primary' : 'border-surface-500'}`}>{selected && <Check color="#0a0a0a" size={16} strokeWidth={3} />}</View>
        <View className="ml-3 flex-1"><Text numberOfLines={1} className="text-[16px] text-surface-100">{card.title}</Text><Text numberOfLines={1} className="text-[13px] text-surface-500">{boards.find((board) => board.id === card.boardId)?.name ?? 'Tasks'}</Text></View>
      </Pressable>
    })}
    <Button variant="outline" className="mt-5" onPress={onClose}><UiText>Done</UiText></Button>
  </BottomSheet>
}

export function MilestoneRow({ title, dueDate, done, onToggle }: { title: string; dueDate: string | null; done: boolean; onToggle: () => void }): React.ReactElement {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} onPress={onToggle} className="min-h-14 flex-row items-center border-b border-surface-800 py-2">
    {done ? <CircleCheck color="#fafafa" size={22} /> : <Circle color="#525252" size={22} />}
    <View className="ml-3 flex-1"><Text className={`text-[16px] ${done ? 'text-surface-500 line-through' : 'text-surface-100'}`}>{title}</Text>{dueDate && <Text className="mt-0.5 text-[13px] text-surface-500">{formatIso(dueDate)}</Text>}</View>
  </Pressable>
}
