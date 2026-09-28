import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as SecureStore from 'expo-secure-store'
import type { ListShortcut } from '@ego/core'
import { normalizeApiUrl } from './api-client'

export interface SignedInAccount {
  email: string | null
  deviceId: string
  deviceName: string
}

/**
 * Keys this phone used before the server held them. Nothing reads them any more. They stay
 * until the user removes them, so moving them into Worker secrets never depends on this phone.
 */
export interface RetiredCredentials {
  cloudflareAccountId: string
  d1DatabaseId: string
  d1ApiToken: string
  openRouterApiKey: string
  trelloApiKey: string
  trelloToken: string
}

export interface EgoSettings {
  apiUrl: string
  deviceToken: string
  account: SignedInAccount | null
  trelloBoardId: string
  trelloListId: string
  listShortcuts: ListShortcut[]
  retired: RetiredCredentials | null
}

const BUILD_API_URL = normalizeApiUrl(process.env.EXPO_PUBLIC_EGO_API_URL ?? '')

const EMPTY: EgoSettings = {
  apiUrl: '',
  deviceToken: '',
  account: null,
  trelloBoardId: '',
  trelloListId: '',
  listShortcuts: [],
  retired: null
}

const STORE_KEY = 'ego.settings'

interface SettingsContextValue {
  settings: EgoSettings
  loading: boolean
  update: (patch: Partial<EgoSettings>) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseAccount(value: unknown): SignedInAccount | null {
  if (!isRecord(value) || typeof value.deviceId !== 'string' || typeof value.deviceName !== 'string') return null
  return { email: typeof value.email === 'string' ? value.email : null, deviceId: value.deviceId, deviceName: value.deviceName }
}

function parseShortcuts(value: unknown): ListShortcut[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ListShortcut =>
    isRecord(item) && typeof item.listId === 'string' && typeof item.listName === 'string')
}

function parseRetired(parsed: Record<string, unknown>): RetiredCredentials | null {
  const source = isRecord(parsed.retired) ? parsed.retired : parsed
  const retired: RetiredCredentials = {
    cloudflareAccountId: text(source.cloudflareAccountId),
    d1DatabaseId: text(source.d1DatabaseId),
    d1ApiToken: text(source.d1ApiToken),
    openRouterApiKey: text(source.openRouterApiKey),
    trelloApiKey: text(source.trelloApiKey),
    trelloToken: text(source.trelloToken)
  }
  return Object.values(retired).some(Boolean) ? retired : null
}

/** Reads both this shape and the one that stored every key on the phone. */
export function parseSettings(raw: string | null): EgoSettings {
  if (!raw) return EMPTY
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return EMPTY }
  if (!isRecord(parsed)) return EMPTY
  return {
    apiUrl: text(parsed.apiUrl) || text(parsed.moneyApiUrl),
    deviceToken: text(parsed.deviceToken) || text(parsed.moneyDeviceToken),
    account: parseAccount(parsed.account),
    trelloBoardId: text(parsed.trelloBoardId),
    trelloListId: text(parsed.trelloListId),
    listShortcuts: parseShortcuts(parsed.listShortcuts),
    retired: parseRetired(parsed)
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [settings, setSettings] = useState<EgoSettings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const latest = useRef<EgoSettings>(EMPTY)

  useEffect(() => {
    void (async () => {
      const raw = await SecureStore.getItemAsync(STORE_KEY).catch(() => null)
      latest.current = parseSettings(raw)
      setSettings(latest.current)
      setLoading(false)
    })()
  }, [])

  const update = useCallback(async (patch: Partial<EgoSettings>): Promise<void> => {
    latest.current = { ...latest.current, ...patch }
    setSettings(latest.current)
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(latest.current))
  }, [])

  const value = useMemo(() => ({ settings, loading, update }), [settings, loading, update])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside SettingsProvider')
  return context
}

/** A build can carry the server address, so a fresh install needs only the sign-in button. */
export function apiUrlFor(settings: Pick<EgoSettings, 'apiUrl'>): string {
  return normalizeApiUrl(settings.apiUrl) || BUILD_API_URL
}

export function isSignedIn(settings: EgoSettings): boolean {
  return Boolean(apiUrlFor(settings) && settings.deviceToken.trim())
}

export function isTrelloReady(settings: EgoSettings): boolean {
  return isSignedIn(settings) && Boolean(settings.trelloListId)
}
