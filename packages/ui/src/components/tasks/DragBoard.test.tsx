// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskListRecord } from '@ego/api-contracts'
import { BlurProvider } from '../../lib/blur'
import { DragBoard, type ListExtras } from './DragBoard'

vi.mock('../../lib/preferences', () => ({
  SecureStore: { getItemAsync: vi.fn(async () => '0'), setItemAsync: vi.fn(async () => undefined) }
}))

const STAMP = '2026-10-01T09:00:00.000Z'

const list: TaskListRecord = {
  id: 'l-1', boardId: 'b-1', name: 'Inbox', position: 1024, archivedAt: null, kind: 'cards', color: null, icon: '', border: false,
  createdAt: STAMP, updatedAt: STAMP, revision: 1
}

function board(
  onAddCard: (listId: string, title: string) => Promise<boolean>, extras: ListExtras | null = null
): React.ReactElement {
  return <BlurProvider>
    <DragBoard
      lists={[list]}
      cards={new Map([[list.id, []]])}
      labels={[]}
      labelStyle="names"
      now={new Date(2026, 9, 10, 8)}
      uploads={new Map()}
      onOpenCard={() => undefined}
      onCardMenu={() => undefined}
      onToggleDone={() => undefined}
      onMoveCard={() => undefined}
      onMoveList={() => undefined}
      onAddCard={onAddCard}
      onListMenu={() => undefined}
      onAddList={async () => true}
      listExtras={() => extras}
    />
  </BlurProvider>
}

afterEach(cleanup)

describe('DragBoard card composer', () => {
  it('takes the title in a box that wraps, and Enter adds the card', () => {
    const onAddCard = vi.fn(async () => true)
    render(board(onAddCard))
    fireEvent.click(screen.getByRole('button', { name: 'Add a card' }))
    const field = screen.getByRole('textbox', { name: 'Card title' })
    expect(field.tagName).toBe('TEXTAREA')

    fireEvent.change(field, { target: { value: 'Call the bank about the card that expired\nlast week' } })
    expect(field).toHaveValue('Call the bank about the card that expired last week')

    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
    expect(onAddCard).toHaveBeenCalledWith('l-1', 'Call the bank about the card that expired last week')
  })
})

describe('DragBoard list footer', () => {
  it('runs the add the list brings in place of the card composer', () => {
    const onAddCard = vi.fn(async () => true)
    const onPress = vi.fn()
    render(board(onAddCard, { add: { label: 'Add an assignment or exam', onPress } }))
    expect(screen.queryByRole('button', { name: 'Add a card' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add an assignment or exam' }))
    expect(onPress).toHaveBeenCalledOnce()
    expect(screen.queryByRole('textbox', { name: 'Card title' })).not.toBeInTheDocument()
    expect(onAddCard).not.toHaveBeenCalled()
  })
})
