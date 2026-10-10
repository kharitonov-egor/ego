import type { TaskBoardRecord, TaskCardRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import {
  checklistProgress, positionBetween, positionsTooClose, taskDueAt, taskDueLabel, taskTimeLabel, withTaskActivity,
  type TaskAttachment, type TaskCardInput, type TaskNames, type TaskPriority
} from '@ego/core'
import { isoFromParts } from '../dates'
import type { TaskData } from './repository'

export { taskCardInput as cardInput } from '@ego/core'

export function byPosition<T extends { position: number; createdAt: string }>(left: T, right: T): number {
  return left.position - right.position || left.createdAt.localeCompare(right.createdAt)
}

export function liveBoards(data: TaskData): TaskBoardRecord[] {
  return data.boards.filter((board) => board.archivedAt === null).sort(byPosition)
}

export function boardLists(data: TaskData, boardId: string): TaskListRecord[] {
  return data.lists.filter((list) => list.boardId === boardId && list.archivedAt === null).sort(byPosition)
}

/** The first live Inbox list under a live board. Quick add and the inbox endpoint write there. */
export function inboxList(data: TaskData): TaskListRecord | null {
  for (const board of liveBoards(data)) {
    const list = boardLists(data, board.id).find((item) => item.kind === 'inbox')
    if (list) return list
  }
  return null
}

/** The board Tasks opens on: the one holding the Inbox. */
export function homeBoardId(data: TaskData): string | null {
  return inboxList(data)?.boardId ?? null
}

export function taskNamesFor(data: TaskData): TaskNames {
  return {
    list: (id) => data.lists.find((list) => list.id === id)?.name ?? null,
    label: (id) => data.labels.find((label) => label.id === id)?.name || null,
    board: (id) => data.boards.find((board) => board.id === id)?.name ?? null
  }
}

export interface InboxCardFields {
  title: string
  description: string
  attachments: TaskAttachment[]
}

/** A new card at the bottom of the Inbox, logged the way a card added on the board is. Null without an Inbox. */
export function inboxCardInput(data: TaskData, fields: InboxCardFields, at: string): TaskCardInput | null {
  const list = inboxList(data)
  if (!list) return null
  return withTaskActivity(null, {
    boardId: list.boardId, listId: list.id, title: fields.title.trim(), description: fields.description.trim(),
    position: endPosition(listCards(data, list.id)), labelIds: [], priority: 'none', dueDate: null, dueTime: null,
    reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [], attachments: fields.attachments, activity: []
  }, taskNamesFor(data), at)
}

export function boardLabels(data: TaskData, boardId: string): TaskLabelRecord[] {
  return data.labels.filter((label) => label.boardId === boardId).sort(byPosition)
}

export function listCards(data: TaskData, listId: string): TaskCardRecord[] {
  return data.cards.filter((card) => card.listId === listId && card.archivedAt === null).sort(byPosition)
}

/** A card shows on a board, and in Upcoming, only while its board and list are live too. */
export function isCardVisible(data: TaskData, card: TaskCardRecord): boolean {
  if (card.archivedAt !== null) return false
  const list = data.lists.find((item) => item.id === card.listId)
  const board = data.boards.find((item) => item.id === card.boardId)
  return Boolean(list && board && list.archivedAt === null && board.archivedAt === null)
}

export type DueFilter = 'overdue' | 'today' | 'week' | 'none'

export interface CardFilter {
  text: string
  labelIds: string[]
  priorities: TaskPriority[]
  due: DueFilter[]
}

export const NO_FILTER: CardFilter = { text: '', labelIds: [], priorities: [], due: [] }

export function isFiltering(filter: CardFilter): boolean {
  return filter.text.trim() !== '' || filter.labelIds.length > 0 || filter.priorities.length > 0 || filter.due.length > 0
}

export function localDay(instant: Date): string {
  return isoFromParts(instant.getFullYear(), instant.getMonth(), instant.getDate())
}

function addDays(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days)
}

function matchesDue(card: TaskCardRecord, due: DueFilter, now: Date): boolean {
  if (due === 'none') return card.dueDate === null
  if (card.dueDate === null) return false
  if (due === 'overdue') return card.doneAt === null && taskDueAt(card.dueDate, card.dueTime).getTime() < now.getTime()
  const today = localDay(now)
  if (due === 'today') return card.dueDate === today
  return card.dueDate >= today && card.dueDate <= localDay(addDays(now, 6))
}

/** Every group narrows the cards; inside one group any match counts, the way Trello's filter works. */
export function matchesFilter(card: TaskCardRecord, filter: CardFilter, now: Date): boolean {
  const text = filter.text.trim().toLowerCase()
  if (text && !card.title.toLowerCase().includes(text) && !card.description.toLowerCase().includes(text)) return false
  if (filter.labelIds.length > 0 && !filter.labelIds.some((id) => card.labelIds.includes(id))) return false
  if (filter.priorities.length > 0 && !filter.priorities.includes(card.priority)) return false
  if (filter.due.length > 0 && !filter.due.some((due) => matchesDue(card, due, now))) return false
  return true
}

export type DueState = 'done' | 'overdue' | 'soon' | 'later'

export interface DueBadge {
  label: string
  state: DueState
}

/** "Today at 5:30 PM", "Tomorrow", "Oct 3". Soon means within the next day. */
export function dueBadge(card: Pick<TaskCardRecord, 'dueDate' | 'dueTime' | 'doneAt'>, now: Date): DueBadge | null {
  if (card.dueDate === null) return null
  const today = localDay(now)
  const tomorrow = localDay(addDays(now, 1))
  const yesterday = localDay(addDays(now, -1))
  const time = card.dueTime ? ` at ${taskTimeLabel(card.dueTime)}` : ''
  const label = card.dueDate === today
    ? `Today${time}`
    : card.dueDate === tomorrow
      ? `Tomorrow${time}`
      : card.dueDate === yesterday
        ? `Yesterday${time}`
        : taskDueLabel(card.dueDate, card.dueTime, now.getFullYear())
  if (card.doneAt !== null) return { label, state: 'done' }
  const due = taskDueAt(card.dueDate, card.dueTime).getTime()
  if (due < now.getTime()) return { label, state: 'overdue' }
  if (due - now.getTime() <= 24 * 60 * 60 * 1000) return { label, state: 'soon' }
  return { label, state: 'later' }
}

export interface CardBadges {
  due: DueBadge | null
  checklist: { done: number; total: number } | null
  attachments: number
  description: boolean
}

export function cardBadges(card: TaskCardRecord, now: Date): CardBadges {
  const progress = checklistProgress(card.checklists)
  return {
    due: dueBadge(card, now),
    checklist: progress.total > 0 ? progress : null,
    attachments: card.attachments.length,
    description: card.description.trim() !== ''
  }
}

/** The first photo or video poster on a card, shown across its top like Trello's cover. */
export function coverOf(card: TaskCardRecord): { mediaId: string; width: number | null; height: number | null } | null {
  for (const attachment of card.attachments) {
    if (attachment.kind === 'photo') return { mediaId: attachment.previewId ?? attachment.mediaId, width: attachment.width, height: attachment.height }
    if (attachment.kind === 'video' && attachment.previewId) return { mediaId: attachment.previewId, width: attachment.width, height: attachment.height }
  }
  return null
}

export interface Placement {
  position: number
  /** Set when the gap ran out: every item in the new order with the position it should get. */
  renumber: Array<{ id: string; position: number }> | null
}

/**
 * Where an item lands at `index` among `siblings`, which leaves out the item itself. Usually only
 * the moved item changes; when halving has run out of room the whole order is spaced out again.
 */
export function placeAt<T extends { id: string; position: number }>(siblings: readonly T[], index: number, movingId: string): Placement {
  const clamped = Math.max(0, Math.min(index, siblings.length))
  const before = clamped > 0 ? siblings[clamped - 1].position : null
  const after = clamped < siblings.length ? siblings[clamped].position : null
  if (!positionsTooClose(before, after)) return { position: positionBetween(before, after), renumber: null }
  const order = [...siblings.slice(0, clamped).map((item) => item.id), movingId, ...siblings.slice(clamped).map((item) => item.id)]
  const renumber = order.map((id, position) => ({ id, position: (position + 1) * 1024 }))
  return { position: renumber[clamped].position, renumber }
}

export function endPosition(items: readonly { position: number }[]): number {
  return items.length === 0 ? positionBetween(null, null) : positionBetween(Math.max(...items.map((item) => item.position)), null)
}

export function startPosition(items: readonly { position: number }[]): number {
  return items.length === 0 ? positionBetween(null, null) : positionBetween(null, Math.min(...items.map((item) => item.position)))
}

/**
 * Labels are per board. A card moved or copied to another board keeps a label only when that
 * board has one with the same name and color.
 */
export function carryLabels(labelIds: readonly string[], from: readonly TaskLabelRecord[], to: readonly TaskLabelRecord[]): string[] {
  const carried: string[] = []
  for (const id of labelIds) {
    const label = from.find((item) => item.id === id)
    if (!label) continue
    const match = to.find((item) => item.name === label.name && item.color === label.color)
    if (match && !carried.includes(match.id)) carried.push(match.id)
  }
  return carried
}

export type UpcomingGroup = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'

export const UPCOMING_TITLES: Record<UpcomingGroup, string> = {
  overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', week: 'This week', later: 'Later'
}

export interface UpcomingSection {
  key: UpcomingGroup
  data: TaskCardRecord[]
}

/** Open cards with a due date from every live board, soonest first. Done cards are left out. */
export function upcomingSections(data: TaskData, now: Date): UpcomingSection[] {
  const today = localDay(now)
  const tomorrow = localDay(addDays(now, 1))
  const weekEnd = localDay(addDays(now, 6))
  const groups: Record<UpcomingGroup, TaskCardRecord[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [] }
  const open = data.cards
    .filter((card) => card.dueDate !== null && card.doneAt === null && isCardVisible(data, card))
    .sort((left, right) => taskDueAt(left.dueDate ?? '', left.dueTime).getTime() - taskDueAt(right.dueDate ?? '', right.dueTime).getTime())
  for (const card of open) {
    const day = card.dueDate ?? ''
    if (taskDueAt(day, card.dueTime).getTime() < now.getTime()) groups.overdue.push(card)
    else if (day === today) groups.today.push(card)
    else if (day === tomorrow) groups.tomorrow.push(card)
    else if (day <= weekEnd) groups.week.push(card)
    else groups.later.push(card)
  }
  return (Object.keys(groups) as UpcomingGroup[])
    .filter((key) => groups[key].length > 0)
    .map((key) => ({ key, data: groups[key] }))
}

export interface BoardSummary {
  open: number
  dueSoon: number
  overdue: number
}

export function boardSummary(data: TaskData, boardId: string, now: Date): BoardSummary {
  const summary: BoardSummary = { open: 0, dueSoon: 0, overdue: 0 }
  for (const card of data.cards) {
    if (card.boardId !== boardId || card.doneAt !== null || !isCardVisible(data, card)) continue
    summary.open += 1
    const badge = dueBadge(card, now)
    if (badge?.state === 'overdue') summary.overdue += 1
    if (badge?.state === 'soon') summary.dueSoon += 1
  }
  return summary
}

/** "Just now", "12 min ago", "3:05 PM", "Yesterday at 3:05 PM", "Oct 3 at 3:05 PM". */
export function activityTime(at: string, now: Date): string {
  const moment = new Date(at)
  const minutes = Math.floor((now.getTime() - moment.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = moment.getHours()
  const time = `${hours % 12 === 0 ? 12 : hours % 12}:${String(moment.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
  const day = localDay(moment)
  if (day === localDay(now)) return time
  if (day === localDay(addDays(now, -1))) return `Yesterday at ${time}`
  return `${taskDueLabel(day, null, now.getFullYear())} at ${time}`
}
