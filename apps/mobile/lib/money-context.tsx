import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AccountInput, CategoryInput, MoneyResult, MoneySnapshot, TransactionInput } from '@ego/core'
import { moneyClientFor } from './money'
import { isMoneyConfigured, useSettings } from './settings'

interface MoneyContextValue {
  snapshot: MoneySnapshot | null
  loading: boolean
  busy: boolean
  readOnly: boolean
  error: string | null
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
}

const MoneyContext = createContext<MoneyContextValue | null>(null)

export function MoneyProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { settings, loading: settingsLoading } = useSettings()
  const [snapshot, setSnapshot] = useState<MoneySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const client = useMemo(() => moneyClientFor(settings), [settings.cloudflareAccountId, settings.d1DatabaseId, settings.d1ApiToken])

  const apply = useCallback((result: MoneyResult<MoneySnapshot>): boolean => {
    if (result.ok) {
      setSnapshot(result.data)
      setReadOnly(false)
      setError(null)
      return true
    }
    if (result.cachedData) setSnapshot(result.cachedData)
    setReadOnly(Boolean(result.cachedData))
    setError(result.message)
    return false
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (settingsLoading) return
    setLoading(true)
    apply(await client.getSnapshot())
    setLoading(false)
  }, [apply, client, settingsLoading])

  useEffect(() => {
    if (!settingsLoading) void refresh()
  }, [refresh, settingsLoading])

  const run = async (request: Promise<MoneyResult<MoneySnapshot>>): Promise<boolean> => {
    if (readOnly || !isMoneyConfigured(settings)) return false
    setBusy(true)
    const result = apply(await request)
    setBusy(false)
    return result
  }

  const value: MoneyContextValue = {
    snapshot, loading, busy, readOnly, error, refresh,
    createAccount: (input) => run(client.createAccount(input)),
    updateAccount: (id, input) => run(client.updateAccount(id, input)),
    archiveAccount: (id, archived) => run(client.archiveAccount(id, { archived })),
    createCategory: (input) => run(client.createCategory(input)),
    updateCategory: (id, input) => run(client.updateCategory(id, input)),
    archiveCategory: (id, archived) => run(client.archiveCategory(id, { archived })),
    createTransaction: (input) => run(client.createTransaction(input)),
    updateTransaction: (id, input) => run(client.updateTransaction(id, input)),
    deleteTransaction: (id) => run(client.deleteTransaction(id))
  }

  return <MoneyContext.Provider value={value}>{children}</MoneyContext.Provider>
}

export function useMoney(): MoneyContextValue {
  const context = useContext(MoneyContext)
  if (!context) throw new Error('useMoney must be used inside MoneyProvider')
  return context
}
