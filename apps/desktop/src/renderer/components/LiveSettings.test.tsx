// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIVE_PREFERENCES } from '@ego/core'
import LiveSettings from './LiveSettings'

const setLivePreferences = vi.fn(async (preferences) => preferences)

describe('LiveSettings', () => {
  afterEach(cleanup)

  beforeEach(() => {
    setLivePreferences.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getLivePreferences: vi.fn(async () => DEFAULT_LIVE_PREFERENCES),
        setLivePreferences
      }
    })
  })

  it('loads accessible controls and saves preferences for the next call', async () => {
    render(<LiveSettings />)

    const voice = await screen.findByRole('combobox', { name: 'AI voice' })
    fireEvent.change(voice, { target: { value: 'coral' } })
    fireEvent.change(screen.getByLabelText('Reasoning depth'), { target: { value: 'high' } })
    fireEvent.change(screen.getByLabelText('Web search'), { target: { value: 'required' } })
    fireEvent.change(screen.getByLabelText('Custom speaking instructions'), { target: { value: 'Speak slowly.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }))

    await waitFor(() => expect(setLivePreferences).toHaveBeenCalledWith({
      ...DEFAULT_LIVE_PREFERENCES,
      voice: 'coral',
      reasoningEffort: 'high',
      webSearch: 'required',
      customInstructions: 'Speak slowly.'
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved for the next call')
  })
})
