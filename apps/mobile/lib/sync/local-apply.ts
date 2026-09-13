import type { SyncOperation } from '@ego/api-contracts'
import type { LocalDatabase } from '../database/types'
import { writeRecord, writeTombstone } from '../database/writes'
import {
  accountRecordFrom, budgetIdFor, budgetRecordFrom, categoryRecordFrom, purchaseRecordFrom,
  purchaseTransactionInput, receiptTransactionIdFor, transactionRecordFrom
} from './records'

interface Existing {
  created_at: string
  revision: number
}

async function existing(tx: LocalDatabase, table: string, column: string, key: string): Promise<Existing | null> {
  const rows = await tx.all<Existing>(
    `SELECT created_at, revision FROM ${table} WHERE ${column} = ?`, [key])
  return rows[0] ?? null
}

/**
 * Applies the command to the phone's own tables with the revision the server is expected to
 * assign. The row reads as saved straight away and the outbox carries the same command.
 */
export async function applyCommandLocally(
  tx: LocalDatabase, operation: SyncOperation, now: string
): Promise<void> {
  const { command, entityId } = operation
  const revision = (operation.expectedRevision ?? 0) + 1

  if (command.entity === 'account') {
    const current = await existing(tx, 'accounts', 'id', entityId)
    if (command.type === 'archive') {
      await tx.run('UPDATE accounts SET archived_at = ?, updated_at = ?, revision = ? WHERE id = ?',
        [command.payload.archived ? now : null, now, revision, entityId])
      return
    }
    await writeRecord(tx, {
      entity: 'account',
      record: accountRecordFrom(entityId, command.payload, null, current?.created_at ?? now, now,
        command.type === 'create' ? 1 : revision)
    })
    return
  }

  if (command.entity === 'category') {
    const current = await existing(tx, 'categories', 'id', entityId)
    if (command.type === 'archive') {
      await tx.run('UPDATE categories SET archived_at = ?, updated_at = ?, revision = ? WHERE id = ?',
        [command.payload.archived ? now : null, now, revision, entityId])
      return
    }
    await writeRecord(tx, {
      entity: 'category',
      record: categoryRecordFrom(entityId, command.payload, null, current?.created_at ?? now, now,
        command.type === 'create' ? 1 : revision)
    })
    return
  }

  if (command.entity === 'transaction') {
    if (command.type === 'delete') {
      await writeTombstone(tx, 'transaction', entityId, revision, now)
      const receipts = await tx.all<{ id: string; revision: number }>(
        'SELECT id, revision FROM purchases WHERE transaction_id = ? AND deleted_at IS NULL', [entityId])
      for (const receipt of receipts) {
        await writeTombstone(tx, 'purchase', receipt.id, receipt.revision + 1, now)
      }
      return
    }
    const current = await existing(tx, 'transactions', 'id', entityId)
    await writeRecord(tx, {
      entity: 'transaction',
      record: transactionRecordFrom(entityId, command.payload, current?.created_at ?? now, now,
        command.type === 'create' ? 1 : revision)
    })
    return
  }

  if (command.entity === 'purchase') {
    const current = await tx.all<{ transaction_id: string; created_at: string; revision: number }>(
      'SELECT transaction_id, created_at, revision FROM purchases WHERE id = ?', [entityId])
    const row = current[0]
    if (command.type === 'delete') {
      await writeTombstone(tx, 'purchase', entityId, revision, now)
      if (row) {
        const transaction = await existing(tx, 'transactions', 'id', row.transaction_id)
        if (transaction) await writeTombstone(tx, 'transaction', row.transaction_id, transaction.revision + 1, now)
      }
      return
    }
    const transactionId = row?.transaction_id ?? receiptTransactionIdFor(entityId)
    const transaction = await existing(tx, 'transactions', 'id', transactionId)
    await writeRecord(tx, {
      entity: 'transaction',
      record: transactionRecordFrom(transactionId, purchaseTransactionInput(command.payload),
        transaction?.created_at ?? now, now, (transaction?.revision ?? 0) + 1)
    })
    await writeRecord(tx, {
      entity: 'purchase',
      record: purchaseRecordFrom(entityId, transactionId, command.payload, row?.created_at ?? now, now,
        command.type === 'create' ? 1 : revision)
    })
    return
  }

  if (command.type === 'delete') {
    await writeTombstone(tx, 'budget', entityId, revision, now)
    return
  }
  const current = await existing(tx, 'budgets', 'month', entityId)
  const rows = await tx.all<{ id: string }>('SELECT id FROM budgets WHERE month = ?', [entityId])
  await writeRecord(tx, {
    entity: 'budget',
    record: budgetRecordFrom(rows[0]?.id ?? budgetIdFor(entityId), command.payload,
      current?.created_at ?? now, now, current ? revision : 1)
  })
}
