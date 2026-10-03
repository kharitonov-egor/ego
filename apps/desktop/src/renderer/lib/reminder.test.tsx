// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReminderProvider } from './reminder'

const mocks = vi.hoisted(() => ({ db: {}, recorded: { value: false } }))

vi.mock('./ledger', () => ({ useLedger: () => ({ db: mocks.db, ready: true, version: 0 }) }))
vi.mock('@ego/local/repositories/transactions', () => ({ hasTransactionOnDate: async () => mocks.recorded.value }))

const notify = vi.fn()

async function settle(ms = 0): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

describe('ReminderProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 9, 2, 20, 50) })
    notify.mockClear()
    mocks.recorded.value = false
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preferenceGet: async () => JSON.stringify({ enabled: true, hour: 21 }),
        preferenceSet: async () => undefined,
        notify
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('rings once at the chosen hour on a day with nothing logged', async () => {
    render(<ReminderProvider><div /></ReminderProvider>)
    await settle()
    expect(notify).not.toHaveBeenCalled()
    await settle(11 * 60 * 1000)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nothing logged today', route: '/money/transactions?new=true' }))
    await settle(60 * 60 * 1000)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('stays quiet once something is logged that day', async () => {
    mocks.recorded.value = true
    render(<ReminderProvider><div /></ReminderProvider>)
    await settle()
    await settle(2 * 60 * 60 * 1000)
    expect(notify).not.toHaveBeenCalled()
  })
})
