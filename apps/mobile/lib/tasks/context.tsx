import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { TaskBoardRecord, TaskCardRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import {
  isTaskBoardInput, isTaskCardInput, isTaskGoalInput, isTaskListInput, taskGoalInput, withTaskActivity,
  type TaskAttachment, type TaskBoardInput, type TaskCardInput, type TaskGoalInput, type TaskLabelColor, type TaskLabelInput,
  type TaskListInput, type TaskNames
} from '@ego/core'
import type { LocalDatabase } from '@ego/local/database/types'
import { persistDraft, type DraftFile } from '../diary/compose'
import { deleteLocalFiles } from '../diary/media'
import { dropUnusedUploads, localMediaFiles, queueUploads, retryRecordUploads, type QueuedUpload } from '@ego/local/diary/uploads'
import { useLedger, type LocalWrite } from '../ledger-context'
import {
  createTaskBoard, createTaskGoal, createTaskLabel, createTaskList, deleteTaskBoard, deleteTaskCard, deleteTaskGoal,
  deleteTaskLabel, deleteTaskList, newId, saveTaskCard, updateTaskBoard, updateTaskGoal, updateTaskLabel, updateTaskList
} from '@ego/local/sync/commands'
import {
  boardLabels, boardLists, cardInput, carryLabels, endPosition, listCards, liveBoards, placeAt, startPosition
} from '@ego/local/tasks/board'
import { localTaskRevision, localTasks, type TaskData, type TaskTable } from '@ego/local/tasks/repository'

export const DEFAULT_LISTS = ['To Do', 'Doing', 'Done'] as const

export interface CardTarget {
  listId: string
  /** Another board's ID moves the card there. */
  boardId?: string
  index: number
  /** The cards the index counts through, in order, without the moving card. Defaults to the whole list. */
  siblingIds?: string[]
}

export interface CopyOptions {
  title: string
  boardId: string
  listId: string
  place: 'top' | 'bottom'
  keepLabels: boolean
  keepChecklists: boolean
  keepAttachments: boolean
}

interface TasksContextValue {
  enabled: boolean
  /** Null until the local database has been read. */
  data: TaskData | null
  /** Files this phone has a copy of, by media ID. */
  localFiles: ReadonlyMap<string, string>
  /** Moves on each minute and each return to the app, so due badges stay true. */
  now: Date
  error: string | null
  dismissError: () => void
  createBoard: (name: string, icon: string) => Promise<string | null>
  updateBoard: (boardId: string, changes: Partial<TaskBoardInput>) => Promise<boolean>
  moveBoard: (boardId: string, index: number) => Promise<boolean>
  deleteBoard: (boardId: string) => Promise<boolean>
  createList: (boardId: string, name: string) => Promise<string | null>
  updateList: (listId: string, changes: Partial<TaskListInput>) => Promise<boolean>
  moveList: (listId: string, index: number) => Promise<boolean>
  deleteList: (listId: string) => Promise<boolean>
  archiveListCards: (listId: string) => Promise<boolean>
  saveLabel: (boardId: string, labelId: string | null, name: string, color: TaskLabelColor) => Promise<string | null>
  deleteLabel: (labelId: string) => Promise<boolean>
  createCard: (listId: string, title: string, place?: 'top' | 'bottom') => Promise<string | null>
  updateCard: (cardId: string, change: (input: TaskCardInput) => TaskCardInput) => Promise<boolean>
  moveCard: (cardId: string, target: CardTarget) => Promise<boolean>
  copyCard: (cardId: string, options: CopyOptions) => Promise<string | null>
  addFiles: (cardId: string, drafts: readonly DraftFile[]) => Promise<boolean>
  removeFile: (cardId: string, attachmentId: string) => Promise<boolean>
  deleteCard: (cardId: string) => Promise<boolean>
  retryUploads: (cardId: string) => Promise<boolean>
  createGoal: (input: TaskGoalInput) => Promise<string | null>
  updateGoal: (goalId: string, change: (input: TaskGoalInput) => TaskGoalInput) => Promise<boolean>
  deleteGoal: (goalId: string) => Promise<boolean>
}

const TasksContext = createContext<TasksContextValue | null>(null)

export function namesFor(data: TaskData): TaskNames {
  return {
    list: (id) => data.lists.find((list) => list.id === id)?.name ?? null,
    label: (id) => data.labels.find((label) => label.id === id)?.name || null,
    board: (id) => data.boards.find((board) => board.id === id)?.name ?? null
  }
}

function boardInput(board: TaskBoardRecord): TaskBoardInput {
  return { name: board.name, icon: board.icon, position: board.position, hideDone: board.hideDone, archivedAt: board.archivedAt }
}

function listInput(list: TaskListRecord): TaskListInput {
  return { boardId: list.boardId, name: list.name, position: list.position, archivedAt: list.archivedAt }
}

function labelInput(label: TaskLabelRecord): TaskLabelInput {
  return { boardId: label.boardId, name: label.name, color: label.color, position: label.position }
}

function stamp(now: string): { createdAt: string; updatedAt: string; revision: number } {
  return { createdAt: now, updatedAt: now, revision: 1 }
}

function replaceById<T extends { id: string }>(items: readonly T[], id: string, change: (item: T) => T): T[] {
  return items.map((item) => item.id === id ? change(item) : item)
}

async function revisionOf(db: LocalDatabase, table: TaskTable, id: string): Promise<number> {
  const revision = await localTaskRevision(db, table, id)
  if (revision === null) throw new Error('That was deleted on another device')
  return revision
}

function attachmentFrom(persisted: Awaited<ReturnType<typeof persistDraft>>, now: string): TaskAttachment {
  const source = persisted.attachment
  return {
    id: newId(),
    mediaId: source.mediaId ?? newId(),
    kind: source.kind === 'photo' || source.kind === 'video' ? source.kind : 'file',
    mimeType: source.mimeType,
    fileName: source.fileName,
    size: source.size,
    width: source.width,
    height: source.height,
    durationSeconds: source.durationSeconds,
    previewId: source.previewId,
    addedAt: now
  }
}

/**
 * Tasks shares the ledger's database and outbox. Every change shows on screen before it is
 * written, and writes run one at a time in the order they were made, each built from the state
 * the one before it left, so a quick run of edits never loses one.
 */
export function TasksProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { db, ready, enabled, tasksVersion, write } = useLedger()
  const [data, setDataState] = useState<TaskData | null>(null)
  const [localFiles, setLocalFiles] = useState<ReadonlyMap<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const dataRef = useRef<TaskData | null>(null)
  const pending = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const setData = useCallback((next: TaskData | null): void => {
    dataRef.current = next
    setDataState(next)
  }, [])

  useEffect(() => {
    if (!db || !ready) {
      setData(null)
      return
    }
    let active = true
    void Promise.all([localTasks(db), localMediaFiles(db, 'tasks')])
      .then(([next, files]) => {
        if (!active || pending.current > 0) return
        setData(next)
        setLocalFiles(files)
      })
      .catch(() => { if (active) setError('This phone could not read its boards') })
    return () => { active = false }
  }, [db, ready, tasksVersion, reloads, setData])

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date())
    })
    return () => {
      clearInterval(tick)
      subscription.remove()
    }
  }, [])

  const commit = useCallback(async (patch: ((current: TaskData) => TaskData) | null, work: LocalWrite, failure: string): Promise<boolean> => {
    pending.current += 1
    if (patch && dataRef.current) setData(patch(dataRef.current))
    const next = queue.current.then(() => write(work, 'tasks'))
    queue.current = next.catch(() => undefined)
    const saved = await next.catch(() => false)
    pending.current -= 1
    if (!saved) setError(failure)
    if (pending.current === 0) setReloads((count) => count + 1)
    return saved
  }, [setData, write])

  const createBoard = useCallback(async (name: string, icon: string): Promise<string | null> => {
    const current = dataRef.current
    if (!current) return null
    const at = new Date().toISOString()
    const id = newId()
    const board: TaskBoardInput = { name: name.trim(), icon: icon.trim(), position: endPosition(liveBoards(current)), hideDone: false, archivedAt: null }
    if (!isTaskBoardInput(board)) {
      setError('Give the board a name')
      return null
    }
    const lists = DEFAULT_LISTS.map((listName, index): TaskListRecord => ({
      id: newId(), boardId: id, name: listName, position: (index + 1) * 1024, archivedAt: null, ...stamp(at)
    }))
    const saved = await commit(
      (data) => ({ ...data, boards: [...data.boards, { id, ...board, ...stamp(at) }], lists: [...data.lists, ...lists] }),
      (database, time) => database.transaction(async (tx) => {
        await createTaskBoard(tx, board, time, id)
        for (const list of lists) await createTaskList(tx, listInput(list), time, list.id)
      }),
      'This phone could not create that board')
    return saved ? id : null
  }, [commit])

  const updateBoard = useCallback(async (boardId: string, changes: Partial<TaskBoardInput>): Promise<boolean> => {
    const board = dataRef.current?.boards.find((item) => item.id === boardId)
    if (!board) return false
    const input = { ...boardInput(board), ...changes }
    if (!isTaskBoardInput(input)) {
      setError('Give the board a name')
      return false
    }
    return commit(
      (data) => ({ ...data, boards: replaceById(data.boards, boardId, (item) => ({ ...item, ...input })) }),
      async (database, time) => { await updateTaskBoard(database, boardId, await revisionOf(database, 'task_boards', boardId), input, time) },
      'This phone could not save that board')
  }, [commit])

  const moveBoard = useCallback(async (boardId: string, index: number): Promise<boolean> => {
    const current = dataRef.current
    if (!current) return false
    const siblings = liveBoards(current).filter((board) => board.id !== boardId)
    const placement = placeAt(siblings, index, boardId)
    const positions = placement.renumber ?? [{ id: boardId, position: placement.position }]
    return commit(
      (data) => ({ ...data, boards: data.boards.map((board) => ({ ...board, position: positions.find((item) => item.id === board.id)?.position ?? board.position })) }),
      (database, time) => database.transaction(async (tx) => {
        for (const { id, position } of positions) {
          const board = current.boards.find((item) => item.id === id)
          if (board) await updateTaskBoard(tx, id, await revisionOf(tx, 'task_boards', id), { ...boardInput(board), position }, time)
        }
      }),
      'This phone could not reorder your boards')
  }, [commit])

  const deleteBoard = useCallback((boardId: string): Promise<boolean> => commit(
    (data) => ({ ...data, boards: data.boards.filter((board) => board.id !== boardId) }),
    async (database, time) => { await deleteTaskBoard(database, boardId, await revisionOf(database, 'task_boards', boardId), time) },
    'This phone could not delete that board'), [commit])

  const createList = useCallback(async (boardId: string, name: string): Promise<string | null> => {
    const current = dataRef.current
    if (!current) return null
    const id = newId()
    const at = new Date().toISOString()
    const input: TaskListInput = { boardId, name: name.trim(), position: endPosition(boardLists(current, boardId)), archivedAt: null }
    if (!isTaskListInput(input)) {
      setError('Give the list a name')
      return null
    }
    const saved = await commit(
      (data) => ({ ...data, lists: [...data.lists, { id, ...input, ...stamp(at) }] }),
      async (database, time) => { await createTaskList(database, input, time, id) },
      'This phone could not add that list')
    return saved ? id : null
  }, [commit])

  const updateList = useCallback(async (listId: string, changes: Partial<TaskListInput>): Promise<boolean> => {
    const list = dataRef.current?.lists.find((item) => item.id === listId)
    if (!list) return false
    const input = { ...listInput(list), ...changes }
    if (!isTaskListInput(input)) {
      setError('Give the list a name')
      return false
    }
    return commit(
      (data) => ({ ...data, lists: replaceById(data.lists, listId, (item) => ({ ...item, ...input })) }),
      async (database, time) => { await updateTaskList(database, listId, await revisionOf(database, 'task_lists', listId), input, time) },
      'This phone could not save that list')
  }, [commit])

  const moveList = useCallback(async (listId: string, index: number): Promise<boolean> => {
    const current = dataRef.current
    const list = current?.lists.find((item) => item.id === listId)
    if (!current || !list) return false
    const siblings = boardLists(current, list.boardId).filter((item) => item.id !== listId)
    const placement = placeAt(siblings, index, listId)
    const positions = placement.renumber ?? [{ id: listId, position: placement.position }]
    return commit(
      (data) => ({ ...data, lists: data.lists.map((item) => ({ ...item, position: positions.find((entry) => entry.id === item.id)?.position ?? item.position })) }),
      (database, time) => database.transaction(async (tx) => {
        for (const { id, position } of positions) {
          const item = current.lists.find((entry) => entry.id === id)
          if (item) await updateTaskList(tx, id, await revisionOf(tx, 'task_lists', id), { ...listInput(item), position }, time)
        }
      }),
      'This phone could not move that list')
  }, [commit])

  const deleteList = useCallback((listId: string): Promise<boolean> => commit(
    (data) => ({ ...data, lists: data.lists.filter((list) => list.id !== listId), cards: data.cards.filter((card) => card.listId !== listId) }),
    async (database, time) => { await deleteTaskList(database, listId, await revisionOf(database, 'task_lists', listId), time) },
    'This phone could not delete that list'), [commit])

  const saveLabel = useCallback(async (boardId: string, labelId: string | null, name: string, color: TaskLabelColor): Promise<string | null> => {
    const current = dataRef.current
    if (!current) return null
    const at = new Date().toISOString()
    const existing = labelId ? current.labels.find((label) => label.id === labelId) : undefined
    const id = existing?.id ?? newId()
    const input: TaskLabelInput = existing
      ? { ...labelInput(existing), name: name.trim(), color }
      : { boardId, name: name.trim(), color, position: endPosition(boardLabels(current, boardId)) }
    const saved = await commit(
      (data) => ({
        ...data,
        labels: existing
          ? replaceById(data.labels, id, (label) => ({ ...label, ...input }))
          : [...data.labels, { id, ...input, ...stamp(at) }]
      }),
      async (database, time) => {
        if (existing) await updateTaskLabel(database, id, await revisionOf(database, 'task_labels', id), input, time)
        else await createTaskLabel(database, input, time, id)
      },
      'This phone could not save that label')
    return saved ? id : null
  }, [commit])

  const deleteLabel = useCallback((labelId: string): Promise<boolean> => commit(
    (data) => ({ ...data, labels: data.labels.filter((label) => label.id !== labelId) }),
    async (database, time) => { await deleteTaskLabel(database, labelId, await revisionOf(database, 'task_labels', labelId), time) },
    'This phone could not delete that label'), [commit])

  /** Writes one card's new state, logged against what it was. `held` waits for files queued with it. */
  const saveCard = useCallback((
    card: TaskCardRecord, next: TaskCardInput, failure: string,
    extra?: (tx: LocalDatabase, time: string) => Promise<void>, held = false
  ): Promise<boolean> => {
    const current = dataRef.current
    if (!current) return Promise.resolve(false)
    const at = new Date().toISOString()
    const logged = withTaskActivity(cardInput(card), next, namesFor(current), at)
    const titled = logged.title.trim() !== ''
    if (!isTaskCardInput(logged)) {
      setError(titled ? 'That card is too long to save' : 'Give the card a title')
      return Promise.resolve(false)
    }
    return commit(
      (data) => ({ ...data, cards: replaceById(data.cards, card.id, (item) => ({ ...item, ...logged, updatedAt: at })) }),
      (database, time) => database.transaction(async (tx) => {
        await saveTaskCard(tx, card.id, await revisionOf(tx, 'task_cards', card.id), logged, time, held)
        if (extra) await extra(tx, time)
      }),
      failure)
  }, [commit])

  const createCard = useCallback(async (listId: string, title: string, place: 'top' | 'bottom' = 'bottom'): Promise<string | null> => {
    const current = dataRef.current
    const list = current?.lists.find((item) => item.id === listId)
    if (!current || !list) return null
    const cards = listCards(current, listId)
    const at = new Date().toISOString()
    const id = newId()
    const input = withTaskActivity(null, {
      boardId: list.boardId, listId, title: title.trim(), description: '',
      position: place === 'top' ? startPosition(cards) : endPosition(cards), labelIds: [], priority: 'none',
      dueDate: null, dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [], attachments: [],
      activity: []
    }, namesFor(current), at)
    if (!isTaskCardInput(input)) {
      setError('Give the card a title')
      return null
    }
    const saved = await commit(
      (data) => ({ ...data, cards: [...data.cards, { id, ...input, ...stamp(at) }] }),
      async (database, time) => { await saveTaskCard(database, id, null, input, time) },
      'This phone could not add that card')
    return saved ? id : null
  }, [commit])

  const updateCard = useCallback((cardId: string, change: (input: TaskCardInput) => TaskCardInput): Promise<boolean> => {
    const card = dataRef.current?.cards.find((item) => item.id === cardId)
    if (!card) return Promise.resolve(false)
    return saveCard(card, change(cardInput(card)), 'This phone could not save that card')
  }, [saveCard])

  const moveCard = useCallback(async (cardId: string, target: CardTarget): Promise<boolean> => {
    const current = dataRef.current
    const card = current?.cards.find((item) => item.id === cardId)
    const list = current?.lists.find((item) => item.id === target.listId)
    if (!current || !card || !list) return false
    const siblings = target.siblingIds
      ? target.siblingIds.flatMap((id) => current.cards.filter((item) => item.id === id))
      : listCards(current, target.listId).filter((item) => item.id !== cardId)
    const placement = placeAt(siblings, target.index, cardId)
    const boardId = target.boardId ?? list.boardId
    const labelIds = boardId === card.boardId
      ? card.labelIds
      : carryLabels(card.labelIds, boardLabels(current, card.boardId), boardLabels(current, boardId))
    const moved: TaskCardInput = { ...cardInput(card), boardId, listId: target.listId, position: placement.position, labelIds }
    const others = (placement.renumber ?? []).filter((item) => item.id !== cardId)
    const at = new Date().toISOString()
    const logged = withTaskActivity(cardInput(card), moved, namesFor(current), at)
    return commit(
      (data) => ({
        ...data,
        cards: data.cards.map((item) => {
          if (item.id === cardId) return { ...item, ...logged, updatedAt: at }
          const spaced = others.find((entry) => entry.id === item.id)
          return spaced ? { ...item, position: spaced.position } : item
        })
      }),
      (database, time) => database.transaction(async (tx) => {
        await saveTaskCard(tx, cardId, await revisionOf(tx, 'task_cards', cardId), logged, time)
        for (const { id, position } of others) {
          const sibling = current.cards.find((item) => item.id === id)
          if (sibling) await saveTaskCard(tx, id, await revisionOf(tx, 'task_cards', id), { ...cardInput(sibling), position }, time)
        }
      }),
      'This phone could not move that card')
  }, [commit])

  const copyCard = useCallback(async (cardId: string, options: CopyOptions): Promise<string | null> => {
    const current = dataRef.current
    const card = current?.cards.find((item) => item.id === cardId)
    if (!current || !card) return null
    const at = new Date().toISOString()
    const id = newId()
    const cards = listCards(current, options.listId)
    const uploading = current.uploads.has(cardId)
    const sourceBoard = current.boards.find((board) => board.id === card.boardId)
    const input: TaskCardInput = {
      ...cardInput(card),
      boardId: options.boardId,
      listId: options.listId,
      title: options.title.trim(),
      position: options.place === 'top' ? startPosition(cards) : endPosition(cards),
      labelIds: options.keepLabels
        ? options.boardId === card.boardId ? card.labelIds : carryLabels(card.labelIds, boardLabels(current, card.boardId), boardLabels(current, options.boardId))
        : [],
      checklists: options.keepChecklists ? card.checklists : [],
      attachments: options.keepAttachments && !uploading ? card.attachments : [],
      doneAt: null,
      archivedAt: null,
      activity: [{ at, kind: 'copy', text: `Copied this card from "${card.title.trim()}"${sourceBoard && options.boardId !== card.boardId ? ` on "${sourceBoard.name}"` : ''}`.slice(0, 300) }]
    }
    if (!isTaskCardInput(input)) {
      setError('Give the copy a title')
      return null
    }
    const saved = await commit(
      (data) => ({ ...data, cards: [...data.cards, { id, ...input, ...stamp(at) }] }),
      async (database, time) => { await saveTaskCard(database, id, null, input, time) },
      'This phone could not copy that card')
    return saved ? id : null
  }, [commit])

  const addFiles = useCallback(async (cardId: string, drafts: readonly DraftFile[]): Promise<boolean> => {
    const card = dataRef.current?.cards.find((item) => item.id === cardId)
    if (!card || drafts.length === 0) return false
    let persisted: Awaited<ReturnType<typeof persistDraft>>[]
    try {
      persisted = await Promise.all(drafts.map(persistDraft))
    } catch {
      setError('This phone could not read one of those files')
      return false
    }
    const at = new Date().toISOString()
    const attachments = persisted.map((item) => attachmentFrom(item, at))
    const uploads: QueuedUpload[] = persisted.flatMap((item) => item.uploads.map((upload) => ({ ...upload, messageId: cardId, scope: 'tasks' as const })))
    setLocalFiles((files) => new Map([...files, ...uploads.map((upload): [string, string] => [upload.mediaId, upload.localUri])]))
    const latest = dataRef.current?.cards.find((item) => item.id === cardId) ?? card
    const saved = await saveCard(latest, { ...cardInput(latest), attachments: [...latest.attachments, ...attachments] },
      'This phone could not attach those files', (tx, time) => queueUploads(tx, uploads, time), true)
    if (!saved) deleteLocalFiles(uploads.map((upload) => upload.localUri))
    return saved
  }, [saveCard])

  const removeFile = useCallback(async (cardId: string, attachmentId: string): Promise<boolean> => {
    const card = dataRef.current?.cards.find((item) => item.id === cardId)
    if (!card) return false
    const attachments = card.attachments.filter((item) => item.id !== attachmentId)
    const keep = attachments.flatMap((item) => item.previewId ? [item.mediaId, item.previewId] : [item.mediaId])
    let dropped: string[] = []
    const saved = await saveCard(card, { ...cardInput(card), attachments }, 'This phone could not remove that file',
      async (tx) => { dropped = await dropUnusedUploads(tx, cardId, keep) })
    if (saved) deleteLocalFiles(dropped)
    return saved
  }, [saveCard])

  const deleteCard = useCallback(async (cardId: string): Promise<boolean> => {
    let files: string[] = []
    const saved = await commit(
      (data) => ({ ...data, cards: data.cards.filter((card) => card.id !== cardId) }),
      async (database, time) => { files = await deleteTaskCard(database, cardId, await revisionOf(database, 'task_cards', cardId), time) },
      'This phone could not delete that card')
    if (saved) deleteLocalFiles(files)
    return saved
  }, [commit])

  const archiveListCards = useCallback(async (listId: string): Promise<boolean> => {
    const current = dataRef.current
    if (!current) return false
    const at = new Date().toISOString()
    const names = namesFor(current)
    const archived = listCards(current, listId).map((card) => ({
      card, input: withTaskActivity(cardInput(card), { ...cardInput(card), archivedAt: at }, names, at)
    }))
    if (archived.length === 0) return true
    return commit(
      (data) => ({ ...data, cards: data.cards.map((card) => card.listId === listId && card.archivedAt === null ? { ...card, archivedAt: at } : card) }),
      (database, time) => database.transaction(async (tx) => {
        for (const { card, input } of archived) await saveTaskCard(tx, card.id, await revisionOf(tx, 'task_cards', card.id), input, time)
      }),
      'This phone could not archive those cards')
  }, [commit])

  const retryUploads = useCallback((cardId: string): Promise<boolean> =>
    commit(null, (database) => retryRecordUploads(database, 'taskCard', cardId), 'This phone could not try those files again'), [commit])

  const createGoal = useCallback(async (input: TaskGoalInput): Promise<string | null> => {
    const current = dataRef.current
    if (!current) return null
    const id = newId()
    const at = new Date().toISOString()
    const next: TaskGoalInput = { ...input, title: input.title.trim(), position: endPosition(current.goals ?? []) }
    if (!isTaskGoalInput(next)) {
      setError('Give the goal a title')
      return null
    }
    const saved = await commit(
      (data) => ({ ...data, goals: [...(data.goals ?? []), { id, ...next, ...stamp(at) }] }),
      async (database, time) => { await createTaskGoal(database, next, time, id) },
      'This phone could not create that goal')
    return saved ? id : null
  }, [commit])

  const updateGoal = useCallback(async (goalId: string, change: (input: TaskGoalInput) => TaskGoalInput): Promise<boolean> => {
    const goal = dataRef.current?.goals?.find((item) => item.id === goalId)
    if (!goal) return false
    const next = change(taskGoalInput(goal))
    if (!isTaskGoalInput(next)) {
      setError('That goal could not be saved')
      return false
    }
    const at = new Date().toISOString()
    return commit(
      (data) => ({ ...data, goals: replaceById(data.goals ?? [], goalId, (item) => ({ ...item, ...next, updatedAt: at })) }),
      async (database, time) => { await updateTaskGoal(database, goalId, await revisionOf(database, 'task_goals', goalId), next, time) },
      'This phone could not save that goal')
  }, [commit])

  const deleteGoal = useCallback((goalId: string): Promise<boolean> => commit(
    (data) => ({ ...data, goals: (data.goals ?? []).filter((goal) => goal.id !== goalId) }),
    async (database, time) => { await deleteTaskGoal(database, goalId, await revisionOf(database, 'task_goals', goalId), time) },
    'This phone could not delete that goal'), [commit])

  const dismissError = useCallback(() => setError(null), [])

  const value = useMemo<TasksContextValue>(() => ({
    enabled, data, localFiles, now, error, dismissError,
    createBoard, updateBoard, moveBoard, deleteBoard,
    createList, updateList, moveList, deleteList, archiveListCards,
    saveLabel, deleteLabel,
    createCard, updateCard, moveCard, copyCard, addFiles, removeFile, deleteCard, retryUploads,
    createGoal, updateGoal, deleteGoal
  }), [addFiles, archiveListCards, copyCard, createBoard, createCard, createList, data, deleteBoard, deleteCard, deleteLabel,
    deleteList, dismissError, enabled, error, localFiles, moveBoard, moveCard, moveList, now, removeFile, retryUploads, saveLabel,
    updateBoard, updateCard, updateList, createGoal, updateGoal, deleteGoal])

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext)
  if (!context) throw new Error('useTasks must be used inside TasksProvider')
  return context
}
