// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult, SharedSetting, SharedSettingKey } from '@ego/api-contracts'
import { HotkeysProvider, useHotkeys, type HotkeysValue } from './hotkeys'

const mocks = vi.hoisted(() => ({
  sharedSetting: vi.fn<(key: SharedSettingKey) => Promise<ApiResult<SharedSetting | null>>>(),
  saveSharedSetting: vi.fn<(key: SharedSettingKey, setting: SharedSetting) => Promise<ApiResult<SharedSetting | null>>>(),
  stored: new Map<string, string>()
}))

vi.mock('./ledger', () => ({
  useLedger: () => ({ enabled: true, api: { sharedSetting: mocks.sharedSetting, saveSharedSetting: mocks.saveSharedSetting } })
}))

let current: HotkeysValue | null = null

function Probe(): null {
  current = useHotkeys()
  return null
}

function hotkeys(): HotkeysValue {
  if (!current) throw new Error('Not rendered')
  return current
}

beforeEach(() => {
  current = null
  mocks.stored.clear()
  mocks.sharedSetting.mockReset()
  mocks.saveSharedSetting.mockReset()
  mocks.saveSharedSetting.mockImplementation(async (_key, setting) => ({ ok: true, data: setting }))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preferenceGet: vi.fn(async (key: string) => mocks.stored.get(key) ?? null),
      preferenceSet: vi.fn(async (key: string, value: string | null) => {
        if (value === null) mocks.stored.delete(key)
        else mocks.stored.set(key, value)
      })
    }
  })
})
afterEach(cleanup)

describe('shared keyboard shortcuts', () => {
  it('takes the shortcuts another device saved', async () => {
    mocks.sharedSetting.mockResolvedValue({ ok: true, data: { value: { 'card.archive': 'KeyX' }, updatedAt: '2026-10-10T12:00:00.000Z' } })
    render(<HotkeysProvider><Probe /></HotkeysProvider>)
    await waitFor(() => expect(hotkeys().keys['card.archive']).toBe('KeyX'))
    expect(hotkeys().actionFor({ code: 'KeyX', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe('card.archive')
    expect(mocks.saveSharedSetting).not.toHaveBeenCalled()
  })

  it('moves a shortcut that another action had, and saves the change for every device', async () => {
    mocks.sharedSetting.mockResolvedValue({ ok: true, data: null })
    render(<HotkeysProvider><Probe /></HotkeysProvider>)
    await waitFor(() => expect(mocks.sharedSetting).toHaveBeenCalled())
    let taken: string[] = []
    act(() => { taken = hotkeys().setKey('card.labels', 'KeyC') })
    expect(taken).toEqual(['card.archive'])
    expect(hotkeys().keys['card.labels']).toBe('KeyC')
    expect(hotkeys().keys['card.archive']).toBeNull()
    await waitFor(() => expect(mocks.saveSharedSetting).toHaveBeenCalledTimes(1))
    expect(mocks.saveSharedSetting.mock.calls[0][1].value).toEqual({ 'card.labels': 'KeyC', 'card.archive': null })

    act(() => hotkeys().reset())
    expect(hotkeys().keys['card.archive']).toBe('KeyC')
    expect(hotkeys().keys['card.labels']).toBe('KeyL')
  })

  it('sends a change made offline once the server is reachable, when it is newer', async () => {
    mocks.stored.set('ego.hotkeys', JSON.stringify({ bindings: { 'card.open': 'KeyO' }, updatedAt: '2026-10-10T13:00:00.000Z', pending: true }))
    mocks.sharedSetting.mockResolvedValue({ ok: true, data: { value: {}, updatedAt: '2026-10-10T12:00:00.000Z' } })
    render(<HotkeysProvider><Probe /></HotkeysProvider>)
    await waitFor(() => expect(mocks.saveSharedSetting).toHaveBeenCalledTimes(1))
    expect(mocks.saveSharedSetting.mock.calls[0][1]).toEqual({ value: { 'card.open': 'KeyO' }, updatedAt: '2026-10-10T13:00:00.000Z' })
    expect(hotkeys().keys['card.open']).toBe('KeyO')
  })
})
