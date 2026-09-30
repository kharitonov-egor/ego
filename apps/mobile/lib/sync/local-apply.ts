import type { SyncOperation } from '@ego/api-contracts'
import type { LocalDatabase } from '../database/types'
import { TABLES, writeRecord, writeTombstone } from '../database/writes'
import {
  accountRecordFrom, budgetIdFor, budgetRecordFrom, categoryRecordFrom, diaryMessageRecordFrom, gymCategoryRecordFrom,
  gymExerciseRecordFrom, gymPlanRecordFrom, gymSetRecordFrom, gymWorkoutRecordFrom, habitEntryRecordFrom,
  habitRecordFrom, moodIdFor, moodRecordFrom, purchaseRecordFrom, purchaseTransactionInput, receiptTransactionIdFor,
  taskBoardRecordFrom, taskCardRecordFrom, taskLabelRecordFrom, taskListRecordFrom, transactionRecordFrom
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

  if (command.entity === 'gymCategory' || command.entity === 'gymExercise' || command.entity === 'gymSet' ||
    command.entity === 'gymPlan') {
    if (command.type === 'delete') {
      await writeTombstone(tx, command.entity, entityId, revision, now)
      return
    }
    const current = await existing(tx, TABLES[command.entity], 'id', entityId)
    const createdAt = current?.created_at ?? now
    const nextRevision = command.type === 'create' ? 1 : revision
    if (command.entity === 'gymCategory') {
      await writeRecord(tx, { entity: 'gymCategory', record: gymCategoryRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    } else if (command.entity === 'gymExercise') {
      await writeRecord(tx, { entity: 'gymExercise', record: gymExerciseRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    } else if (command.entity === 'gymPlan') {
      await writeRecord(tx, { entity: 'gymPlan', record: gymPlanRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    } else {
      await writeRecord(tx, { entity: 'gymSet', record: gymSetRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    }
    return
  }

  if (command.entity === 'gymWorkout') {
    const current = await existing(tx, 'gym_workouts', 'id', entityId)
    await writeRecord(tx, {
      entity: 'gymWorkout',
      record: gymWorkoutRecordFrom(command.payload, current?.created_at ?? now, now, revision)
    })
    return
  }

  if (command.entity === 'habit' || command.entity === 'habitEntry') {
    if (command.type === 'delete') {
      await writeTombstone(tx, command.entity, entityId, revision, now)
      return
    }
    const current = await existing(tx, TABLES[command.entity], 'id', entityId)
    const createdAt = current?.created_at ?? now
    if (command.entity === 'habit') {
      await writeRecord(tx, {
        entity: 'habit',
        record: habitRecordFrom(entityId, command.payload, createdAt, now, command.type === 'create' ? 1 : revision)
      })
    } else {
      await writeRecord(tx, { entity: 'habitEntry', record: habitEntryRecordFrom(entityId, command.payload, createdAt, now, 1) })
    }
    return
  }

  if (command.entity === 'diaryMessage') {
    if (command.type === 'delete') {
      await writeTombstone(tx, 'diaryMessage', entityId, revision, now)
      return
    }
    const current = await existing(tx, 'diary_messages', 'id', entityId)
    await writeRecord(tx, {
      entity: 'diaryMessage',
      record: diaryMessageRecordFrom(entityId, command.payload, current?.created_at ?? now, now,
        command.type === 'create' ? 1 : revision)
    })
    return
  }

  if (command.entity === 'taskBoard' || command.entity === 'taskList' || command.entity === 'taskLabel' ||
    command.entity === 'taskCard') {
    if (command.type === 'delete') {
      await writeTombstone(tx, command.entity, entityId, revision, now)
      return
    }
    const current = await existing(tx, TABLES[command.entity], 'id', entityId)
    const createdAt = current?.created_at ?? now
    const nextRevision = command.type === 'create' ? 1 : revision
    if (command.entity === 'taskBoard') {
      await writeRecord(tx, { entity: 'taskBoard', record: taskBoardRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    } else if (command.entity === 'taskList') {
      await writeRecord(tx, { entity: 'taskList', record: taskListRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    } else if (command.entity === 'taskLabel') {
      await writeRecord(tx, { entity: 'taskLabel', record: taskLabelRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    } else {
      await writeRecord(tx, { entity: 'taskCard', record: taskCardRecordFrom(entityId, command.payload, createdAt, now, nextRevision) })
    }
    return
  }

  if (command.entity === 'mood') {
    if (command.type === 'delete') {
      await writeTombstone(tx, 'mood', entityId, revision, now)
      return
    }
    const rows = await tx.all<Existing & { id: string; deleted_at: string | null }>(
      'SELECT id, created_at, revision, deleted_at FROM mood_entries WHERE date = ?', [entityId])
    const current = rows[0]
    const nextRevision = !current ? 1 : current.deleted_at ? current.revision + 1 : revision
    await writeRecord(tx, {
      entity: 'mood',
      record: moodRecordFrom(current?.id ?? moodIdFor(entityId), command.payload,
        current?.created_at ?? now, now, nextRevision)
    })
    return
  }

  if (command.type === 'delete') {
    await writeTombstone(tx, 'budget', entityId, revision, now)
    return
  }
  const rows = await tx.all<Existing & { id: string; deleted_at: string | null }>(
    'SELECT id, created_at, revision, deleted_at FROM budgets WHERE month = ?', [entityId])
  const current = rows[0]
  const nextRevision = !current ? 1 : current.deleted_at ? current.revision + 1 : revision
  await writeRecord(tx, {
    entity: 'budget',
    record: budgetRecordFrom(current?.id ?? budgetIdFor(entityId), command.payload,
      current?.created_at ?? now, now, nextRevision)
  })
}
