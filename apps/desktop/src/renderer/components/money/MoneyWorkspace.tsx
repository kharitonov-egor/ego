import React, { useCallback, useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import type {
  AccountInput, CategoryInput, MoneyResult, MoneySnapshot, TransactionInput
} from '../../../shared/types'
import AccountsView from './AccountsView'
import CategoriesView from './CategoriesView'
import TransactionsView from './TransactionsView'
import OverviewView from './OverviewView'
import { buttonClass, OfflineBanner, panelClass } from './Common'

export type AppView = 'accounts' | 'categories' | 'transactions' | 'overview' | 'settings'

export interface MoneyActions {
  busy: boolean
  readOnly: boolean
  createAccount: (input: AccountInput) => Promise<boolean>
  updateAccount: (id: string, input: AccountInput) => Promise<boolean>
  archiveAccount: (id: string, archived: boolean) => Promise<boolean>
  createCategory: (input: CategoryInput) => Promise<boolean>
  updateCategory: (id: string, input: CategoryInput) => Promise<boolean>
  archiveCategory: (id: string, archived: boolean) => Promise<boolean>
  createTransaction: (input: TransactionInput) => Promise<boolean>
  updateTransaction: (id: string, input: TransactionInput) => Promise<boolean>
  deleteTransaction: (id: string) => Promise<boolean>
}

export default function MoneyWorkspace({ view, onNavigate }: { view: Exclude<AppView, 'settings'>; onNavigate: (view: AppView) => void }): React.ReactElement {
  const [snapshot, setSnapshot] = useState<MoneySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [busy, setBusy] = useState(true)

  const applyResult = useCallback((result: MoneyResult<MoneySnapshot>): boolean => {
    if (result.ok) {
      setSnapshot(result.data)
      setError(null)
      setOffline(false)
      return true
    }
    if (result.cachedData) setSnapshot(result.cachedData)
    setError(result.message)
    setOffline(result.code === 'OFFLINE' || Boolean(result.cachedData))
    return false
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true)
    applyResult(await window.api.moneyGetSnapshot())
    setBusy(false)
  }, [applyResult])

  useEffect(() => { void refresh() }, [refresh])

  const run = async (promise: Promise<MoneyResult<MoneySnapshot>>): Promise<boolean> => {
    if (offline) return false
    setBusy(true)
    const success = applyResult(await promise)
    setBusy(false)
    return success
  }

  const actions: MoneyActions = {
    busy,
    readOnly: offline,
    createAccount: (input) => run(window.api.moneyCreateAccount(input)),
    updateAccount: (id, input) => run(window.api.moneyUpdateAccount(id, input)),
    archiveAccount: (id, archived) => run(window.api.moneyArchiveAccount(id, { archived })),
    createCategory: (input) => run(window.api.moneyCreateCategory(input)),
    updateCategory: (id, input) => run(window.api.moneyUpdateCategory(id, input)),
    archiveCategory: (id, archived) => run(window.api.moneyArchiveCategory(id, { archived })),
    createTransaction: (input) => run(window.api.moneyCreateTransaction(input)),
    updateTransaction: (id, input) => run(window.api.moneyUpdateTransaction(id, input)),
    deleteTransaction: (id) => run(window.api.moneyDeleteTransaction(id))
  }

  if (!snapshot && busy) return <div className="flex h-full items-center justify-center text-sm text-surface-400">Loading money data...</div>
  if (!snapshot) return <div className="flex h-full items-center justify-center p-8">
    <div className={`${panelClass} max-w-md p-8 text-center`}>
      <Settings className="mx-auto text-surface-400" />
      <h1 className="mt-4 text-lg font-semibold">Connect Money Sync</h1>
      <p className="mt-2 text-sm text-surface-400">{error ?? 'Add the Cloudflare account ID, D1 database ID, and API token before creating accounts.'}</p>
      <button className={`${buttonClass} mt-5`} onClick={() => onNavigate('settings')}>Open settings</button>
    </div>
  </div>

  return <div className="flex h-full flex-col overflow-hidden">
    {offline && <OfflineBanner message={error ?? 'Cloudflare is unreachable'} onRetry={() => void refresh()} busy={busy} />}
    {!offline && error && <div className="border-b border-red-500/20 bg-red-500/10 px-6 py-2 text-xs text-red-300">{error}</div>}
    <div className="min-h-0 flex-1">
      {view === 'accounts' && <AccountsView snapshot={snapshot} actions={actions} onAddTransaction={() => onNavigate('transactions')} />}
      {view === 'categories' && <CategoriesView snapshot={snapshot} actions={actions} />}
      {view === 'transactions' && <TransactionsView snapshot={snapshot} actions={actions} />}
      {view === 'overview' && <OverviewView snapshot={snapshot} />}
    </div>
  </div>
}
