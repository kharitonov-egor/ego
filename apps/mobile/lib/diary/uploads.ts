import type { ApiResult, DiaryMediaInfo, MediaScope } from '@ego/api-contracts'
import type { LocalDatabase } from '../database/types'
import type { MediaUploadRun } from '../sync/coordinator'
import { retryDelayMs } from '../sync/outbox'

/**
 * Files wait here until they are in R2. A diary message or a task card with files sits in the
 * outbox as `held` and is released to `pending` once its last file is up, so the server never
 * sees a record pointing at a file it does not have. `messageId` is the card's ID for a task file.
 */

export interface QueuedUpload {
  mediaId: string
  messageId: string
  localUri: string
  contentType: string
  size: number
  /** Leaving it out means a diary file. */
  scope?: MediaScope
}

const HOLDERS = "('diaryMessage', 'taskCard')"

export interface PendingUpload extends QueuedUpload {
  attempts: number
}

/** Sends one file. The phone streams it from disk; tests pass a fake. */
export type UploadTransport = (upload: PendingUpload) => Promise<ApiResult<DiaryMediaInfo>>

interface UploadRow {
  media_id: string
  message_id: string
  local_uri: string
  content_type: string
  size: number
  attempts: number
  scope: MediaScope
}

export async function queueUploads(db: LocalDatabase, uploads: readonly QueuedUpload[], now: string): Promise<void> {
  for (const upload of uploads) {
    await db.run(`INSERT OR IGNORE INTO diary_uploads (media_id, message_id, local_uri, content_type, size, created_at, scope)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [upload.mediaId, upload.messageId, upload.localUri, upload.contentType, upload.size, now, upload.scope ?? 'diary'])
  }
}

/** Every file this phone still has a copy of, by media ID. */
export async function localMediaFiles(db: LocalDatabase, scope: MediaScope = 'diary'): Promise<Map<string, string>> {
  const rows = await db.all<{ media_id: string; local_uri: string }>('SELECT media_id, local_uri FROM diary_uploads WHERE scope = ?', [scope])
  return new Map(rows.map((row) => [row.media_id, row.local_uri]))
}

export async function releaseReadyMessages(db: LocalDatabase): Promise<number> {
  const result = await db.run(`UPDATE outbox SET status = 'pending', next_attempt_at = NULL
    WHERE status = 'held' AND entity IN ${HOLDERS}
      AND NOT EXISTS (SELECT 1 FROM diary_uploads u WHERE u.message_id = outbox.entity_id AND u.uploaded_at IS NULL)`)
  return result.changes
}

/** Puts a message whose files failed back in line, as if it had just been sent. */
export async function retryMessageUploads(db: LocalDatabase, messageId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE diary_uploads SET failed_at = NULL, attempts = 0, next_attempt_at = NULL, last_error = NULL
      WHERE message_id = ? AND uploaded_at IS NULL`, [messageId])
    await tx.run(`UPDATE outbox SET status = 'held', last_error = NULL, next_attempt_at = NULL
      WHERE entity = 'diaryMessage' AND entity_id = ? AND command_type = 'create' AND status = 'failed'`, [messageId])
  })
}

/** Puts a card whose files failed back in line. */
export async function retryCardUploads(db: LocalDatabase, cardId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE diary_uploads SET failed_at = NULL, attempts = 0, next_attempt_at = NULL, last_error = NULL
      WHERE message_id = ? AND uploaded_at IS NULL`, [cardId])
    await tx.run(`UPDATE outbox SET status = 'held', last_error = NULL, next_attempt_at = NULL
      WHERE entity = 'taskCard' AND entity_id = ? AND status = 'failed'`, [cardId])
  })
}

/** Stops waiting on files the card no longer has, like a photo removed before it finished uploading. */
export async function dropUnusedUploads(db: LocalDatabase, cardId: string, keep: readonly string[]): Promise<string[]> {
  const rows = await db.all<{ media_id: string; local_uri: string }>(
    'SELECT media_id, local_uri FROM diary_uploads WHERE message_id = ? AND uploaded_at IS NULL', [cardId])
  const dropped = rows.filter((row) => !keep.includes(row.media_id))
  for (const row of dropped) await db.run('DELETE FROM diary_uploads WHERE media_id = ?', [row.media_id])
  return dropped.map((row) => row.local_uri)
}

const RETRYABLE = new Set(['OFFLINE', 'SERVER_ERROR', 'RATE_LIMITED', 'UPSTREAM_ERROR', 'NOT_CONFIGURED', 'NOT_FOUND'])

/**
 * Sends waiting files one at a time, smallest first within a message so previews land before the
 * video they belong to. Stops at the first network failure and tries again later with backoff.
 */
export async function uploadPendingMedia(
  db: LocalDatabase, transport: UploadTransport, now: () => string, random: () => number = Math.random
): Promise<MediaUploadRun> {
  let released = await releaseReadyMessages(db)
  let uploaded = 0
  for (;;) {
    const rows = await db.all<UploadRow>(`SELECT media_id, message_id, local_uri, content_type, size, attempts, scope
      FROM diary_uploads WHERE uploaded_at IS NULL AND failed_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at, size, media_id LIMIT 1`, [now()])
    const row = rows[0]
    if (!row) return { error: null, paused: false, uploaded, released }
    const result = await transport({
      mediaId: row.media_id, messageId: row.message_id, localUri: row.local_uri,
      contentType: row.content_type, size: row.size, attempts: row.attempts, scope: row.scope
    })
    if (result.ok) {
      await db.run('UPDATE diary_uploads SET uploaded_at = ?, last_error = NULL WHERE media_id = ?', [now(), row.media_id])
      uploaded += 1
      released += await releaseReadyMessages(db)
      continue
    }
    const error = result.error
    if (error.code === 'AUTH_REQUIRED') return { error, paused: true, uploaded, released }
    if (RETRYABLE.has(error.code)) {
      const at = new Date(new Date(now()).getTime() + retryDelayMs(row.attempts, random)).toISOString()
      await db.run('UPDATE diary_uploads SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE media_id = ?',
        [row.attempts + 1, at, error.message, row.media_id])
      return { error, paused: false, uploaded, released }
    }
    await db.transaction(async (tx) => {
      await tx.run('UPDATE diary_uploads SET failed_at = ?, last_error = ? WHERE media_id = ?', [now(), error.message, row.media_id])
      await tx.run(`UPDATE outbox SET status = 'failed', last_error = ?
        WHERE entity IN ${HOLDERS} AND entity_id = ? AND status = 'held'`, [error.message, row.message_id])
    })
  }
}
