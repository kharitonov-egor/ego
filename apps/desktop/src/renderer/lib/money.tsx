import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import {
  budgetBreachMessage, isAccountInput, isBudgetInput, isCategoryInput,
  isPurchaseInput, isTransactionInput,
  type AccountInput, type BudgetBreach, type BudgetInput, type CategoryInput, type MoneySnapshot, type PurchaseInput,
  type TransactionInput
} from '@ego/core'
import { localBudgetBreaches, localRevision, localSnapshot, type RevisionTable } from '@ego/local/repositories/snapshot'
import {
  archiveAccount, archiveCategory, createAccount, createCategory, createPurchase, createTransaction,
  deleteBudget, deletePurchase, deleteTransaction, newId, saveBudget, updateAccount, updateCategory,
  updatePurchase, updateTransaction
} from '@ego/local/sync/commands'
import type { LocalDatabase } from '@ego/local/database/types'
import { useLedger, type LocalWrite } from './ledger'

interface MoneyContextValue {
  snapshot: MoneySnapshot | null
  loading: boolean
  busy: boolean
  readOnly: boolean
  error: string | null
  alert: string | null
  dismissAlert: () => void
  dismissError: () => void
  refresh: () => Promise<void>
  createAccount: (input: AccountInput) => Promise<boolean>
  updateAccount: (id: string, input: AccountInput) => Promise<boolean>
  archiveAccount: (id: string, archived: boolean) => Promise<boolean>
  createCategory: (input: CategoryInput) => Promise<boolean>
  updateCategory: (id: string, input: CategoryInput) => Promise<boolean>
  archiveCategory: (id: string, archived: boolean) => Promise<boolean>
  createTransaction: (input: TransactionInput) => Promise<boolean>
  updateTransaction: (id: string, input: TransactionInput) => Promise<boolean>
  deleteTransaction: (id: string) => Promise<boolean>
  deleteTransactions: (ids: string[]) => Promise<boolean>
  saveBudget: (input: BudgetInput) => Promise<boolean>
  deleteBudget: (month: string) => Promise<boolean>
  createPurchase: (input: PurchaseInput) => Promise<boolean>
  updatePurchase: (id: string, input: PurchaseInput) => Promise<boolean>
  deletePurchase: (id: string) => Promise<boolean>
}

const MoneyContext = createContext<MoneyContextValue | null>(null)

class RejectedWrite extends Error {}

async function revisionOf(db: LocalDatabase, table: RevisionTable, key: string, label: string): Promise<number> {
  const revision = await localRevision(db, table, key)
  if (revision === null) throw new RejectedWrite(`${label} was not found. It may have been deleted on another device.`)
  return revision
}

function transactionProblem(snapshot: MoneySnapshot, input: TransactionInput): string | null {
  const source = snapshot.accounts.find((item) => item.id === input.accountId)
  if (!source) return 'Choose an account'
  if (source.archivedAt) return 'That account is archived'
  if (input.kind === 'transfer') {
    const destination = snapshot.accounts.find((item) => item.id === input.destinationAccountId)
    if (!destination) return 'Choose the account the money goes to'
    if (destination.archivedAt) return 'The destination account is archived'
    return null
  }
  const category = snapshot.categories.find((item) => item.id === input.categoryId)
  if (!category) return 'Choose a category'
  if (category.archivedAt || category.kind !== input.kind) return `Choose an active ${input.kind} category`
  return null
}

function purchaseProblem(snapshot: MoneySnapshot, input: PurchaseInput): string | null {
  const account = snapshot.accounts.find((item) => item.id === input.accountId)
  const category = snapshot.categories.find((item) => item.id === input.categoryId)
  if (!account) return 'Choose an account'
  if (account.archivedAt) return 'That account is archived'
  if (!category || category.archivedAt || category.kind !== 'expense') return 'Choose an active expense category'
  return null
}

function budgetProblem(snapshot: MoneySnapshot, input: BudgetInput): string | null {
  for (const allocation of input.allocations) {
    const category = snapshot.categories.find((item) => item.id === allocation.categoryId)
    if (!category || category.archivedAt || category.kind !== 'expense') {
      return 'A budget only covers active expense categories'
    }
  }
  return null
}

/** The phone only shows the banner. A computer may be looking at another window, so it also gets a notification. */
function notifyBreaches(breaches: BudgetBreach[]): void {
  window.api.notify({
    title: 'Over budget',
    body: breaches.map((breach) => budgetBreachMessage(breach, 'short')).join('\n'),
    route: `/money/budget?month=${breaches[0].month}`
  })
}

/**
 * Every money screen reads this computer's own database and every change goes through the outbox,
 * so nothing here waits on the network. A saved change is on disk before this resolves.
 */
export function MoneyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const ledger = useLedger()
  const { pathname } = useLocation()
  const moneyActive = pathname === '/money' || pathname.startsWith('/money/')
  const [snapshot, setSnapshot] = useState<MoneySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const snapshotRef = useRef<MoneySnapshot | null>(null)
  const generation = useRef(0)
  const { db, ready, version, write, sync } = ledger

  useEffect(() => {
    generation.current += 1
    const started = generation.current
    if (!db || !ready || !moneyActive) {
      snapshotRef.current = null
      setSnapshot(null)
      setLoading(moneyActive && ledger.enabled && !ledger.error)
      return
    }
    if (ledger.reference) {
      const balanceById = new Map(ledger.balances.map((item) => [item.accountId, item.balanceCents]))
      const next: MoneySnapshot = {
        accounts: ledger.reference.accounts.map((account) => ({
          ...account,
          balanceCents: balanceById.get(account.id) ?? account.openingBalanceCents
        })),
        categories: ledger.reference.categories,
        transactions: [],
        purchases: [],
        budgets: [],
        syncedAt: new Date().toISOString()
      }
      snapshotRef.current = next
      setSnapshot(next)
      setLoading(false)
      return
    }
    void localSnapshot(db, new Date().toISOString(), {
      budgets: false,
      purchases: false,
      receiptItems: false,
      transactions: true
    }).then((next) => {
      if (started !== generation.current) return
      snapshotRef.current = next
      setSnapshot(next)
      setLoading(false)
    }).catch((failure: unknown) => {
      if (started !== generation.current) return
      setError(failure instanceof Error ? failure.message : 'This computer could not read its ledger')
      setLoading(false)
    })
  }, [db, ready, version, ledger.enabled, ledger.error, ledger.reference, ledger.balances, moneyActive])

  const run = useCallback(async (
    check: (current: MoneySnapshot) => string | null,
    work: LocalWrite,
    checkBudgets = false
  ): Promise<boolean> => {
    const current = snapshotRef.current
    if (!current) return false
    const problem = check(current)
    if (problem) {
      setError(problem)
      return false
    }
    const before = checkBudgets && db
      ? await localBudgetBreaches(db).catch(() => null)
      : null
    let rejected: string | null = null
    const saved = await write(async (database, now) => {
      try {
        await work(database, now)
      } catch (failure: unknown) {
        if (failure instanceof RejectedWrite) rejected = failure.message
        throw failure
      }
    })
    if (saved && db && before) {
      const after = await localBudgetBreaches(db).catch(() => null)
      if (after) {
        const breaches = after.filter((breach) => !before.some((previous) =>
          previous.month === breach.month && previous.category.categoryId === breach.category.categoryId))
        if (breaches.length > 0) {
          setAlert(breaches.map((breach) => budgetBreachMessage(breach)).join('\n'))
          notifyBreaches(breaches)
        }
      }
    }
    setError(saved ? null : rejected ?? 'This computer could not save that change')
    return saved
  }, [db, write])

  const value = useMemo((): MoneyContextValue => {
    const invalid = (message: string): (() => string) => () => message
    return {
      snapshot,
      loading,
      busy: ledger.writing,
      readOnly: false,
      error,
      alert,
      dismissAlert: () => setAlert(null),
      dismissError: () => setError(null),
      refresh: sync,
      createAccount: (input) => run(isAccountInput(input) ? () => null : invalid('Check the account fields'),
        (database, now) => createAccount(database, input, now, newId()).then(() => undefined)),
      updateAccount: (id, input) => run(isAccountInput(input) ? () => null : invalid('Check the account fields'),
        async (database, now) => {
          await updateAccount(database, id, await revisionOf(database, 'accounts', id, 'That account'), input, now)
        }),
      archiveAccount: (id, archived) => run(() => null, async (database, now) => {
        await archiveAccount(database, id, await revisionOf(database, 'accounts', id, 'That account'), archived, now)
      }),
      createCategory: (input) => run(isCategoryInput(input) ? () => null : invalid('Check the category fields'),
        (database, now) => createCategory(database, input, now, newId()).then(() => undefined)),
      updateCategory: (id, input) => run(isCategoryInput(input) ? () => null : invalid('Check the category fields'),
        async (database, now) => {
          const used = await database.all<{ found: number }>(
            'SELECT 1 AS found FROM transactions WHERE category_id = ? AND kind <> ? AND deleted_at IS NULL LIMIT 1',
            [id, input.kind])
          if (used.length > 0) throw new RejectedWrite('A category that has transactions cannot change type')
          await updateCategory(database, id, await revisionOf(database, 'categories', id, 'That category'), input, now)
        }),
      archiveCategory: (id, archived) => run(() => null, async (database, now) => {
        await archiveCategory(database, id, await revisionOf(database, 'categories', id, 'That category'), archived, now)
      }),
      createTransaction: (input) => run(
        (current) => isTransactionInput(input) ? transactionProblem(current, input) : 'Check the transaction fields',
        (database, now) => createTransaction(database, input, now, newId()).then(() => undefined), true),
      updateTransaction: (id, input) => run(
        (current) => isTransactionInput(input) ? transactionProblem(current, input) : 'Check the transaction fields',
        async (database, now) => {
          await updateTransaction(database, id, await revisionOf(database, 'transactions', id, 'That transaction'), input, now)
        }, true),
      deleteTransaction: (id) => run(() => null, async (database, now) => {
        await deleteTransaction(database, id, await revisionOf(database, 'transactions', id, 'That transaction'), now)
      }, true),
      deleteTransactions: (ids) => run(() => null, (database, now) => database.transaction(async (tx) => {
        for (const id of ids) {
          await deleteTransaction(tx, id, await revisionOf(tx, 'transactions', id, 'A selected transaction'), now)
        }
      }), true),
      saveBudget: (input) => run(
        (current) => isBudgetInput(input) ? budgetProblem(current, input) : 'Check the budget amounts',
        async (database, now) => {
          await saveBudget(database, input, await localRevision(database, 'budgets', input.month), now)
        }, true),
      deleteBudget: (month) => run(() => null, async (database, now) => {
        await deleteBudget(database, month, await revisionOf(database, 'budgets', month, 'That budget'), now)
      }, true),
      createPurchase: (input) => run(
        (current) => isPurchaseInput(input) ? purchaseProblem(current, input) : 'Check the purchase fields',
        (database, now) => createPurchase(database, input, now, newId()).then(() => undefined), true),
      updatePurchase: (id, input) => run(
        (current) => isPurchaseInput(input) ? purchaseProblem(current, input) : 'Check the purchase fields',
        async (database, now) => {
          await updatePurchase(database, id, await revisionOf(database, 'purchases', id, 'That purchase'), input, now)
        }, true),
      deletePurchase: (id) => run(() => null, async (database, now) => {
        await deletePurchase(database, id, await revisionOf(database, 'purchases', id, 'That purchase'), now)
      }, true)
    }
  }, [alert, error, ledger.writing, loading, run, snapshot, sync])

  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>
}

export function useMoney(): MoneyContextValue {
  const context = useContext(MoneyContext)
  if (!context) throw new Error('useMoney must be used inside MoneyProvider')
  return context
}

/**
 * Runs a screen query again after local money data changes. The previous result stays up until
 * the next one lands: clearing it swapped whole screens for a spinner on every period click.
 */
export function useMoneyQuery<T>(query: (db: LocalDatabase) => Promise<T>, deps: React.DependencyList): T | null {
  const { db, ready, version } = useLedger()
  const [result, setResult] = useState<T | null>(null)
  useEffect(() => {
    if (!db || !ready) {
      setResult(null)
      return
    }
    let active = true
    void query(db).then((next) => { if (active) setResult(next) }).catch(() => undefined)
    return () => { active = false }
  }, [db, ready, version, ...deps])
  return result
}
