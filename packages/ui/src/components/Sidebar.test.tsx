// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlurProvider } from '../lib/blur'
import { Sidebar } from './Sidebar'

vi.mock('./SyncStatus', () => ({ SyncStatus: () => null }))

const screenWidth = { narrow: false, listeners: new Set<() => void>() }

function resize(narrow: boolean): void {
  screenWidth.narrow = narrow
  act(() => screenWidth.listeners.forEach((notify) => notify()))
}

function renderSidebar(stored: string | null = null): ReturnType<typeof vi.fn> {
  const preferenceSet = vi.fn(async () => undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preferenceGet: vi.fn(async () => stored), preferenceSet }
  })
  render(<MemoryRouter><BlurProvider><Sidebar /></BlurProvider></MemoryRouter>)
  return preferenceSet
}

describe('Sidebar', () => {
  beforeEach(() => {
    screenWidth.narrow = false
    screenWidth.listeners.clear()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        media: query,
        get matches() { return screenWidth.narrow },
        addEventListener: (_type: string, notify: () => void) => screenWidth.listeners.add(notify),
        removeEventListener: (_type: string, notify: () => void) => screenWidth.listeners.delete(notify)
      })
    })
  })
  afterEach(cleanup)

  it('collapses to icons from the button and remembers it', () => {
    const preferenceSet = renderSidebar()
    expect(screen.getByText('Settings')).not.toHaveClass('sr-only')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByText('Settings')).toHaveClass('sr-only')
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('title', 'Settings')
    expect(preferenceSet).toHaveBeenLastCalledWith('ego.sidebar.collapsed', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(preferenceSet).toHaveBeenLastCalledWith('ego.sidebar.collapsed', '0')
  })

  it('opens collapsed when that was the last choice', async () => {
    renderSidebar('1')
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('toggles on Ctrl+B unless a field has the focus', () => {
    renderSidebar()
    fireEvent.keyDown(window, { code: 'KeyB', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    const field = document.createElement('textarea')
    document.body.append(field)
    fireEvent.keyDown(field, { code: 'KeyB', ctrlKey: true })
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    field.remove()
  })

  it('collapses on a narrow window without changing the saved choice', async () => {
    const preferenceSet = renderSidebar()
    resize(true)
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument()
    resize(false)
    resize(true)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    resize(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument())
    expect(preferenceSet).not.toHaveBeenCalled()
  })
})
