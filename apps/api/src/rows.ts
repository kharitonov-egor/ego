import type {
  AccountKind, CategoryKind, MoneyPurchase, ReceiptItem, TransactionKind
} from '@ego/core'
import type {
  AccountRecord, BudgetRecord, CategoryRecord, FeedTransaction, PurchaseRecord, TransactionRecord
} from '@ego/api-contracts'

export interface AccountRow {
  id: string
  name: string
  kind: AccountKind
  icon: string
  color: string
  opening_balance_cents: number
  opening_date: string
  archived_at: string | null
  created_at: string
  updated_at: string
  revision: number
}

export interface CategoryRow {
  id: string
  name: string
  kind: CategoryKind
  icon: string
  color: string
  archived_at: string | null
  created_at: string
  updated_at: string
  revision: number
}

export interface TransactionRow {
  id: string
  kind: TransactionKind
  account_id: string
  destination_account_id: string | null
  category_id: string | null
  amount_cents: number
  date: string
  notes: string
  created_at: string
  updated_at: string
  revision: number
}

export interface FeedRow extends TransactionRow {
  account_name: string
  destination_account_name: string | null
  category_name: string | null
  category_icon: string | null
  category_color: string | null
  merchant: string | null
  purchase_id: string | null
}

export interface PurchaseRow {
  id: string
  transaction_id: string
  merchant: string
  purchase_date: string
  currency: 'USD'
  subtotal_cents: number
  discount_cents: number
  tax_cents: number
  fees_cents: number
  total_cents: number
  created_at: string
  updated_at: string
  revision: number
}

export interface ReceiptItemRow {
  id: string
  purchase_id: string
  position: number
  name: string
  quantity: number
  unit_price_cents: number | null
  gross_price_cents: number
  discount_cents: number
  line_total_cents: number
}

export interface BudgetRow {
  id: string
  month: string
  planned_income_cents: number
  created_at: string
  updated_at: string
  revision: number
}

export interface BudgetAllocationRow {
  id: string
  budget_id: string
  category_id: string
  amount_cents: number
}

export function toAccountRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
    openingBalanceCents: row.opening_balance_cents, openingDate: row.opening_date,
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
    revision: row.revision
  }
}

export function toCategoryRecord(row: CategoryRow): CategoryRecord {
  return {
    id: row.id, name: row.name, kind: row.kind, icon: row.icon, color: row.color,
    archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at,
    revision: row.revision
  }
}

export function toTransactionRecord(row: TransactionRow): TransactionRecord {
  return {
    id: row.id, kind: row.kind, accountId: row.account_id,
    destinationAccountId: row.destination_account_id, categoryId: row.category_id,
    amountCents: row.amount_cents, date: row.date, notes: row.notes,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision
  }
}

export function toFeedTransaction(row: FeedRow): FeedTransaction {
  return {
    ...toTransactionRecord(row),
    accountName: row.account_name,
    destinationAccountName: row.destination_account_name,
    categoryName: row.category_name,
    categoryIcon: row.category_icon,
    categoryColor: row.category_color,
    merchant: row.merchant,
    purchaseId: row.purchase_id,
    hasReceipt: row.purchase_id !== null
  }
}

export function toReceiptItem(row: ReceiptItemRow): ReceiptItem {
  return {
    id: row.id, purchaseId: row.purchase_id, position: row.position, name: row.name,
    quantity: row.quantity, unitPriceCents: row.unit_price_cents,
    grossPriceCents: row.gross_price_cents, discountCents: row.discount_cents,
    lineTotalCents: row.line_total_cents
  }
}

export function toPurchaseRecord(row: PurchaseRow, items: ReceiptItem[]): PurchaseRecord {
  const purchase: MoneyPurchase = {
    id: row.id, transactionId: row.transaction_id, merchant: row.merchant,
    purchaseDate: row.purchase_date, currency: row.currency,
    subtotalCents: row.subtotal_cents, discountCents: row.discount_cents,
    taxCents: row.tax_cents, feesCents: row.fees_cents, totalCents: row.total_cents,
    createdAt: row.created_at, updatedAt: row.updated_at,
    items: items.filter((item) => item.purchaseId === row.id).sort((left, right) => left.position - right.position)
  }
  return { ...purchase, revision: row.revision }
}

export function toBudgetRecord(row: BudgetRow, allocations: BudgetAllocationRow[]): BudgetRecord {
  return {
    id: row.id, month: row.month, plannedIncomeCents: row.planned_income_cents,
    createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
    allocations: allocations
      .filter((allocation) => allocation.budget_id === row.id)
      .map((allocation) => ({
        id: allocation.id, budgetId: allocation.budget_id,
        categoryId: allocation.category_id, amountCents: allocation.amount_cents
      }))
  }
}
