import type {
  AccountRecord, BudgetRecord, CategoryRecord, ChangePayload, FeedTransaction, PurchaseRecord,
  SyncEntity, TransactionRecord
} from '@ego/api-contracts'
import type { LocalDatabase } from './types'

const TABLES: Record<SyncEntity, string> = {
  account: 'accounts',
  category: 'categories',
  transaction: 'transactions',
  purchase: 'purchases',
  budget: 'budgets'
}

async function writeAccount(tx: LocalDatabase, record: AccountRecord): Promise<void> {
  await tx.run(`INSERT INTO accounts (id, name, kind, icon, color, opening_balance_cents, opening_date,
    archived_at, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, icon = excluded.icon,
      color = excluded.color, opening_balance_cents = excluded.opening_balance_cents,
      opening_date = excluded.opening_date, archived_at = excluded.archived_at,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= accounts.revision`,
  [record.id, record.name, record.kind, record.icon, record.color, record.openingBalanceCents,
    record.openingDate, record.archivedAt, record.createdAt, record.updatedAt, record.revision])
}

async function writeCategory(tx: LocalDatabase, record: CategoryRecord): Promise<void> {
  await tx.run(`INSERT INTO categories (id, name, kind, icon, color, archived_at, created_at,
    updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, icon = excluded.icon,
      color = excluded.color, archived_at = excluded.archived_at,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= categories.revision`,
  [record.id, record.name, record.kind, record.icon, record.color, record.archivedAt,
    record.createdAt, record.updatedAt, record.revision])
}

async function writeTransaction(tx: LocalDatabase, record: TransactionRecord): Promise<void> {
  await tx.run(`INSERT INTO transactions (id, kind, account_id, destination_account_id, category_id,
    amount_cents, date, notes, created_at, updated_at, revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, account_id = excluded.account_id,
      destination_account_id = excluded.destination_account_id, category_id = excluded.category_id,
      amount_cents = excluded.amount_cents, date = excluded.date, notes = excluded.notes,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= transactions.revision`,
  [record.id, record.kind, record.accountId, record.destinationAccountId, record.categoryId,
    record.amountCents, record.date, record.notes, record.createdAt, record.updatedAt, record.revision])
}

async function writePurchase(tx: LocalDatabase, record: PurchaseRecord): Promise<void> {
  await tx.run(`INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
    subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at,
    revision, deleted_at, items_loaded)
    VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
    ON CONFLICT(id) DO UPDATE SET transaction_id = excluded.transaction_id, merchant = excluded.merchant,
      purchase_date = excluded.purchase_date, subtotal_cents = excluded.subtotal_cents,
      discount_cents = excluded.discount_cents, tax_cents = excluded.tax_cents,
      fees_cents = excluded.fees_cents, total_cents = excluded.total_cents,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL, items_loaded = 1
    WHERE excluded.revision >= purchases.revision`,
  [record.id, record.transactionId, record.merchant, record.purchaseDate, record.subtotalCents,
    record.discountCents, record.taxCents, record.feesCents, record.totalCents, record.createdAt,
    record.updatedAt, record.revision])
  const stored = await tx.all<{ revision: number }>('SELECT revision FROM purchases WHERE id = ?', [record.id])
  if ((stored[0]?.revision ?? 0) !== record.revision) return
  await tx.run('DELETE FROM receipt_items WHERE purchase_id = ?', [record.id])
  for (const item of record.items) {
    await tx.run(`INSERT INTO receipt_items (id, purchase_id, position, name, quantity,
      unit_price_cents, gross_price_cents, discount_cents, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.purchaseId, item.position, item.name, item.quantity, item.unitPriceCents,
      item.grossPriceCents, item.discountCents, item.lineTotalCents])
  }
}

async function writeBudget(tx: LocalDatabase, record: BudgetRecord): Promise<void> {
  await tx.run(`INSERT INTO budgets (id, month, planned_income_cents, created_at, updated_at,
    revision, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(month) DO UPDATE SET planned_income_cents = excluded.planned_income_cents,
      created_at = excluded.created_at, updated_at = excluded.updated_at,
      revision = excluded.revision, deleted_at = NULL
    WHERE excluded.revision >= budgets.revision`,
  [record.id, record.month, record.plannedIncomeCents, record.createdAt, record.updatedAt, record.revision])
  const stored = await tx.all<{ id: string; revision: number }>(
    'SELECT id, revision FROM budgets WHERE month = ?', [record.month])
  const budget = stored[0]
  if (!budget || budget.revision !== record.revision) return
  await tx.run('DELETE FROM budget_allocations WHERE budget_id = ?', [budget.id])
  for (const allocation of record.allocations) {
    await tx.run(
      'INSERT INTO budget_allocations (id, budget_id, category_id, amount_cents) VALUES (?, ?, ?, ?)',
      [allocation.id, budget.id, allocation.categoryId, allocation.amountCents])
  }
}

/** Applies a record only when it is at least as new as the stored revision. */
export async function writeRecord(tx: LocalDatabase, payload: ChangePayload): Promise<void> {
  if (payload.record === null) return
  switch (payload.entity) {
    case 'account': return writeAccount(tx, payload.record)
    case 'category': return writeCategory(tx, payload.record)
    case 'transaction': return writeTransaction(tx, payload.record)
    case 'purchase': return writePurchase(tx, payload.record)
    case 'budget': return writeBudget(tx, payload.record)
  }
}

/** A tombstone, so a row deleted on another device disappears here too. */
export async function writeTombstone(
  tx: LocalDatabase, entity: SyncEntity, entityId: string, revision: number, deletedAt: string
): Promise<void> {
  const column = entity === 'budget' ? 'month' : 'id'
  await tx.run(
    `UPDATE ${TABLES[entity]} SET deleted_at = ?, revision = ? WHERE ${column} = ? AND revision <= ?`,
    [deletedAt, revision, entityId, revision])
}

/**
 * Feed rows carry merchant metadata but never receipt items, so a bootstrapped purchase is
 * marked as not yet loaded and its items are fetched when the receipt is opened.
 */
export async function writeFeedTransaction(tx: LocalDatabase, row: FeedTransaction): Promise<void> {
  await writeTransaction(tx, row)
  if (row.purchaseId === null || row.merchant === null) return
  await tx.run(`INSERT INTO purchases (id, transaction_id, merchant, purchase_date, currency,
    subtotal_cents, discount_cents, tax_cents, fees_cents, total_cents, created_at, updated_at,
    revision, deleted_at, items_loaded)
    VALUES (?, ?, ?, ?, 'USD', 0, 0, 0, 0, ?, ?, ?, 0, NULL, 0)
    ON CONFLICT(id) DO UPDATE SET merchant = excluded.merchant
    WHERE purchases.items_loaded = 0`,
  [row.purchaseId, row.id, row.merchant, row.date, row.amountCents, row.createdAt, row.updatedAt])
}
