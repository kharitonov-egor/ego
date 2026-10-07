// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAVE_DELAY_MS, SaveCountdown } from './countdown'

describe('SaveCountdown', () => {
  beforeEach(() => { vi.useFakeTimers() })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('runs the full delay from when it appears', () => {
    const elapsed = vi.fn()
    render(<SaveCountdown runKey="a" paused={false} label="Saves" onElapsed={elapsed} onUndo={() => undefined} />)
    act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS - 1) })
    expect(elapsed).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(elapsed).toHaveBeenCalledTimes(1)
  })

  it('picks up a run already under way', () => {
    const elapsed = vi.fn()
    render(<SaveCountdown runKey="a" paused={false} startedAt={Date.now() - 1000} label="Saves" onElapsed={elapsed} onUndo={() => undefined} />)
    act(() => { vi.advanceTimersByTime(SAVE_DELAY_MS - 1001) })
    expect(elapsed).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(elapsed).toHaveBeenCalledTimes(1)
  })
})
