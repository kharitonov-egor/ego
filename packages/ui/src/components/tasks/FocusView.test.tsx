// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskCardRecord, TaskListRecord } from '@ego/api-contracts'
import { resolvedHotkeys } from '@ego/core'
import { BlurProvider } from '../../lib/blur'
import { FocusView, type FocusViewProps } from './FocusView'

vi.mock('../../lib/hotkeys', () => ({ useHotkeys: () => ({ keys: resolvedHotkeys({}) }) }))

const STAMP = '2026-10-01T09:00:00.000Z'

const inbox: TaskListRecord = {
  id: 'l-inbox', boardId: 'b-1', name: 'Inbox', kind: 'inbox', color: null, icon: '', border: false, position: 1024, archivedAt: null,
  createdAt: STAMP, updatedAt: STAMP, revision: 1
}

const card = (id: string, title: string, overrides: Partial<TaskCardRecord> = {}): TaskCardRecord => ({
  id, boardId: 'b-1', listId: 'l-inbox', title, description: '', position: 1024, labelIds: [], priority: 'none', dueDate: null,
  dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [], attachments: [], activity: [],
  createdAt: STAMP, updatedAt: STAMP, revision: 1, ...overrides
})

const cards = [card('k-1', 'Email the TA'), card('k-2', 'Buy milk'), card('k-3', 'Book flights')]

let handlers: Pick<FocusViewProps, 'onExit' | 'onOpenCard' | 'onCurrent' | 'onToggleDone' | 'onCardMenu' | 'onPickList'>

function view(shown: readonly TaskCardRecord[]): React.ReactElement {
  return <BlurProvider>
    <FocusView list={inbox} lists={[inbox]} cards={shown} labels={[]} now={new Date(2026, 9, 10, 8)} uploads={new Map()} {...handlers} />
  </BlurProvider>
}

function lastCurrent(): string | null {
  const calls = vi.mocked(handlers.onCurrent).mock.calls.filter((call) => call[0] !== null)
  return calls.at(-1)?.[0] ?? null
}

beforeEach(() => {
  handlers = { onExit: vi.fn(), onOpenCard: vi.fn(), onCurrent: vi.fn(), onToggleDone: vi.fn(), onCardMenu: vi.fn(), onPickList: vi.fn() }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { preferenceGet: vi.fn(async () => null), preferenceSet: vi.fn(async () => undefined) }
  })
})
afterEach(cleanup)

describe('focus mode', () => {
  it('starts on the top card and steps down and up with the arrow keys', () => {
    render(view(cards))
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    expect(lastCurrent()).toBe('k-1')
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(lastCurrent()).toBe('k-2')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
  })

  it('moves to a grayed card when it is clicked and opens the middle one', () => {
    render(view(cards))
    fireEvent.click(screen.getByRole('button', { name: 'Go to Buy milk' }))
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Buy milk'))
    expect(handlers.onOpenCard).toHaveBeenCalledWith('k-2')
  })

  it('hands the middle to the next card when the current one is marked done or leaves the list', () => {
    const { rerender } = render(view(cards))
    rerender(view([{ ...cards[0], doneAt: STAMP }, cards[1], cards[2]]))
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    rerender(view([cards[0], cards[2]]))
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(lastCurrent()).toBe('k-3')
  })

  it('leaves on Escape and says so when the list is empty', () => {
    render(view([]))
    expect(screen.getByText('Nothing in Inbox')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handlers.onExit).toHaveBeenCalledTimes(1)
  })
})
