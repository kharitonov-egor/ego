// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { emptyContentItem } from '@ego/core'
import type { ContentItemRecord } from '@ego/api-contracts'
import Content from './Content'
import { MemoryRouter } from 'react-router'
const mocks = vi.hoisted(() => ({ write: vi.fn(async (_work: (db: unknown, now: string) => Promise<void>, _scope: string) => true), save: vi.fn() }))
const items: ContentItemRecord[] = [
  { ...emptyContentItem('https://youtube.com/watch?v=1'), id: 'video', title: 'How does Claude Code actually work?', kind: 'video', tags: ['development'], favorite: true, coverUrl: 'https://example.com/cover-1.png', createdAt: '2026-10-03T12:00:00Z', updatedAt: '2026-10-03T12:00:00Z', revision: 1 },
  { ...emptyContentItem('https://paulgraham.com/greatwork.html'), id: 'article', title: 'How to Do Great Work', kind: 'article', collectionId: 'reading', coverUrl: 'https://example.com/cover-2.png', createdAt: '2026-09-28T12:00:00Z', updatedAt: '2026-09-28T12:00:00Z', revision: 1 },
  { ...emptyContentItem('https://example.com/old'), id: 'old', title: 'An old bookmark', trashedAt: '2026-10-04T12:00:00Z', createdAt: '2026-09-01T12:00:00Z', updatedAt: '2026-09-01T12:00:00Z', revision: 1 }
]
vi.mock('../../lib/content', () => ({ useContent: () => ({ items, collections: [{ id: 'reading', name: 'Reading', revision: 1 }], error: null, loading: false, ledger: { enabled: true, ready: true, writing: false, write: mocks.write, api: {} } }) }))
vi.mock('../../lib/blur', () => ({ Blurred: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@ego/local/content/actions', () => ({ saveContent: (...args: unknown[]) => mocks.save(...args), saveCollection: vi.fn(), deleteCollection: vi.fn() }))
afterEach(cleanup)
beforeEach(() => { mocks.write.mockClear(); mocks.save.mockClear() })
describe('Content library', () => {
  it('searches within a collection and keeps Trash out of the library', () => {
    render(<MemoryRouter><Content /></MemoryRouter>)
    expect(screen.getByText('How to Do Great Work')).toBeInTheDocument()
    expect(screen.queryByText('An old bookmark')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search bookmarks'), { target: { value: 'great' } })
    expect(screen.queryByText('How does Claude Code actually work?')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search bookmarks'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Trash, 1' }))
    expect(screen.getByText('An old bookmark')).toBeInTheDocument()
    expect(screen.queryByText('How to Do Great Work')).not.toBeInTheDocument()
  })
  it('submits a new bookmark and retains the form when a save fails', async () => {
    mocks.write.mockResolvedValueOnce(false)
    render(<MemoryRouter><Content /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A new page' } })
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.com/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }))
    await waitFor(() => expect(mocks.write).toHaveBeenCalled())
    expect(screen.getByLabelText('Title')).toHaveValue('A new page')
    fireEvent.click(screen.getByRole('button', { name: 'Save bookmark' }))
    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeInTheDocument())
  })
  it('restores a trashed item through the Content write scope', async () => {
    render(<MemoryRouter><Content /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Trash, 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore bookmark' }))
    expect(mocks.write).toHaveBeenCalledWith(expect.any(Function), 'content')
    const work = mocks.write.mock.calls[0][0] as unknown as (db: unknown, now: string) => Promise<void>
    await work({}, '2026-10-08T12:00:00Z')
    expect(mocks.save).toHaveBeenCalledWith({}, expect.objectContaining({ id: 'old', trashedAt: null }), items[2], '2026-10-08T12:00:00Z')
  })
  it('renders the card layout', () => {
    const result = render(<MemoryRouter><Content /></MemoryRouter>)
    expect(result.container.querySelectorAll('.content-card')).toHaveLength(2)
    if (process.env.EGO_CONTENT_PREVIEW) writeFileSync(process.env.EGO_CONTENT_PREVIEW, result.container.innerHTML)
  })
})
