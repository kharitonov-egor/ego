import React, { useEffect, useState } from 'react'
import { CalendarDays, Check, Circle, CircleCheck, Link2, Target, X } from 'lucide-react'
import type { TaskBoardRecord, TaskCardRecord, TaskGoalRecord } from '@ego/api-contracts'
import {
  goalProgress, nextGoalMilestone, TASK_GOAL_HORIZONS, TASK_GOAL_STATUSES,
  type TaskGoalHorizon, type TaskGoalInput, type TaskGoalStatus
} from '@ego/core'
import { formatIso, isoToday } from '@ego/local/dates'
import { color } from '../../lib/tokens'
import { cn } from '../../lib/utils'
import { CalendarDialog } from '../DatePicker'
import { Button } from '../ui/button'
import { Sheet } from '../ui/dialog'
import { inputClass } from '../ui/input'
import { SegmentedControl } from '../ui/segmented-control'
import { SectionTitle } from './ui'

export const GOAL_HORIZON_LABELS: Record<TaskGoalHorizon, string> = {
  quarter: 'This quarter', year: 'This year', longTerm: 'Long term', someday: 'Someday'
}

export const GOAL_STATUS_LABELS: Record<TaskGoalStatus, string> = {
  active: 'Active', paused: 'Paused', someday: 'Someday', achieved: 'Achieved'
}

const HORIZON_OPTIONS = TASK_GOAL_HORIZONS.map((value) => ({ value, label: GOAL_HORIZON_LABELS[value] }))
const STATUS_OPTIONS = TASK_GOAL_STATUSES.map((value) => ({ value, label: GOAL_STATUS_LABELS[value] }))

const FIELD_LABEL = 'mb-2 block text-[15px] font-medium text-surface-200'

function OptionalDateField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }): React.ReactElement {
  const [open, setOpen] = useState(false)
  return <>
    <div className="mt-4">
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(true)} className={cn(inputClass, 'flex flex-1 items-center text-left hover:bg-surface-800')}>
          <CalendarDays color={color.textSecondary} size={18} />
          <span className="ml-2 flex-1 text-[16px] text-foreground">{value ? formatIso(value) : `No ${label.toLowerCase()}`}</span>
        </button>
        {value && <button
          type="button"
          aria-label={`Clear ${label}`}
          title={`Clear ${label}`}
          onClick={() => onChange(null)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-input bg-surface-900 text-surface-300 hover:bg-surface-800"
        ><X size={18} /></button>}
      </div>
    </div>
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
    if (title.trim() === '') return
    onSave({
      title: title.trim(), why, horizon, targetDate, status,
      position: goal?.position ?? 0, reviewDate, milestones: goal?.milestones ?? [],
      boardIds: goal?.boardIds ?? [], cardIds: goal?.cardIds ?? [], archivedAt: goal?.archivedAt ?? null
    })
  }
  return <Sheet visible={visible} title={goal ? 'Edit goal' : 'New goal'} onClose={onClose} footer={
    <Button size="lg" className="w-full" disabled={title.trim() === ''} onClick={save}>{goal ? 'Save changes' : 'Create goal'}</Button>
  }>
    <label htmlFor="goal-title" className={FIELD_LABEL}>Outcome</label>
    <input
      id="goal-title"
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        save()
      }}
      autoFocus
      maxLength={160}
      placeholder="What do you want to make true?"
      aria-label="Goal title"
      className={inputClass}
    />
    <label htmlFor="goal-why" className={cn(FIELD_LABEL, 'mt-4')}>Why it matters</label>
    <textarea
      id="goal-why"
      value={why}
      onChange={(event) => setWhy(event.target.value)}
      maxLength={4000}
      placeholder="A sentence you will still understand later"
      aria-label="Why this goal matters"
      className={cn(inputClass, 'min-h-[96px] resize-none [field-sizing:content]')}
    />
    <span className={cn(FIELD_LABEL, 'mt-5')}>Horizon</span>
    <SegmentedControl options={HORIZON_OPTIONS} value={horizon} onValueChange={setHorizon} />
    <OptionalDateField label="Target date" value={targetDate} onChange={setTargetDate} />
    <OptionalDateField label="Review date" value={reviewDate} onChange={setReviewDate} />
    <span className={cn(FIELD_LABEL, 'mt-5')}>Status</span>
    <SegmentedControl options={STATUS_OPTIONS} value={status} onValueChange={setStatus} />
  </Sheet>
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
  return <button type="button" onClick={onPress} className="flex w-full flex-col rounded-3xl border-2 border-white bg-black p-4 text-left transition-colors hover:bg-white/[0.06] active:bg-surface-900">
    <div className="flex w-full items-start">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-surface-700 bg-surface-900">
        <Target color="#fafafa" size={21} />
      </span>
      <div className="ml-3 min-w-0 flex-1">
        <div className="flex items-center">
          <span className="line-clamp-2 min-w-0 flex-1 text-[19px] font-semibold text-white">{goal.title}</span>
          <span className="ml-2 shrink-0 text-[12px] font-semibold uppercase tracking-wide text-surface-500">{GOAL_HORIZON_LABELS[goal.horizon]}</span>
        </div>
        {goal.why.trim() !== '' && <p className="mt-1 line-clamp-2 text-[14px] leading-5 text-surface-400">{goal.why}</p>}
      </div>
    </div>
    <div className="mt-4 h-px w-full bg-surface-800" />
    <div className="mt-3 flex w-full items-center">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-800">
        <div className="h-full rounded-full bg-white" style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} />
      </div>
      <span className="tabular ml-3 text-[13px] font-medium text-surface-400">{total === 0 ? 'No checkpoints' : `${done} of ${total} checkpoints`}</span>
    </div>
    {next && <div className="mt-3 flex w-full items-center"><Circle color={color.textMuted} size={15} /><span className="ml-2 min-w-0 flex-1 truncate text-[15px] text-surface-200">Next: {next.title}</span></div>}
    <div className="mt-3 flex w-full flex-wrap items-center gap-2">
      {linkedBoards.map((board) => <span key={board.id} className="rounded-full bg-surface-900 px-2.5 py-1 text-[12px] text-surface-300">{[board.icon, board.name].filter(Boolean).join(' ')}</span>)}
      {linkedCards.length > 0 && <span className="rounded-full bg-surface-900 px-2.5 py-1 text-[12px] text-surface-300">{linkedCards.length} linked {linkedCards.length === 1 ? 'action' : 'actions'}</span>}
      {goal.reviewDate && <span className="ml-auto text-[12px] text-surface-500">Review {formatIso(goal.reviewDate)}</span>}
    </div>
  </button>
}

function LinkRow({ selected, onToggle, children }: { selected: boolean; onToggle: () => void; children: React.ReactNode }): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={selected}
    onClick={onToggle}
    className="flex min-h-14 w-full items-center rounded-lg border-b border-surface-800 px-1 text-left hover:bg-surface-900"
  >
    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', selected ? 'border-transparent bg-primary' : 'border-surface-500')}>
      {selected && <Check color="#0a0a0a" size={16} strokeWidth={3} />}
    </span>
    {children}
  </button>
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
  return <Sheet visible={visible} title="Link work" onClose={onClose} footer={<Button variant="outline" className="w-full" onClick={onClose}>Done</Button>}>
    <SectionTitle Icon={Link2} title="Boards" />
    <p className="mb-2 text-[14px] leading-5 text-surface-500">Link a whole board when the goal depends on a stream of work.</p>
    {boards.length === 0 && <p className="text-[15px] text-surface-500">Create a board first.</p>}
    {boards.map((board) => <LinkRow key={board.id} selected={goal.boardIds.includes(board.id)} onToggle={() => onToggleBoard(board.id)}>
      <span className="ml-3 min-w-0 flex-1 truncate text-[16px] text-surface-100">{[board.icon, board.name].filter(Boolean).join(' ')}</span>
    </LinkRow>)}
    <SectionTitle Icon={CircleCheck} title="Next actions" />
    <p className="mb-2 text-[14px] leading-5 text-surface-500">Pin the cards that should move this goal forward.</p>
    {cards.length === 0 && <p className="text-[15px] text-surface-500">No open cards yet.</p>}
    {cards.map((card) => <LinkRow key={card.id} selected={goal.cardIds.includes(card.id)} onToggle={() => onToggleCard(card.id)}>
      <span className="ml-3 min-w-0 flex-1">
        <span className="block truncate text-[16px] text-surface-100">{card.title}</span>
        <span className="block truncate text-[13px] text-surface-500">{boards.find((board) => board.id === card.boardId)?.name ?? 'Tasks'}</span>
      </span>
    </LinkRow>)}
  </Sheet>
}

export function MilestoneRow({ title, dueDate, done, onToggle }: { title: string; dueDate: string | null; done: boolean; onToggle: () => void }): React.ReactElement {
  return <button
    type="button"
    role="checkbox"
    aria-checked={done}
    onClick={onToggle}
    className="flex min-h-14 w-full items-center border-b border-surface-800 py-2 text-left hover:bg-surface-900/60"
  >
    {done ? <CircleCheck color="#fafafa" size={22} className="shrink-0" /> : <Circle color="#525252" size={22} className="shrink-0" />}
    <span className="ml-3 min-w-0 flex-1">
      <span className={cn('block break-words text-[16px]', done ? 'text-surface-500 line-through' : 'text-surface-100')}>{title}</span>
      {dueDate && <span className="mt-0.5 block text-[13px] text-surface-500">{formatIso(dueDate)}</span>}
    </span>
  </button>
}
