import type { SyncCommand, SyncOperation } from '@ego/api-contracts'
import type { LocalDatabase } from '../database/types'
import { writeRecord, writeTombstone } from '../database/writes'
import { applyCommandLocally } from './local-apply'
import { commitLocalWrite, removeOperation, type OutboxEntry } from './outbox'

export interface ConflictReview {
  operationId: string
  entity: OutboxEntry['entity']
  entityId: string
  message: string
  mine: OutboxEntry['command']
  saved: OutboxEntry['serverRecord']
}

export function conflictReviews(entries: OutboxEntry[]): ConflictReview[] {
  return entries
    .filter((entry) => entry.status === 'conflict')
    .map((entry) => ({
      operationId: entry.operationId,
      entity: entry.entity,
      entityId: entry.entityId,
      message: entry.lastError ?? 'This record changed on another device',
      mine: entry.command,
      saved: entry.serverRecord
    }))
}

/** The daily food targets have one fixed ID, so a create that lost to another phone's becomes an edit of it. */
function commandToKeep(entry: OutboxEntry): SyncCommand {
  const { command } = entry
  if (command.entity === 'foodGoal' && command.type === 'create' && entry.serverRecord?.record) {
    return { entity: 'foodGoal', type: 'update', payload: command.payload }
  }
  return command
}

/**
 * Keep mine is a new command against the revision the server reports, not a retry of the
 * operation that already lost the race.
 */
export async function keepMine(
  db: LocalDatabase, entry: OutboxEntry, operationId: string, now: string
): Promise<SyncOperation> {
  const saved = entry.serverRecord
  const command = commandToKeep(entry)
  const creates = command.type === 'create'
  const operation: SyncOperation = {
    operationId,
    entityId: entry.entityId,
    expectedRevision: creates ? null : saved?.revision ?? entry.expectedRevision,
    createdAt: now,
    command
  }
  await db.transaction(async (tx) => {
    await removeOperation(tx, entry.operationId)
    await commitLocalWrite(tx, operation, (inner) => applyCommandLocally(inner, operation, now))
  })
  return operation
}

/** Use saved version drops the local command and takes the server's record. */
export async function useSavedVersion(db: LocalDatabase, entry: OutboxEntry, now: string): Promise<void> {
  await db.transaction(async (tx) => {
    const saved = entry.serverRecord
    if (saved) {
      if (saved.action === 'delete' || saved.record === null) {
        await writeTombstone(tx, saved.entity, saved.entityId, saved.revision, now)
      } else {
        await writeRecord(tx, saved)
      }
    }
    await removeOperation(tx, entry.operationId)
  })
}
