// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToday } from './today'

describe('useToday', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 23, 59, 30))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('moves on at each local midnight', () => {
    const { result } = renderHook(() => useToday())
    expect(result.current).toBe('2026-10-02')
    act(() => { vi.advanceTimersByTime(29_000) })
    expect(result.current).toBe('2026-10-02')
    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current).toBe('2026-10-03')
    act(() => { vi.advanceTimersByTime(24 * 60 * 60 * 1000) })
    expect(result.current).toBe('2026-10-04')
  })

  it('catches up when the window comes back after the timer was held up', () => {
    const { result } = renderHook(() => useToday())
    vi.setSystemTime(new Date(2026, 9, 5, 8, 0, 0))
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(result.current).toBe('2026-10-05')
    vi.setSystemTime(new Date(2026, 9, 6, 8, 0, 0))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current).toBe('2026-10-06')
  })
})
