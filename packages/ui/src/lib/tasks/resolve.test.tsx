// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult, SharedSetting, SharedSettingKey } from '@ego/api-contracts'
import type { ResolveRun } from '@ego/core'
import { ResolveProvider, useResolve, useResolveClock, type ResolveClockValue, type ResolveValue } from './resolve'

interface FakeCard {
  id: string
  boardId: string
  doneAt: string | null
}

const mocks = vi.hoisted(() => ({
  sharedSetting: vi.fn<(key: SharedSettingKey) => Promise<ApiResult<SharedSetting | null>>>(),
  saveSharedSetting: vi.fn<(key: SharedSettingKey, setting: SharedSetting) => Promise<ApiResult<SharedSetting | null>>>(),
  stored: new Map<string, string>(),
  cards: [] as FakeCard[]
}))

vi.mock('../ledger', () => ({
  useLedger: () => ({ enabled: true, api: { sharedSetting: mocks.sharedSetting, saveSharedSetting: mocks.saveSharedSetting } })
}))

vi.mock('./context', () => ({
  useTasks: () => ({ data: { cards: mocks.cards } })
}))

vi.mock('../beep', () => ({ beep: vi.fn() }))

let current: { resolve: ResolveValue; clock: ResolveClockValue } | null = null

function Probe(): null {
  current = { resolve: useResolve(), clock: useResolveClock() }
  return null
}

function probe(): { resolve: ResolveValue; clock: ResolveClockValue } {
  if (!current) throw new Error('Not rendered')
  return current
}

const MINUTE = 60_000

async function pass(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function check(id: string, boardId = 'board'): void {
  mocks.cards.push({ id, boardId, doneAt: new Date().toISOString() })
}

async function mount(): Promise<void> {
  render(<ResolveProvider><Probe /></ResolveProvider>)
  await pass(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
  current = null
  mocks.stored.clear()
  mocks.cards = []
  mocks.sharedSetting.mockReset()
  mocks.sharedSetting.mockResolvedValue({ ok: true, data: null })
  mocks.saveSharedSetting.mockReset()
  mocks.saveSharedSetting.mockImplementation(async (_key, setting) => ({ ok: true, data: setting }))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preferenceGet: vi.fn(async (key: string) => mocks.stored.get(key) ?? null),
      preferenceSet: vi.fn(async (key: string, value: string | null) => {
        if (value === null) mocks.stored.delete(key)
        else mocks.stored.set(key, value)
      }),
      notify: vi.fn()
    }
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Resolve mode', () => {
  it('counts cards checked on the board while the clock runs, leaves the pause out, and shares the run', async () => {
    await mount()
    act(() => probe().resolve.start('board', 'inbox', 10 * 60))

    await pass(MINUTE)
    check('a')
    check('elsewhere', 'other-board')
    await pass(MINUTE)
    expect(probe().clock.cards).toBe(1)
    act(() => probe().resolve.pause())

    await pass(MINUTE)
    check('during-pause')
    await pass(MINUTE)
    act(() => probe().resolve.resume())
    await pass(MINUTE)
    check('b')
    await pass(7 * MINUTE)

    const finished = probe().resolve.active?.finished
    expect(finished).toMatchObject({ boardId: 'board', plannedSeconds: 600, seconds: 600, cards: 2 })
    expect(probe().resolve.runs).toHaveLength(1)
    const saved = mocks.saveSharedSetting.mock.calls.at(-1)
    expect(saved?.[0]).toBe('resolve-runs')
    expect(saved?.[1].value).toEqual([finished])
  })

  it('drops a run stopped in its first seconds and keeps one stopped later with the time it ran', async () => {
    await mount()
    act(() => probe().resolve.start('board', 'inbox', 25 * 60))
    await pass(3_000)
    act(() => probe().resolve.stop())
    expect(probe().resolve.active).toBeNull()
    expect(probe().resolve.runs).toEqual([])

    act(() => probe().resolve.start('board', 'inbox', 25 * 60))
    await pass(MINUTE)
    check('a')
    await pass(MINUTE)
    act(() => probe().resolve.stop())
    expect(probe().resolve.active?.finished).toMatchObject({ seconds: 120, plannedSeconds: 1500, cards: 1 })
  })

  it('merges runs from another device with its own', async () => {
    const theirs: ResolveRun = { id: 'theirs', boardId: 'board', startedAt: '2026-10-09T10:00:00.000Z', plannedSeconds: 600, seconds: 600, cards: 4 }
    const mine: ResolveRun = { id: 'mine', boardId: 'board', startedAt: '2026-10-10T10:00:00.000Z', plannedSeconds: 300, seconds: 300, cards: 3 }
    mocks.stored.set('ego.tasks.resolve.runs', JSON.stringify([mine]))
    mocks.sharedSetting.mockResolvedValue({ ok: true, data: { value: [theirs], updatedAt: '2026-10-09T10:10:00.000Z' } })
    await mount()
    expect(probe().resolve.runs.map((run) => run.id)).toEqual(['mine', 'theirs'])
    expect(mocks.saveSharedSetting.mock.calls.at(-1)?.[1].value).toEqual([mine, theirs])
  })

  it('picks a run back up after a reload', async () => {
    await mount()
    act(() => probe().resolve.start('board', 'inbox', 10 * 60))
    await pass(2 * MINUTE)
    cleanup()

    await mount()
    expect(probe().resolve.active?.plannedSeconds).toBe(600)
    expect(Math.round(probe().clock.remaining)).toBe(480)
  })
})
