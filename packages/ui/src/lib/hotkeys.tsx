import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { SharedSetting } from '@ego/api-contracts'
import {
  HOTKEY_ACTIONS, hotkeyOf, isHotkeyBindings, resolvedHotkeys,
  type HotkeyActionId, type HotkeyBindings, type KeyPress, type ResolvedHotkeys
} from '@ego/core'
import { useLedger } from './ledger'
import { SecureStore } from './preferences'

const STORE_KEY = 'ego.hotkeys'
/** How often a window coming back to the front asks for shortcuts changed on another device. */
const REFRESH_MS = 60_000

/** This device's copy. `pending` holds a change the server has not confirmed yet. */
interface Saved {
  bindings: HotkeyBindings
  updatedAt: string | null
  pending: boolean
}

const EMPTY: Saved = { bindings: {}, updatedAt: null, pending: false }

function parseSaved(raw: string | null): Saved {
  if (!raw) return EMPTY
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || !('bindings' in value) || !isHotkeyBindings(value.bindings)) return EMPTY
    const updatedAt = 'updatedAt' in value && typeof value.updatedAt === 'string' ? value.updatedAt : null
    return { bindings: value.bindings, updatedAt, pending: 'pending' in value && value.pending === true }
  } catch {
    return EMPTY
  }
}

function fromServer(setting: SharedSetting | null): Saved | null {
  return setting && isHotkeyBindings(setting.value) ? { bindings: setting.value, updatedAt: setting.updatedAt, pending: false } : null
}

export interface HotkeysValue {
  keys: ResolvedHotkeys
  /** The action a key press stands for. */
  actionFor: (press: KeyPress) => HotkeyActionId | null
  /** Gives an action a shortcut, or takes it away with null. Returns the actions that lost it. */
  setKey: (id: HotkeyActionId, combo: string | null) => HotkeyActionId[]
  /** Puts one action back to its default, or every action without an id. */
  reset: (id?: HotkeyActionId) => void
}

const HotkeysContext = createContext<HotkeysValue | null>(null)

/** Shortcuts every computer and browser shares through the Worker, kept here too for offline use. */
export function HotkeysProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const { api, enabled } = useLedger()
  const [saved, setSaved] = useState<Saved>(EMPTY)
  const savedRef = useRef(saved)
  const loaded = useRef(false)
  const fetchedAt = useRef(0)

  const keep = useCallback((next: Saved): void => {
    savedRef.current = next
    setSaved(next)
    void SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next)).catch(() => undefined)
  }, [])

  const push = useCallback(async (local: Saved): Promise<void> => {
    if (!local.updatedAt) return
    const result = await api.saveSharedSetting('hotkeys', { value: local.bindings, updatedAt: local.updatedAt }).catch(() => null)
    if (!result?.ok || savedRef.current !== local) return
    keep(fromServer(result.data) ?? { ...local, pending: false })
  }, [api, keep])

  const refresh = useCallback(async (): Promise<void> => {
    fetchedAt.current = Date.now()
    const result = await api.sharedSetting('hotkeys').catch(() => null)
    if (!result?.ok) return
    const local = savedRef.current
    const remote = fromServer(result.data)
    const localNewer = local.updatedAt !== null && (remote?.updatedAt == null || local.updatedAt > remote.updatedAt)
    if (localNewer && local.pending) await push(local)
    else if (remote && !localNewer) keep(remote)
  }, [api, keep, push])

  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(STORE_KEY).catch(() => null).then((raw) => {
      if (!active) return
      loaded.current = true
      const local = parseSaved(raw)
      savedRef.current = local
      setSaved(local)
      if (enabled) void refresh()
    })
    return () => { active = false }
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return
    const onFocus = (): void => { if (loaded.current && Date.now() - fetchedAt.current > REFRESH_MS) void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, refresh])

  const change = useCallback((bindings: HotkeyBindings): void => {
    const next: Saved = { bindings, updatedAt: new Date().toISOString(), pending: true }
    keep(next)
    if (enabled) void push(next)
  }, [enabled, keep, push])

  const keys = useMemo(() => resolvedHotkeys(saved.bindings), [saved.bindings])

  const value = useMemo((): HotkeysValue => {
    const withKey = (bindings: HotkeyBindings, id: HotkeyActionId, combo: string | null): HotkeyBindings => {
      const next = { ...bindings }
      const fallback = HOTKEY_ACTIONS.find((action) => action.id === id)?.key ?? null
      if (combo === fallback) delete next[id]
      else next[id] = combo
      return next
    }
    return {
      keys,
      actionFor: (press) => {
        const combo = hotkeyOf(press)
        if (!combo) return null
        return HOTKEY_ACTIONS.find((action) => keys[action.id] === combo)?.id ?? null
      },
      setKey: (id, combo) => {
        const taken = combo === null ? [] : HOTKEY_ACTIONS.filter((action) => action.id !== id && keys[action.id] === combo).map((action) => action.id)
        let bindings = withKey(savedRef.current.bindings, id, combo)
        for (const other of taken) bindings = withKey(bindings, other, null)
        change(bindings)
        return taken
      },
      reset: (id) => {
        if (id === undefined) {
          change({})
          return
        }
        const next = { ...savedRef.current.bindings }
        delete next[id]
        change(next)
      }
    }
  }, [change, keys])

  return <HotkeysContext.Provider value={value}>{children}</HotkeysContext.Provider>
}

export function useHotkeys(): HotkeysValue {
  const value = useContext(HotkeysContext)
  if (!value) throw new Error('useHotkeys needs a HotkeysProvider')
  return value
}
