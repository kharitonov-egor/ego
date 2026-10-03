import { isDateString } from './money'

export const TASK_GOAL_HORIZONS = ['quarter', 'year', 'longTerm', 'someday'] as const
export type TaskGoalHorizon = typeof TASK_GOAL_HORIZONS[number]

export const TASK_GOAL_STATUSES = ['active', 'paused', 'someday', 'achieved'] as const
export type TaskGoalStatus = typeof TASK_GOAL_STATUSES[number]

export interface TaskGoalMilestone {
  id: string
  title: string
  dueDate: string | null
  doneAt: string | null
}

export interface TaskGoalInput {
  title: string
  /** Markdown or plain text explaining why this outcome matters. */
  why: string
  horizon: TaskGoalHorizon
  targetDate: string | null
  status: TaskGoalStatus
  position: number
  reviewDate: string | null
  milestones: TaskGoalMilestone[]
  /** Boards and cards are linked explicitly so one goal can cross contexts. */
  boardIds: string[]
  cardIds: string[]
  archivedAt: string | null
}

export interface TaskGoal extends TaskGoalInput {
  id: string
  createdAt: string
  updatedAt: string
}

export const TASK_GOAL_TITLE_LIMIT = 160
export const TASK_GOAL_WHY_LIMIT = 4000
export const TASK_GOAL_MILESTONE_LIMIT = 20
export const TASK_GOAL_MILESTONE_TITLE_LIMIT = 240

const ID = /^[A-Za-z0-9_-]{1,64}$/
const POSITION_LIMIT = 1e15

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

function isOptionalDate(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && isDateString(value))
}

function uniqueIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isId) && new Set(value).size === value.length
}

function isMilestone(value: unknown): value is TaskGoalMilestone {
  return isRecord(value) && isId(value.id) && isText(value.title, 1, TASK_GOAL_MILESTONE_TITLE_LIMIT) &&
    isOptionalDate(value.dueDate) && (value.doneAt === null || typeof value.doneAt === 'string')
}

export function isTaskGoalHorizon(value: unknown): value is TaskGoalHorizon {
  return (TASK_GOAL_HORIZONS as readonly unknown[]).includes(value)
}

export function isTaskGoalStatus(value: unknown): value is TaskGoalStatus {
  return (TASK_GOAL_STATUSES as readonly unknown[]).includes(value)
}

export function isTaskGoalInput(value: unknown): value is TaskGoalInput {
  return isRecord(value) &&
    isText(value.title, 1, TASK_GOAL_TITLE_LIMIT) &&
    typeof value.why === 'string' && value.why.length <= TASK_GOAL_WHY_LIMIT &&
    isTaskGoalHorizon(value.horizon) && isOptionalDate(value.targetDate) &&
    isTaskGoalStatus(value.status) && typeof value.position === 'number' &&
    Number.isFinite(value.position) && Math.abs(value.position) <= POSITION_LIMIT &&
    isOptionalDate(value.reviewDate) && Array.isArray(value.milestones) &&
    value.milestones.length <= TASK_GOAL_MILESTONE_LIMIT && value.milestones.every(isMilestone) &&
    uniqueIds(value.boardIds) && uniqueIds(value.cardIds) &&
    isOptionalDate(value.archivedAt)
}

export function goalProgress(goal: Pick<TaskGoalInput, 'milestones'>): { done: number; total: number } {
  const total = goal.milestones.length
  return { done: goal.milestones.filter((milestone) => milestone.doneAt !== null).length, total }
}

export function nextGoalMilestone(goal: Pick<TaskGoalInput, 'milestones'>): TaskGoalMilestone | null {
  return goal.milestones.find((milestone) => milestone.doneAt === null) ?? null
}

export function taskGoalInput(goal: TaskGoalInput): TaskGoalInput {
  return {
    title: goal.title,
    why: goal.why,
    horizon: goal.horizon,
    targetDate: goal.targetDate,
    status: goal.status,
    position: goal.position,
    reviewDate: goal.reviewDate,
    milestones: goal.milestones,
    boardIds: goal.boardIds,
    cardIds: goal.cardIds,
    archivedAt: goal.archivedAt
  }
}
