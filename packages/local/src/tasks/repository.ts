import type { TaskBoardRecord, TaskCardRecord, TaskGoalRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import {
  isTaskAttachment, isTaskListColor, isTaskListKind, isTaskReminder,
  type TaskActivity, type TaskAttachment, type TaskChecklist, type TaskGoalMilestone, type TaskGoalHorizon, type TaskGoalStatus,
  type TaskLabelColor, type TaskPriority
} from '@ego/core'
import type { LocalDatabase } from '../database/types'

export interface TaskData {
  boards: TaskBoardRecord[]
  lists: TaskListRecord[]
  labels: TaskLabelRecord[]
  cards: TaskCardRecord[]
  goals?: TaskGoalRecord[]
  /** Cards with an edit still waiting on its files, and those whose files failed. */
  uploads: ReadonlyMap<string, 'sending' | 'failed'>
}

interface BoardRow {
  id: string
  name: string
  icon: string
  position: number
  hide_done: number
  move_done: number
  archived_at: string | null
  created_at: string
  updated_at: string
  revision: number
}

interface ListRow {
  id: string
  board_id: string
  name: string
  position: number
  archived_at: string | null
  kind: string
  color: string | null
  icon: string
  border: number
  created_at: string
  updated_at: string
  revision: number
}

interface LabelRow {
  id: string
  board_id: string
  name: string
  color: TaskLabelColor
  position: number
  created_at: string
  updated_at: string
  revision: number
}

interface CardRow {
  id: string
  board_id: string
  list_id: string
  title: string
  description: string
  position: number
  label_ids: string
  priority: TaskPriority
  due_date: string | null
  due_time: string | null
  reminder_minutes: number | null
  done_at: string | null
  archived_at: string | null
  checklists: string
  attachments: string
  activity: string
  created_at: string
  updated_at: string
  revision: number
}

interface GoalRow {
  id: string
  title: string
  why: string
  horizon: TaskGoalHorizon
  target_date: string | null
  status: TaskGoalStatus
  position: number
  review_date: string | null
  milestones: string
  board_ids: string
  card_ids: string
  archived_at: string | null
  created_at: string
  updated_at: string
  revision: number
}

function jsonList(raw: string): unknown[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function isChecklist(value: unknown): value is TaskChecklist {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value && 'items' in value
}

function isActivity(value: unknown): value is TaskActivity {
  return typeof value === 'object' && value !== null && 'at' in value && 'kind' in value && 'text' in value
}

function isGoalMilestone(value: unknown): value is TaskGoalMilestone {
  return typeof value === 'object' && value !== null && 'id' in value && 'title' in value &&
    'dueDate' in value && 'doneAt' in value
}

function toCard(row: CardRow): TaskCardRecord {
  return {
    id: row.id, boardId: row.board_id, listId: row.list_id, title: row.title, description: row.description,
    position: row.position,
    labelIds: jsonList(row.label_ids).filter((item): item is string => typeof item === 'string'),
    priority: row.priority, dueDate: row.due_date, dueTime: row.due_time,
    reminderMinutes: isTaskReminder(row.reminder_minutes) ? row.reminder_minutes : null,
    doneAt: row.done_at, archivedAt: row.archived_at,
    checklists: jsonList(row.checklists).filter(isChecklist),
    attachments: jsonList(row.attachments).filter((item): item is TaskAttachment => isTaskAttachment(item)),
    activity: jsonList(row.activity).filter(isActivity),
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }
}

function toGoal(row: GoalRow): TaskGoalRecord {
  return {
    id: row.id, title: row.title, why: row.why, horizon: row.horizon, targetDate: row.target_date,
    status: row.status, position: row.position, reviewDate: row.review_date,
    milestones: jsonList(row.milestones).filter(isGoalMilestone),
    boardIds: jsonList(row.board_ids).filter((item): item is string => typeof item === 'string'),
    cardIds: jsonList(row.card_ids).filter((item): item is string => typeof item === 'string'),
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }
}

/** Everything under live boards. Rows under a deleted board or list stay on disk but never show. */
export async function localTasks(db: LocalDatabase): Promise<TaskData> {
  const [boards, lists, labels, cards, goals, waiting] = await Promise.all([
    db.all<BoardRow>('SELECT * FROM task_boards WHERE deleted_at IS NULL ORDER BY position, created_at'),
    db.all<ListRow>(`SELECT l.* FROM task_lists l
      JOIN task_boards b ON b.id = l.board_id AND b.deleted_at IS NULL
      WHERE l.deleted_at IS NULL ORDER BY l.position, l.created_at`),
    db.all<LabelRow>(`SELECT t.* FROM task_labels t
      JOIN task_boards b ON b.id = t.board_id AND b.deleted_at IS NULL
      WHERE t.deleted_at IS NULL ORDER BY t.position, t.created_at`),
    db.all<CardRow>(`SELECT c.* FROM task_cards c
      JOIN task_lists l ON l.id = c.list_id AND l.deleted_at IS NULL
      JOIN task_boards b ON b.id = c.board_id AND b.deleted_at IS NULL
      WHERE c.deleted_at IS NULL ORDER BY c.position, c.created_at`),
    db.all<GoalRow>('SELECT * FROM task_goals WHERE deleted_at IS NULL ORDER BY position, created_at'),
    db.all<{ entity_id: string; status: 'held' | 'failed' }>(
      "SELECT entity_id, status FROM outbox WHERE entity = 'taskCard' AND status IN ('held', 'failed')")
  ])
  return {
    boards: boards.map((row) => ({
      id: row.id, name: row.name, icon: row.icon, position: row.position, hideDone: row.hide_done === 1,
      moveDone: row.move_done === 1, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
      revision: row.revision
    })),
    lists: lists.map((row) => ({
      id: row.id, boardId: row.board_id, name: row.name, position: row.position, archivedAt: row.archived_at,
      kind: isTaskListKind(row.kind) ? row.kind : 'cards', color: isTaskListColor(row.color) ? row.color : null, icon: row.icon,
      border: row.border === 1, createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
    })),
    labels: labels.map((row) => ({
      id: row.id, boardId: row.board_id, name: row.name, color: row.color, position: row.position,
      createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
    })),
    cards: cards.map(toCard),
    goals: goals.map(toGoal),
    uploads: new Map(waiting.map((row) => [row.entity_id, row.status === 'held' ? 'sending' : 'failed']))
  }
}

export type TaskTable = 'task_boards' | 'task_lists' | 'task_labels' | 'task_cards' | 'task_goals'

export async function localTaskRevision(db: LocalDatabase, table: TaskTable, id: string): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(`SELECT revision FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [id])
  return rows[0]?.revision ?? null
}

/** The card as saved on this phone, so an edit starts from what is on disk and not from a stale screen. */
export async function localTaskCard(db: LocalDatabase, id: string): Promise<TaskCardRecord | null> {
  const rows = await db.all<CardRow>('SELECT * FROM task_cards WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0] ? toCard(rows[0]) : null
}
