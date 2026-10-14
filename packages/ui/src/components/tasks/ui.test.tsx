// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskCardRecord, TaskLabelRecord } from '@ego/api-contracts'
import { BlurProvider } from '../../lib/blur'
import { CardFace } from './ui'

const store = vi.hoisted(() => ({ blur: '0' }))
vi.mock('../../lib/preferences', () => ({
  SecureStore: { getItemAsync: vi.fn(async () => store.blur), setItemAsync: vi.fn(async () => undefined) }
}))

const STAMP = '2026-10-01T09:00:00.000Z'

const label = (id: string, name: string, color: TaskLabelRecord['color']): TaskLabelRecord => ({
  id, boardId: 'b-1', name, color, position: 1024, createdAt: STAMP, updatedAt: STAMP, revision: 1
})

const labels = [label('t-1', 'Errands', 'green'), label('t-2', '', 'red')]

const card: TaskCardRecord = {
  id: 'k-1', boardId: 'b-1', listId: 'l-1', title: 'Buy milk', description: '', position: 1024, labelIds: ['t-1', 't-2'],
  priority: 'none', dueDate: null, dueTime: null, reminderMinutes: null, doneAt: null, archivedAt: null, checklists: [],
  attachments: [], activity: [], createdAt: STAMP, updatedAt: STAMP, revision: 1
}

function face(labelStyle?: 'names' | 'lines'): React.ReactElement {
  return <BlurProvider><CardFace card={card} labels={labels} labelStyle={labelStyle} now={new Date(2026, 9, 10, 8)} /></BlurProvider>
}

afterEach(() => {
  cleanup()
  store.blur = '0'
})

describe('CardFace labels', () => {
  it('shows each label name next to its dot by default', () => {
    render(face())
    expect(screen.getByText('Errands')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Red label' })).toBeInTheDocument()
  })

  it('draws bare color lines three to a row, named on hover', () => {
    render(face('lines'))
    expect(screen.queryByText('Errands')).not.toBeInTheDocument()
    const errands = screen.getByRole('img', { name: 'Errands' })
    expect(errands).toHaveAttribute('title', 'Errands')
    expect(errands).toHaveStyle({ backgroundColor: '#4f9d69' })
    expect(screen.getByRole('img', { name: 'Red label' })).toHaveAttribute('title', 'Red label')
    expect(errands.parentElement).toHaveClass('grid-cols-3')
  })

  it('keeps the name out of the tooltip while Blur is on', async () => {
    store.blur = '1'
    render(face('lines'))
    const line = await screen.findByRole('img', { name: 'Green label' })
    expect(line).toHaveAttribute('title', 'Green label')
    expect(screen.queryByTitle('Errands')).not.toBeInTheDocument()
  })
})
