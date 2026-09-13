import type { ChangeRecord, SyncCommand, SyncEntity, SyncOperation } from '@ego/api-contracts'
import type { LocalDatabase, SqlParam } from '../database/types'

export type OutboxStatus = 'pending' | 'failed' | 'conflict'

export interface OutboxEntry {
  operationId: string
  entity: SyncEntity
  entityId: string
  commandType: string
  expectedRevision: number | null
  command: SyncCommand
  createdAt: string
  attempts: number
  nextAttemptAt: string | null
  status: OutboxStatus
  lastError: string | null
  serverRecord: ChangeRecord | null
}

interface OutboxRow {
  operation_id: string
  entity: SyncEntity
  entity_id: string
  command_type: string
  expected_revision: number | null
  payload: string
  created_at: string
  attempts: number
  next_attempt_at: string | null
  status: OutboxStatus
  last_error: string | null
  server_record: string | null
}

function parse<T>(raw: string | null): T | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    operationId: row.operation_id,
    entity: row.entity,
    entityId: row.entity_id,
    commandType: row.command_type,
    expectedRevision: row.expected_revision,
    command: parse<SyncCommand>(row.payload) as SyncCommand,
    createdAt: row.created_at,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    status: row.status,
    lastError: row.last_error,
    serverRecord: parse<ChangeRecord>(row.server_record)
  }
}

export function toOperation(entry: OutboxEntry): SyncOperation {
  return {
    operationId: entry.operationId,
    entityId: entry.entityId,
    expectedRevision: entry.expectedRevision,
    createdAt: entry.createdAt,
    command: entry.command
  }
}

/**
 * The record and its operation reach disk together. A transaction the editor reported as saved
 * is therefore always a transaction the outbox will deliver.
 */
export async function commitLocalWrite(
  db: LocalDatabase,
  operation: SyncOperation,
  applyLocally: (tx: LocalDatabase) => Promise<void>
): Promise<void> {
  await db.transaction(async (tx) => {
    await applyLocally(tx)
    await tx.run(
      `INSERT INTO outbox (operation_id, entity, entity_id, command_type, expected_revision,
        payload, created_at, attempts, next_attempt_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 'pending')`,
      [operation.operationId, operation.command.entity, operation.entityId, operation.command.type,
        operation.expectedRevision, JSON.stringify(operation.command), operation.createdAt])
  })
}

export async function readyOperations(db: LocalDatabase, now: string, limit: number): Promise<OutboxEntry[]> {
  const rows = await db.all<OutboxRow>(
    `SELECT * FROM outbox WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at, rowid LIMIT ?`, [now, limit])
  return rows.map(toEntry)
}

export async function allOperations(db: LocalDatabase): Promise<OutboxEntry[]> {
  const rows = await db.all<OutboxRow>('SELECT * FROM outbox ORDER BY created_at, rowid')
  return rows.map(toEntry)
}

export async function outboxEntry(db: LocalDatabase, operationId: string): Promise<OutboxEntry | null> {
  const rows = await db.all<OutboxRow>('SELECT * FROM outbox WHERE operation_id = ?', [operationId])
  return rows[0] ? toEntry(rows[0]) : null
}

export async function pendingCounts(db: LocalDatabase): Promise<{ pending: number; failed: number; conflicts: number }> {
  const rows = await db.all<{ status: OutboxStatus; total: number }>(
    'SELECT status, COUNT(*) AS total FROM outbox GROUP BY status')
  const of = (status: OutboxStatus): number => rows.find((row) => row.status === status)?.total ?? 0
  return { pending: of('pending'), failed: of('failed'), conflicts: of('conflict') }
}

export async function hasPendingFor(db: LocalDatabase, entity: SyncEntity, entityId: string): Promise<boolean> {
  const rows = await db.all<{ total: number }>(
    "SELECT COUNT(*) AS total FROM outbox WHERE entity = ? AND entity_id = ? AND status = 'pending'",
    [entity, entityId])
  return (rows[0]?.total ?? 0) > 0
}

export async function removeOperation(db: LocalDatabase, operationId: string): Promise<void> {
  await db.run('DELETE FROM outbox WHERE operation_id = ?', [operationId])
}

export async function markConflict(
  db: LocalDatabase, operationId: string, message: string, current: ChangeRecord | null
): Promise<void> {
  await db.run(
    "UPDATE outbox SET status = 'conflict', last_error = ?, server_record = ? WHERE operation_id = ?",
    [message, current ? JSON.stringify(current) : null, operationId])
}

export async function markFailed(db: LocalDatabase, operationId: string, message: string): Promise<void> {
  await db.run("UPDATE outbox SET status = 'failed', last_error = ? WHERE operation_id = ?",
    [message, operationId])
}

const MAXIMUM_RETRY_DELAY_MS = 60000

export function retryDelayMs(attempts: number, random: () => number): number {
  const capped = Math.min(2 ** attempts * 1000, MAXIMUM_RETRY_DELAY_MS)
  return Math.round(capped / 2 + capped * random() / 2)
}

/** A transient failure keeps the operation and its ID, so the retry is the same operation. */
export async function scheduleRetry(
  db: LocalDatabase, operationId: string, attempts: number, now: string, message: string, random: () => number
): Promise<void> {
  const at = new Date(new Date(now).getTime() + retryDelayMs(attempts, random)).toISOString()
  await db.run(
    'UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE operation_id = ?',
    [attempts + 1, at, message, operationId] as SqlParam[])
}

export async function resetForRetry(db: LocalDatabase, operationId: string): Promise<void> {
  await db.run(
    "UPDATE outbox SET status = 'pending', next_attempt_at = NULL, last_error = NULL, server_record = NULL WHERE operation_id = ?",
    [operationId])
}
