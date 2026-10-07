// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TalkToAIView from './TalkToAIView'

const controllerMocks = vi.hoisted(() => ({
  end: vi.fn(),
  dispose: vi.fn()
}))

vi.mock('../live/LiveSessionController', () => ({
  LiveSessionController: class {
    private readonly options: { onStatus: (status: string, message?: string) => void; onTranscript: (messages: unknown[]) => void }
    constructor(options: { onStatus: (status: string, message?: string) => void; onTranscript: (messages: unknown[]) => void }) {
      this.options = options
    }
    async start(): Promise<void> {
      this.options.onTranscript([])
      this.options.onStatus('error', 'The server is busy.')
    }
    toggleMute(): void {}
    end(): void {
      controllerMocks.end()
      this.options.onStatus('ended')
    }
    dispose(): void { controllerMocks.dispose() }
  }
}))

function api(configured: boolean): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      moneyGetLedgerConfig: vi.fn(async () => ({
        url: configured ? 'https://ego.example' : '', hasToken: configured
      })),
      onLiveSessionStopRequested: vi.fn(() => () => undefined)
    }
  })
}

describe('TalkToAIView', () => {
  afterEach(cleanup)

  beforeEach(() => {
    controllerMocks.end.mockClear()
    controllerMocks.dispose.mockClear()
    api(true)
  })

  it('shows accessible call controls and retries after an error', async () => {
    render(<TalkToAIView onOpenSettings={vi.fn()} />)
    const start = await screen.findByRole('button', { name: 'Start voice call' })
    expect(start).toBeEnabled()
    expect(screen.getByLabelText('Live transcript')).toBeInTheDocument()
    fireEvent.click(start)
    expect(await screen.findByText('The server is busy.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try voice call again' })).toBeInTheDocument()
  })

  it('directs an unconfigured desktop to Settings', async () => {
    api(false)
    const openSettings = vi.fn()
    render(<TalkToAIView onOpenSettings={openSettings} />)
    expect(await screen.findByText('Connect the Ego service first')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(openSettings).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start voice call' })).toBeDisabled())
  })

  it('keeps the call open when the page visibility changes', async () => {
    render(<TalkToAIView onOpenSettings={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start voice call' }))
    await screen.findByText('The server is busy.')

    document.dispatchEvent(new Event('visibilitychange'))

    expect(controllerMocks.end).not.toHaveBeenCalled()
  })
})
