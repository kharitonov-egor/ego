// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskCardInput } from '@ego/core'
import type { TaskBoardRecord, TaskCardRecord, TaskLabelRecord, TaskListRecord } from '@ego/api-contracts'
import { cardInput } from '@ego/local/tasks/board'
import type { TaskData } from '@ego/local/tasks/repository'
import { QuickEdit } from '../../components/tasks/QuickEdit'
import { BlurProvider } from '../../lib/blur'
import CardScreen, { CardPanel } from './Card'

const STAMP = '2026-10-01T09:00:00.000Z'

const board: TaskBoardRecord = { id: 'b-1', name: 'Life', icon: '', position: 1024, hideDone: false, moveDone: false, archivedAt: null, createdAt: STAMP, updatedAt: STAMP, revision: 1 }
const list: TaskListRecord = { id: 'l-1', boardId: 'b-1', name: 'Backlog', kind: 'cards', color: null, icon: '', border: false, position: 1024, archivedAt: null, createdAt: STAMP, updatedAt: STAMP, revision: 1 }
const card: TaskCardRecord = {
  id: 'k-1', boardId: 'b-1', listId: 'l-1', title: 'Pay rent', description: '', position: 1024, labelIds: [],
  priority: 'none', dueDate: null, dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [],
  attachments: [], activity: [], createdAt: STAMP, updatedAt: STAMP, revision: 1
}

const label = (id: string, name: string, position: number): TaskLabelRecord => ({
  id, boardId: 'b-1', name, color: 'green', position, createdAt: STAMP, updatedAt: STAMP, revision: 1
})
const labels = [label('t-1', 'COT3100', 1024), label('t-2', 'Home', 2048)]

type Change = (input: TaskCardInput) => TaskCardInput

/** The see-through layer behind the topmost dialog, which a click outside lands on. */
function backdropOf(inside: Element): Element {
  const dialog = inside.closest('[role="dialog"]')
  if (!dialog?.parentElement) throw new Error('Not inside a dialog')
  return dialog.parentElement
}

const mocks = vi.hoisted(() => ({
  updateCard: vi.fn<(cardId: string, change: (input: TaskCardInput) => TaskCardInput) => Promise<boolean>>(),
  data: null as TaskData | null
}))

vi.mock('../../lib/tasks/context', () => ({
  useTasks: () => ({
    data: mocks.data,
    now: new Date(2026, 9, 10, 8),
    error: null,
    dismissError: vi.fn(),
    updateCard: mocks.updateCard,
    addFiles: vi.fn(async () => true),
    deleteCard: vi.fn(async () => true)
  })
}))

vi.mock('../../lib/ledger', () => ({
  useLedger: () => ({ loaded: true, enabled: true, error: null, current: true, syncing: false, status: null, sync: vi.fn() })
}))

function escape(target: Element = document.activeElement ?? document.body): void {
  fireEvent.keyDown(target, { key: 'Escape' })
}

function lastChange(): Change {
  const call = mocks.updateCard.mock.calls.at(-1)
  if (!call) throw new Error('updateCard was not called')
  return call[1]
}

function renderPanel(): ReturnType<typeof vi.fn> {
  const onClose = vi.fn()
  render(<BlurProvider><MemoryRouter><CardPanel cardId="k-1" onClose={onClose} onOpenCard={vi.fn()} /></MemoryRouter></BlurProvider>)
  return onClose
}

beforeEach(() => {
  mocks.data = { boards: [board], lists: [list], labels, cards: [card], uploads: new Map() }
  mocks.updateCard.mockReset()
  mocks.updateCard.mockResolvedValue(true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preferenceGet: vi.fn(async () => null), preferenceSet: vi.fn(async () => undefined) }
  })
})
afterEach(cleanup)

describe('the card panel over the board', () => {
  it('closes on Escape', () => {
    const onClose = renderPanel()
    expect(screen.getByRole('button', { name: /In list Backlog/ })).toBeInTheDocument()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.updateCard).not.toHaveBeenCalled()
  })

  it('closes on Escape while the title is being edited and keeps the new title', () => {
    const onClose = renderPanel()
    const title = screen.getByLabelText('Card title')
    title.focus()
    fireEvent.change(title, { target: { value: 'Pay rent today' } })
    escape(title)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mocks.updateCard).toHaveBeenCalledTimes(1)
    expect(lastChange()(cardInput(card)).title).toBe('Pay rent today')
  })

  it('closes a dialog opened over it first, then itself', () => {
    const onClose = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))
    expect(screen.getByRole('heading', { name: 'Labels' })).toBeInTheDocument()
    escape()
    expect(screen.queryByRole('heading', { name: 'Labels' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    escape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes the Labels sheet on a click outside it and stays open itself', () => {
    const onClose = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))
    fireEvent.mouseDown(backdropOf(screen.getByRole('heading', { name: 'Labels' })))
    expect(screen.queryByRole('heading', { name: 'Labels' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the activity folded until its heading is clicked', () => {
    renderPanel()
    expect(screen.queryByText('Nothing yet.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }))
    expect(screen.getByText('Nothing yet.')).toBeInTheDocument()
  })
})

describe('the card page', () => {
  it('goes back on Escape', () => {
    render(<BlurProvider>
      <MemoryRouter initialEntries={[{ pathname: '/tasks/card/k-1', state: { back: '/tasks/upcoming' } }]}>
        <Routes>
          <Route path="/tasks/card/:id" element={<CardScreen />} />
          <Route path="/tasks/upcoming" element={<p>Upcoming page</p>} />
        </Routes>
      </MemoryRouter>
    </BlurProvider>)
    expect(screen.getByLabelText('Card title')).toBeInTheDocument()
    escape()
    expect(screen.getByText('Upcoming page')).toBeInTheDocument()
  })
})

describe('the quick editor', () => {
  function renderQuick(): Record<'onOpen' | 'onClose', ReturnType<typeof vi.fn>> {
    const handlers = { onOpen: vi.fn(), onClose: vi.fn() }
    render(<BlurProvider><QuickEdit target={{ cardId: 'k-1', rect: { top: 120, left: 40, width: 280 } }} {...handlers} /></BlurProvider>)
    return handlers
  }

  it('saves the title on Enter', () => {
    const { onClose } = renderQuick()
    const title = screen.getByLabelText('Card title')
    fireEvent.change(title, { target: { value: 'Pay rent now' } })
    fireEvent.keyDown(title, { key: 'Enter' })
    expect(lastChange()(cardInput(card)).title).toBe('Pay rent now')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('drops the title on Escape', () => {
    const { onClose } = renderQuick()
    const title = screen.getByLabelText('Card title')
    fireEvent.change(title, { target: { value: 'Pay rent now' } })
    escape(title)
    expect(mocks.updateCard).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('puts a label on from the picker beside Edit labels, and Escape closes only the picker', () => {
    const { onClose } = renderQuick()
    fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Home' }))
    expect(lastChange()(cardInput(card)).labelIds).toEqual(['t-2'])
    escape(screen.getByLabelText('Search labels'))
    expect(screen.queryByLabelText('Search labels')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes the picker and the editor together on a click outside, keeping the typed title', () => {
    const { onClose } = renderQuick()
    fireEvent.change(screen.getByLabelText('Card title'), { target: { value: 'Pay rent soon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }))
    fireEvent.mouseDown(backdropOf(screen.getByLabelText('Search labels')))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(lastChange()(cardInput(card)).title).toBe('Pay rent soon')
  })

  it('narrows the picker by search and toggles the first match on Enter', () => {
    renderQuick()
    fireEvent.click(screen.getByRole('button', { name: 'Edit labels' }))
    const search = screen.getByLabelText('Search labels')
    fireEvent.change(search, { target: { value: 'cot' } })
    expect(screen.queryByRole('checkbox', { name: 'Home' })).not.toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(lastChange()(cardInput(card)).labelIds).toEqual(['t-1'])
  })

  it('opens labels and dates beside the card', () => {
    renderQuick()
    fireEvent.click(screen.getByRole('button', { name: 'Edit dates' }))
    expect(screen.getByRole('heading', { name: 'Dates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'None', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EOD', pressed: true })).toBeInTheDocument()
  })
})
