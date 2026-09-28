import type { TransactionKind } from '@ego/core'

export interface TitleSource {
  kind: TransactionKind
  notes: string
  merchant?: string | null
  categoryName: string | null
  accountName: string
  destinationAccountName: string | null
}

export function noteTitle(notes: string): string {
  return notes.trim().split('\n')[0]?.trim() ?? ''
}

/**
 * What the row is called: the receipt's merchant, else the first line of the note (where "Publix"
 * usually lives), else the category or the destination account.
 */
export function transactionTitle(row: TitleSource): string {
  const merchant = row.merchant?.trim()
  if (merchant) return merchant
  const note = noteTitle(row.notes)
  if (note) return note
  if (row.kind === 'transfer') return row.destinationAccountName ?? 'Transfer'
  return row.categoryName ?? 'Archived category'
}

/** The category moves here once the title is taken by a merchant or a note. */
export function transactionDetail(row: TitleSource): string {
  if (row.kind === 'transfer') return row.accountName
  const category = row.categoryName ?? 'Archived category'
  return transactionTitle(row) === category ? row.accountName : `${category} · ${row.accountName}`
}
