import { isDateString } from './money'

/**
 * Tasks is a Trello-style board: boards hold lists, lists hold cards. A card is written as one
 * piece, with its checklists, attachments, and activity log inside it, so any edit is one
 * operation and the log can never disagree with the card it describes.
 */

export const TASK_LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'pink'] as const
export type TaskLabelColor = typeof TASK_LABEL_COLORS[number]

/**
 * A regular list holds cards. The Inbox is where quick add and the inbox endpoint drop new cards,
 * and its board is the one Tasks opens on. A USF list also shows the Canvas assignments. A Work list
 * mirrors the active lists of the work Trello board, both ways.
 */
export const TASK_LIST_KINDS = ['cards', 'inbox', 'usf', 'work'] as const
export type TaskListKind = typeof TASK_LIST_KINDS[number]

export const TASK_PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = typeof TASK_PRIORITIES[number]

/**
 * Minutes before the due time. A card with only a date is reminded at 9 AM, on the day for
 * anything under a day and that many days before otherwise.
 */
export const TASK_REMINDERS = [0, 10, 60, 1440, 2880] as const
export type TaskReminder = typeof TASK_REMINDERS[number]
export const TASK_DATE_ONLY_REMINDERS: readonly TaskReminder[] = [0, 1440, 2880]
export const TASK_DAY_REMINDER_HOUR = 9

export type TaskAttachmentKind = 'photo' | 'video' | 'file'

export type TaskActivityKind =
  | 'create' | 'move' | 'rename' | 'done' | 'reopen' | 'due' | 'label' | 'priority' | 'description'
  | 'checklist' | 'attachment' | 'archive' | 'restore' | 'copy'

export const TASK_ACTIVITY_KINDS: readonly TaskActivityKind[] = [
  'create', 'move', 'rename', 'done', 'reopen', 'due', 'label', 'priority', 'description',
  'checklist', 'attachment', 'archive', 'restore', 'copy'
]

export interface TaskBoardInput {
  name: string
  /** One emoji, or empty. */
  icon: string
  position: number
  hideDone: boolean
  archivedAt: string | null
}

export interface TaskBoard extends TaskBoardInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface TaskListInput {
  boardId: string
  name: string
  position: number
  archivedAt: string | null
  /** Builds from before list kinds leave this out, and the server then keeps the kind it has. */
  kind?: TaskListKind
}

export interface TaskList extends TaskListInput {
  kind: TaskListKind
  id: string
  createdAt: string
  updatedAt: string
}

/** A label belongs to one board. Its name may be empty, like a color-only label in Trello. */
export interface TaskLabelInput {
  boardId: string
  name: string
  color: TaskLabelColor
  position: number
}

export interface TaskLabel extends TaskLabelInput {
  id: string
  createdAt: string
  updatedAt: string
}

export interface TaskChecklistItem {
  id: string
  text: string
  doneAt: string | null
}

export interface TaskChecklist {
  id: string
  title: string
  items: TaskChecklistItem[]
}

/** The bytes are in R2 under `tasks/<mediaId>`; `previewId` is a smaller image for photos and videos. */
export interface TaskAttachment {
  id: string
  mediaId: string
  kind: TaskAttachmentKind
  mimeType: string
  fileName: string | null
  size: number | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  previewId: string | null
  addedAt: string
}

export interface TaskActivity {
  at: string
  kind: TaskActivityKind
  text: string
}

export interface TaskCardInput {
  boardId: string
  listId: string
  title: string
  /** Markdown. */
  description: string
  position: number
  labelIds: string[]
  priority: TaskPriority
  /** The phone's own calendar day, YYYY-MM-DD. */
  dueDate: string | null
  /** HH:MM on that day, or null for the whole day. */
  dueTime: string | null
  reminderMinutes: TaskReminder | null
  doneAt: string | null
  archivedAt: string | null
  checklists: TaskChecklist[]
  attachments: TaskAttachment[]
  /** Oldest first, capped at the newest `TASK_ACTIVITY_LIMIT`. */
  activity: TaskActivity[]
}

export interface TaskCard extends TaskCardInput {
  id: string
  createdAt: string
  updatedAt: string
}

export const TASK_NAME_LIMIT = 120
export const TASK_ICON_LIMIT = 16
export const TASK_LABEL_NAME_LIMIT = 40
export const TASK_TITLE_LIMIT = 500
/** Trello's own ceiling for a description. */
export const TASK_DESCRIPTION_LIMIT = 16384
export const TASK_CARD_LABEL_LIMIT = 20
export const TASK_CHECKLIST_LIMIT = 20
export const TASK_CHECKLIST_ITEM_LIMIT = 200
export const TASK_ITEM_TEXT_LIMIT = 500
export const TASK_ATTACHMENT_LIMIT = 50
export const TASK_ACTIVITY_LIMIT = 100
export const TASK_ACTIVITY_TEXT_LIMIT = 300
export const TASK_FILE_SIZE_LIMIT = 2 * 1024 * 1024 * 1024
const POSITION_LIMIT = 1e15

const ID = /^[A-Za-z0-9_-]{1,64}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const MIME_TYPE = /^[A-Za-z0-9][\w.+-]*\/[\w.+-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && !Number.isNaN(Date.parse(value))
}

function isOptionalTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value)
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max
}

function isOptionalCount(value: unknown, limit = Number.MAX_SAFE_INTEGER): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= limit)
}

export function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

export function isTaskTime(value: unknown): value is string {
  return typeof value === 'string' && TIME.test(value)
}

export function isTaskPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= POSITION_LIMIT
}

export function isTaskLabelColor(value: unknown): value is TaskLabelColor {
  return (TASK_LABEL_COLORS as readonly unknown[]).includes(value)
}

export function isTaskListKind(value: unknown): value is TaskListKind {
  return (TASK_LIST_KINDS as readonly unknown[]).includes(value)
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return (TASK_PRIORITIES as readonly unknown[]).includes(value)
}

export function isTaskReminder(value: unknown): value is TaskReminder {
  return (TASK_REMINDERS as readonly unknown[]).includes(value)
}

export function isTaskBoardInput(value: unknown): value is TaskBoardInput {
  return isRecord(value) &&
    isText(value.name, 1, TASK_NAME_LIMIT) &&
    typeof value.icon === 'string' && value.icon.length <= TASK_ICON_LIMIT &&
    isTaskPosition(value.position) &&
    typeof value.hideDone === 'boolean' &&
    isOptionalTimestamp(value.archivedAt)
}

export function isTaskListInput(value: unknown): value is TaskListInput {
  return isRecord(value) &&
    isTaskId(value.boardId) &&
    isText(value.name, 1, TASK_NAME_LIMIT) &&
    isTaskPosition(value.position) &&
    isOptionalTimestamp(value.archivedAt) &&
    (value.kind === undefined || isTaskListKind(value.kind))
}

export function isTaskLabelInput(value: unknown): value is TaskLabelInput {
  return isRecord(value) &&
    isTaskId(value.boardId) &&
    typeof value.name === 'string' && value.name.length <= TASK_LABEL_NAME_LIMIT &&
    isTaskLabelColor(value.color) &&
    isTaskPosition(value.position)
}

function isChecklistItem(value: unknown): value is TaskChecklistItem {
  return isRecord(value) && isTaskId(value.id) && isText(value.text, 1, TASK_ITEM_TEXT_LIMIT) &&
    isOptionalTimestamp(value.doneAt)
}

function isChecklist(value: unknown): value is TaskChecklist {
  return isRecord(value) && isTaskId(value.id) && isText(value.title, 1, TASK_NAME_LIMIT) &&
    Array.isArray(value.items) && value.items.length <= TASK_CHECKLIST_ITEM_LIMIT && value.items.every(isChecklistItem)
}

export function isTaskAttachment(value: unknown): value is TaskAttachment {
  return isRecord(value) &&
    isTaskId(value.id) &&
    isTaskId(value.mediaId) &&
    (value.kind === 'photo' || value.kind === 'video' || value.kind === 'file') &&
    typeof value.mimeType === 'string' && value.mimeType.length <= 120 && MIME_TYPE.test(value.mimeType) &&
    (value.fileName === null || isText(value.fileName, 0, 300)) &&
    isOptionalCount(value.size, TASK_FILE_SIZE_LIMIT) &&
    isOptionalCount(value.width, 100000) &&
    isOptionalCount(value.height, 100000) &&
    isOptionalCount(value.durationSeconds, 1000000) &&
    (value.previewId === null || isTaskId(value.previewId)) &&
    isTimestamp(value.addedAt)
}

function isActivity(value: unknown): value is TaskActivity {
  return isRecord(value) && isTimestamp(value.at) &&
    (TASK_ACTIVITY_KINDS as readonly unknown[]).includes(value.kind) &&
    isText(value.text, 1, TASK_ACTIVITY_TEXT_LIMIT)
}

function uniqueIds(values: readonly { id: string }[]): boolean {
  return new Set(values.map((value) => value.id)).size === values.length
}

export function isTaskCardInput(value: unknown): value is TaskCardInput {
  if (!isRecord(value)) return false
  if (!isTaskId(value.boardId) || !isTaskId(value.listId)) return false
  if (!isText(value.title, 1, TASK_TITLE_LIMIT)) return false
  if (typeof value.description !== 'string' || value.description.length > TASK_DESCRIPTION_LIMIT) return false
  if (!isTaskPosition(value.position)) return false
  if (!Array.isArray(value.labelIds) || value.labelIds.length > TASK_CARD_LABEL_LIMIT ||
    !value.labelIds.every(isTaskId) || new Set(value.labelIds).size !== value.labelIds.length) return false
  if (!isTaskPriority(value.priority)) return false
  if (value.dueDate !== null && !(typeof value.dueDate === 'string' && isDateString(value.dueDate))) return false
  if (value.dueTime !== null && (!isTaskTime(value.dueTime) || value.dueDate === null)) return false
  if (value.reminderMinutes !== null && (!isTaskReminder(value.reminderMinutes) || value.dueDate === null)) return false
  if (!isOptionalTimestamp(value.doneAt) || !isOptionalTimestamp(value.archivedAt)) return false
  if (!Array.isArray(value.checklists) || value.checklists.length > TASK_CHECKLIST_LIMIT ||
    !value.checklists.every(isChecklist) || !uniqueIds(value.checklists)) return false
  if (!Array.isArray(value.attachments) || value.attachments.length > TASK_ATTACHMENT_LIMIT ||
    !value.attachments.every(isTaskAttachment) || !uniqueIds(value.attachments)) return false
  return Array.isArray(value.activity) && value.activity.length <= TASK_ACTIVITY_LIMIT && value.activity.every(isActivity)
}

/** Every file a card points at, so the server can check each one finished uploading. */
export function taskMediaIds(input: Pick<TaskCardInput, 'attachments'>): string[] {
  const ids = new Set<string>()
  for (const attachment of input.attachments) {
    ids.add(attachment.mediaId)
    if (attachment.previewId) ids.add(attachment.previewId)
  }
  return [...ids]
}

export const TASK_POSITION_STEP = 1024

/**
 * A position between two neighbours, so a move rewrites only the card that moved. Null stands for
 * the end of the list on that side.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return TASK_POSITION_STEP
  if (before === null) return (after ?? 0) - TASK_POSITION_STEP
  if (after === null) return before + TASK_POSITION_STEP
  return (before + after) / 2
}

/** Halving runs out of precision after about fifty moves into the same gap. */
export function positionsTooClose(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false
  return after - before < 1e-6
}

export function checklistProgress(checklists: readonly TaskChecklist[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const checklist of checklists) {
    for (const item of checklist.items) {
      total += 1
      if (item.doneAt !== null) done += 1
    }
  }
  return { done, total }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "5:30 PM" from "17:30". */
export function taskTimeLabel(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  const suffix = hours < 12 ? 'AM' : 'PM'
  const twelve = hours % 12 === 0 ? 12 : hours % 12
  return `${twelve}:${String(minutes).padStart(2, '0')} ${suffix}`
}

/** "Oct 3" or "Oct 3 at 5:30 PM", with the year only when it is not `currentYear`. */
export function taskDueLabel(dueDate: string, dueTime: string | null, currentYear?: number): string {
  const [year, month, day] = dueDate.split('-').map(Number)
  const date = `${MONTHS[month - 1]} ${day}${currentYear !== undefined && year !== currentYear ? `, ${year}` : ''}`
  return dueTime ? `${date} at ${taskTimeLabel(dueTime)}` : date
}

/** The moment a card falls due, on the phone's clock. A date-only card is due at the end of its day. */
export function taskDueAt(dueDate: string, dueTime: string | null): Date {
  const [year, month, day] = dueDate.split('-').map(Number)
  if (!dueTime) return new Date(year, month - 1, day, 23, 59, 59, 999)
  const [hours, minutes] = dueTime.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0, 0)
}

export function taskReminderAt(card: Pick<TaskCardInput, 'dueDate' | 'dueTime' | 'reminderMinutes'>): Date | null {
  if (card.dueDate === null || card.reminderMinutes === null) return null
  if (card.dueTime) return new Date(taskDueAt(card.dueDate, card.dueTime).getTime() - card.reminderMinutes * 60000)
  const [year, month, day] = card.dueDate.split('-').map(Number)
  const daysBefore = Math.floor(card.reminderMinutes / 1440)
  return new Date(year, month - 1, day - daysBefore, TASK_DAY_REMINDER_HOUR, 0, 0, 0)
}

/** What a new due date starts with: an hour's notice, or the morning of a date-only day. */
export function defaultTaskReminder(dueTime: string | null): TaskReminder {
  return dueTime ? 60 : 0
}

export function taskReminderLabel(minutes: TaskReminder | null, hasTime: boolean): string {
  if (minutes === null) return 'None'
  if (!hasTime) {
    if (minutes < 1440) return 'On the day at 9 AM'
    return minutes === 1440 ? '1 day before at 9 AM' : '2 days before at 9 AM'
  }
  switch (minutes) {
    case 0: return 'At due time'
    case 10: return '10 minutes before'
    case 60: return '1 hour before'
    case 1440: return '1 day before'
    default: return '2 days before'
  }
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'None', low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent'
}

export interface TaskNames {
  list: (id: string) => string | null
  label: (id: string) => string | null
  board: (id: string) => string | null
}

function quoted(value: string, limit = 60): string {
  const trimmed = value.trim()
  return `"${trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed}"`
}

function clip(text: string): string {
  return text.length > TASK_ACTIVITY_TEXT_LIMIT ? `${text.slice(0, TASK_ACTIVITY_TEXT_LIMIT - 1)}…` : text
}

function labelName(names: TaskNames, id: string): string {
  const name = names.label(id)
  return name ? quoted(name) : 'a label'
}

function checklistActivity(before: readonly TaskChecklist[], after: readonly TaskChecklist[]): Array<Omit<TaskActivity, 'at'>> {
  const entries: Array<Omit<TaskActivity, 'at'>> = []
  const previous = new Map(before.map((checklist) => [checklist.id, checklist]))
  const next = new Map(after.map((checklist) => [checklist.id, checklist]))
  for (const checklist of after) {
    const old = previous.get(checklist.id)
    if (!old) {
      entries.push({ kind: 'checklist', text: `Added checklist ${quoted(checklist.title)}` })
      continue
    }
    const oldItems = new Map(old.items.map((item) => [item.id, item]))
    for (const item of checklist.items) {
      const was = oldItems.get(item.id)
      if (!was || (was.doneAt === null) === (item.doneAt === null)) continue
      entries.push({
        kind: 'checklist',
        text: item.doneAt ? `Completed ${quoted(item.text)} on ${quoted(checklist.title)}` : `Marked ${quoted(item.text)} incomplete on ${quoted(checklist.title)}`
      })
    }
  }
  for (const checklist of before) {
    if (!next.has(checklist.id)) entries.push({ kind: 'checklist', text: `Removed checklist ${quoted(checklist.title)}` })
  }
  return entries
}

/**
 * The log lines one edit adds, in the words Trello uses. `before` is null for a new card. Names
 * are read as they are now, so a later rename leaves old lines as they were written.
 */
export function taskActivityFor(before: TaskCardInput | null, after: TaskCardInput, names: TaskNames, at: string): TaskActivity[] {
  const entries: Array<Omit<TaskActivity, 'at'>> = []
  const listName = (id: string): string => quoted(names.list(id) ?? 'a list')
  if (!before) {
    entries.push({ kind: 'create', text: `Added this card to ${listName(after.listId)}` })
  } else {
    if (before.boardId !== after.boardId) {
      entries.push({ kind: 'move', text: `Moved this card from ${quoted(names.board(before.boardId) ?? 'another board')} to ${quoted(names.board(after.boardId) ?? 'this board')}` })
    } else if (before.listId !== after.listId) {
      entries.push({ kind: 'move', text: `Moved this card from ${listName(before.listId)} to ${listName(after.listId)}` })
    }
    if (before.title.trim() !== after.title.trim()) {
      entries.push({ kind: 'rename', text: `Renamed this card from ${quoted(before.title)} to ${quoted(after.title)}` })
    }
    if (before.doneAt === null && after.doneAt !== null) entries.push({ kind: 'done', text: 'Marked this card as done' })
    if (before.doneAt !== null && after.doneAt === null) entries.push({ kind: 'reopen', text: 'Marked this card as not done' })
    if (before.dueDate !== after.dueDate || before.dueTime !== after.dueTime) {
      entries.push({
        kind: 'due',
        text: after.dueDate === null
          ? 'Removed the due date'
          : `${before.dueDate === null ? 'Set' : 'Changed'} the due date to ${taskDueLabel(after.dueDate, after.dueTime)}`
      })
    }
    if (before.priority !== after.priority) {
      entries.push({
        kind: 'priority',
        text: after.priority === 'none' ? 'Cleared the priority' : `Set the priority to ${TASK_PRIORITY_LABELS[after.priority]}`
      })
    }
    if (before.description !== after.description) {
      entries.push({ kind: 'description', text: after.description.trim() ? 'Updated the description' : 'Cleared the description' })
    }
    if (before.boardId === after.boardId) {
      for (const id of after.labelIds) if (!before.labelIds.includes(id)) entries.push({ kind: 'label', text: `Added the label ${labelName(names, id)}` })
      for (const id of before.labelIds) if (!after.labelIds.includes(id)) entries.push({ kind: 'label', text: `Removed the label ${labelName(names, id)}` })
    }
    entries.push(...checklistActivity(before.checklists, after.checklists))
    const oldFiles = new Set(before.attachments.map((file) => file.id))
    const newFiles = new Set(after.attachments.map((file) => file.id))
    for (const file of after.attachments) {
      if (!oldFiles.has(file.id)) entries.push({ kind: 'attachment', text: `Attached ${quoted(file.fileName ?? (file.kind === 'file' ? 'a file' : `a ${file.kind}`))}` })
    }
    for (const file of before.attachments) {
      if (!newFiles.has(file.id)) entries.push({ kind: 'attachment', text: `Removed ${quoted(file.fileName ?? (file.kind === 'file' ? 'a file' : `a ${file.kind}`))}` })
    }
    if (before.archivedAt === null && after.archivedAt !== null) entries.push({ kind: 'archive', text: 'Archived this card' })
    if (before.archivedAt !== null && after.archivedAt === null) entries.push({ kind: 'restore', text: 'Sent this card back to the board' })
  }
  return entries.map((entry) => ({ at, kind: entry.kind, text: clip(entry.text) }))
}

export function appendTaskActivity(activity: readonly TaskActivity[], entries: readonly TaskActivity[]): TaskActivity[] {
  const next = [...activity, ...entries]
  return next.length > TASK_ACTIVITY_LIMIT ? next.slice(next.length - TASK_ACTIVITY_LIMIT) : next
}

/** Applies an edit and logs it. The caller writes the result as the card's new state. */
export function withTaskActivity(before: TaskCardInput | null, after: TaskCardInput, names: TaskNames, at: string): TaskCardInput {
  const entries = taskActivityFor(before, after, names, at)
  if (entries.length === 0) return after
  return { ...after, activity: appendTaskActivity(after.activity, entries) }
}

/** A saved card as the input that would write it again. */
export function taskCardInput(card: TaskCardInput): TaskCardInput {
  return {
    boardId: card.boardId, listId: card.listId, title: card.title, description: card.description, position: card.position,
    labelIds: card.labelIds, priority: card.priority, dueDate: card.dueDate, dueTime: card.dueTime,
    reminderMinutes: card.reminderMinutes, doneAt: card.doneAt, archivedAt: card.archivedAt,
    checklists: card.checklists, attachments: card.attachments, activity: card.activity
  }
}
