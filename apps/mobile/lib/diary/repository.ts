import type { DiaryMessageRecord } from '@ego/api-contracts'
import {
  diarySearchText, isDiaryAttachment,
  type DiaryAttachment, type DiaryEntity, type DiaryMessageInput, type DiarySource
} from '@ego/core'
import type { LocalDatabase } from '../database/types'
import type { OutboxStatus } from '../sync/outbox'

/** `sending` covers a message waiting on its files as well as one waiting on the network. */
export type DiaryDelivery = 'sent' | 'sending' | 'failed'

export interface LocalDiaryMessage extends DiaryMessageRecord {
  delivery: DiaryDelivery
  /** Lowercased text, file names, and sender, read once so search stays instant. */
  searchText: string
}

interface DiaryRow {
  id: string
  sent_at: string
  text: string
  entities: string
  attachments: string
  reply_to_id: string | null
  forwarded: number
  forwarded_from: string | null
  pinned_at: string | null
  edited_at: string | null
  source: DiarySource
  created_at: string
  updated_at: string
  revision: number
}

function list(raw: string): unknown[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function isEntity(value: unknown): value is DiaryEntity {
  return typeof value === 'object' && value !== null && 'type' in value &&
    'offset' in value && typeof value.offset === 'number' && 'length' in value && typeof value.length === 'number'
}

function recordFrom(row: DiaryRow): DiaryMessageRecord {
  return {
    id: row.id, sentAt: row.sent_at, text: row.text,
    entities: list(row.entities).filter(isEntity),
    attachments: list(row.attachments).filter((item): item is DiaryAttachment => isDiaryAttachment(item)),
    replyToId: row.reply_to_id, forwarded: row.forwarded === 1, forwardedFrom: row.forwarded_from,
    pinnedAt: row.pinned_at, editedAt: row.edited_at, source: row.source,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }
}

/** Oldest first, the order a chat reads in. */
export async function localDiaryMessages(db: LocalDatabase): Promise<LocalDiaryMessage[]> {
  const rows = await db.all<DiaryRow>('SELECT * FROM diary_messages WHERE deleted_at IS NULL ORDER BY sent_at, id')
  const queued = await db.all<{ entity_id: string; status: OutboxStatus }>(
    "SELECT entity_id, status FROM outbox WHERE entity = 'diaryMessage'")
  const delivery = new Map<string, DiaryDelivery>()
  for (const entry of queued) {
    if (entry.status === 'failed' || entry.status === 'conflict') delivery.set(entry.entity_id, 'failed')
    else if (delivery.get(entry.entity_id) !== 'failed') delivery.set(entry.entity_id, 'sending')
  }
  return rows.map((row) => {
    const record = recordFrom(row)
    return { ...record, delivery: delivery.get(row.id) ?? 'sent', searchText: diarySearchText(record) }
  })
}

export async function localDiaryRevision(db: LocalDatabase, id: string): Promise<number | null> {
  const rows = await db.all<{ revision: number }>(
    'SELECT revision FROM diary_messages WHERE id = ? AND deleted_at IS NULL', [id])
  return rows[0]?.revision ?? null
}

export function diaryInputOf(message: DiaryMessageRecord): DiaryMessageInput {
  return {
    sentAt: message.sentAt, text: message.text, entities: message.entities, attachments: message.attachments,
    replyToId: message.replyToId, forwarded: message.forwarded, forwardedFrom: message.forwardedFrom,
    pinnedAt: message.pinnedAt, editedAt: message.editedAt, source: message.source
  }
}
