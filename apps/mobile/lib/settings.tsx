import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import type { ListShortcut } from '@ego/core'

export interface EgoSettings {
  trelloApiKey: string
  trelloToken: string
  trelloBoardId: string
  trelloListId: string
  listShortcuts: ListShortcut[]
  cloudflareAccountId: string
  d1DatabaseId: string
  d1ApiToken: string
  openRouterApiKey: string
  receiptModel: string
}

const EMPTY: EgoSettings = {
  trelloApiKey: '',
  trelloToken: '',
  trelloBoardId: '',
  trelloListId: '',
  listShortcuts: [],
  cloudflareAccountId: '',
  d1DatabaseId: '',
  d1ApiToken: '',
  openRouterApiKey: '',
  receiptModel: 'openai/gpt-5.6-terra'
}

const STORE_KEY = 'ego.settings'

interface SettingsContextValue {
  settings: EgoSettings
  loading: boolean
  update: (patch: Partial<EgoSettings>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function parse(raw: string | null): EgoSettings {
  if (!raw) return EMPTY
  try {
    const parsed = JSON.parse(raw) as Partial<EgoSettings>
    return {
      trelloApiKey: parsed.trelloApiKey ?? '',
      trelloToken: parsed.trelloToken ?? '',
      trelloBoardId: parsed.trelloBoardId ?? '',
      trelloListId: parsed.trelloListId ?? '',
      listShortcuts: Array.isArray(parsed.listShortcuts) ? parsed.listShortcuts : [],
      cloudflareAccountId: parsed.cloudflareAccountId ?? '',
      d1DatabaseId: parsed.d1DatabaseId ?? '',
      d1ApiToken: parsed.d1ApiToken ?? '',
      openRouterApiKey: parsed.openRouterApiKey ?? '',
      receiptModel: parsed.receiptModel ?? 'openai/gpt-5.6-terra'
    }
  } catch {
    return EMPTY
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [settings, setSettings] = useState<EgoSettings>(EMPTY)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const raw = await SecureStore.getItemAsync(STORE_KEY)
      setSettings(parse(raw))
      setLoading(false)
    })()
  }, [])

  const update = useCallback(async (patch: Partial<EgoSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      void SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const value = useMemo(() => ({ settings, loading, update }), [settings, loading, update])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside SettingsProvider')
  return context
}

export function isConfigured(settings: EgoSettings): boolean {
  return Boolean(settings.trelloApiKey && settings.trelloToken && settings.trelloListId)
}

export function isMoneyConfigured(settings: EgoSettings): boolean {
  return Boolean(settings.cloudflareAccountId && settings.d1DatabaseId && settings.d1ApiToken)
}
