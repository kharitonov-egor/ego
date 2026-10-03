// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { MemoryRouter } from 'react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RestTimerProvider, useRestClock, useRestTimer } from './rest-timer'

const notify = vi.fn()
const preferenceSet = vi.fn(async () => undefined)

function Probe(): React.ReactElement {
  const timer = useRestTimer()
  const clock = useRestClock()
  return <div>
    <button type="button" onClick={() => timer.start()}>Start</button>
    <button type="button" onClick={() => timer.setSeconds(60)}>One minute</button>
    <span data-testid="remaining">{clock.remaining}</span>
    <span data-testid="state">{clock.finished ? 'finished' : timer.running ? 'running' : 'idle'}</span>
  </div>
}

function renderTimer(): void {
  render(<MemoryRouter initialEntries={['/gym/track?exerciseId=bench']}>
    <RestTimerProvider><Probe /></RestTimerProvider>
  </MemoryRouter>)
}

describe('RestTimerProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    notify.mockClear()
    preferenceSet.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        preferenceGet: vi.fn(async () => JSON.stringify({ seconds: 30, autoStart: true })),
        preferenceSet,
        notify
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('counts down the stored length and sends the exercise route when the window is in the background', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    renderTimer()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(screen.getByTestId('remaining')).toHaveTextContent('20')
    expect(screen.getByTestId('state')).toHaveTextContent('running')
    await act(async () => { await vi.advanceTimersByTimeAsync(20_500) })
    expect(screen.getByTestId('state')).toHaveTextContent('finished')
    expect(notify).toHaveBeenCalledWith({
      title: 'Rest is over', body: 'Time for the next set.', route: '/gym/track?exerciseId=bench', silent: true
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    expect(screen.getByTestId('state')).toHaveTextContent('idle')
  })

  it('stays quiet in the notification area while the window has the focus', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    renderTimer()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(screen.getByTestId('state')).toHaveTextContent('finished')
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps the length under the phone preference key', async () => {
    renderTimer()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'One minute' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(preferenceSet).toHaveBeenLastCalledWith('ego.gym.rest', JSON.stringify({ seconds: 60, autoStart: true }))
  })
})
