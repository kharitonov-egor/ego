import type { ApiResult } from '@ego/api-contracts'
import {
  isTaskCardInput, taskActivityFor, taskCardInput, withTaskActivity, type TaskAttachment, type TaskCardInput, type TaskNames
} from '@ego/core'
import { applyOperation } from './commands'
import { query } from './reads'
import { toTaskCardRecord, type TaskCardRow } from './rows'

const POSITION_STEP = 1024

interface InboxRow {
  list_id: string
  list_name: string
  board_id: string
  board_name: string
}

export interface InboxCard {
  title: string
  description: string
  attachments: TaskAttachment[]
}

export type InboxOutcome = 'added' | 'extended' | 'duplicate'

/** The first live Inbox list under a live board, in board order. */
export async function findInbox(db: D1Database): Promise<InboxRow | null> {
  const rows = await query<InboxRow>(db, `SELECT l.id AS list_id, l.name AS list_name, b.id AS board_id, b.name AS board_name
    FROM task_lists l JOIN task_boards b ON b.id = l.board_id AND b.deleted_at IS NULL AND b.archived_at IS NULL
    WHERE l.kind = 'inbox' AND l.deleted_at IS NULL AND l.archived_at IS NULL
    ORDER BY b.position, b.created_at, l.position LIMIT 1`, [])
  return rows[0] ?? null
}

function namesFor(inbox: InboxRow): TaskNames {
  return {
    list: (id) => id === inbox.list_id ? inbox.list_name : null,
    label: () => null,
    board: (id) => id === inbox.board_id ? inbox.board_name : null
  }
}

/**
 * Puts a card at the bottom of the Inbox under `id`. When that card already exists, which is how a
 * Telegram album arrives, the files it lacks join it and any new text goes under its description.
 */
export async function addToInbox(db: D1Database, id: string, card: InboxCard, now: string): Promise<ApiResult<InboxOutcome>> {
  const inbox = await findInbox(db)
  if (!inbox) return { ok: false, error: { code: 'NOT_FOUND', message: 'No board has an Inbox list' } }
  const names = namesFor(inbox)
  const existing = (await query<TaskCardRow & { deleted_at: string | null }>(db, 'SELECT * FROM task_cards WHERE id = ?', [id]))[0]
  if (existing) {
    if (existing.deleted_at) return { ok: true, data: 'duplicate' }
    const before = taskCardInput(toTaskCardRecord(existing))
    const known = new Set(before.attachments.map((file) => file.id))
    const files = card.attachments.filter((file) => !known.has(file.id))
    if (files.length === 0) return { ok: true, data: 'duplicate' }
    const text = card.description.trim()
    const next = withTaskActivity(before, {
      ...before,
      description: text && !before.description.includes(text) ? [before.description, text].filter(Boolean).join('\n\n') : before.description,
      attachments: [...before.attachments, ...files]
    }, names, now)
    if (!isTaskCardInput(next)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'That card is not valid' } }
    const result = await applyOperation(db, {
      operationId: crypto.randomUUID(), entityId: id, expectedRevision: existing.revision, createdAt: now,
      command: { entity: 'taskCard', type: 'update', payload: next }
    }, now)
    return result.ok ? { ok: true, data: 'extended' } : result
  }

  const ends = await query<{ position: number | null }>(db,
    'SELECT MAX(position) AS position FROM task_cards WHERE list_id = ? AND deleted_at IS NULL AND archived_at IS NULL', [inbox.list_id])
  const last = ends[0]?.position
  const draft: TaskCardInput = {
    boardId: inbox.board_id,
    listId: inbox.list_id,
    title: card.title,
    description: card.description,
    position: typeof last === 'number' ? last + POSITION_STEP : POSITION_STEP,
    labelIds: [],
    priority: 'none',
    dueDate: null,
    dueTime: null,
    reminderMinutes: null,
    doneAt: null,
    archivedAt: null,
    checklists: [],
    attachments: card.attachments,
    activity: []
  }
  const input: TaskCardInput = { ...draft, activity: taskActivityFor(null, draft, names, now) }
  if (!isTaskCardInput(input)) return { ok: false, error: { code: 'INVALID_REQUEST', message: 'That card is not valid' } }
  const result = await applyOperation(db, {
    operationId: id, entityId: id, expectedRevision: null, createdAt: now,
    command: { entity: 'taskCard', type: 'create', payload: input }
  }, now)
  if (!result.ok) return result
  return { ok: true, data: result.data.status === 'duplicate' ? 'duplicate' : 'added' }
}
