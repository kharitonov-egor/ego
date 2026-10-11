// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocketSummary } from '@ego/api-contracts'
import { BlurProvider } from '../../lib/blur'
import DocketList from './DocketList'

function docket(id: string, title: string, repository: string | null, createdAt: string, updatedAt = createdAt): DocketSummary {
  return {
    id, title, description: '', public: false, repository, latestVersion: 1, versionCount: 1, createdAt, updatedAt,
    url: `https://ego.kharitonovegor.com/docket/${id}`
  }
}

const DOCKETS = [
  docket('aaaaaaaaaa', 'Oldest, edited last', 'me/ego', '2026-10-01T10:00:00.000Z', '2026-10-09T10:00:00.000Z'),
  docket('bbbbbbbbbb', 'Newest', null, '2026-10-05T10:00:00.000Z'),
  docket('cccccccccc', 'Middle', 'me/site', '2026-10-03T10:00:00.000Z')
]

const mocks = vi.hoisted(() => ({
  dockets: vi.fn(),
  docketPdf: vi.fn<(id: string, title: string) => Promise<string | null>>(),
  preferenceSet: vi.fn(async () => undefined),
  saved: null as string | null
}))

vi.mock('../../lib/ledger', () => ({
  useLedger: () => ({ loaded: true, enabled: true, api: { dockets: mocks.dockets } })
}))

function titles(): string[] {
  return screen.getAllByRole('link').filter((link) => link.getAttribute('target') === '_blank').map((link) => link.textContent ?? '')
}

beforeEach(() => {
  mocks.dockets.mockResolvedValue({ ok: true, data: { dockets: DOCKETS } })
  mocks.docketPdf.mockReset()
  mocks.preferenceSet.mockClear()
  mocks.saved = null
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      preferenceGet: vi.fn(async (key: string) => key === 'ego.dockets.order' ? mocks.saved : null),
      preferenceSet: mocks.preferenceSet,
      docketPdf: mocks.docketPdf
    }
  })
})
afterEach(cleanup)

function renderList(): void {
  render(<BlurProvider><MemoryRouter><DocketList /></MemoryRouter></BlurProvider>)
}

describe('the docket list', () => {
  it('starts newest first and switches order from the dropdown', async () => {
    renderList()
    const sort = await screen.findByRole('combobox', { name: 'Sort' })
    expect(sort).toHaveValue('newest')
    expect(titles()).toEqual(['Newest', 'Middle', 'Oldest, edited last'])
    expect(screen.queryByRole('heading', { name: 'me/ego' })).not.toBeInTheDocument()

    fireEvent.change(sort, { target: { value: 'oldest' } })
    expect(titles()).toEqual(['Oldest, edited last', 'Middle', 'Newest'])
    fireEvent.change(sort, { target: { value: 'updated' } })
    expect(titles()).toEqual(['Oldest, edited last', 'Newest', 'Middle'])
    expect(mocks.preferenceSet).toHaveBeenLastCalledWith('ego.dockets.order', 'updated')
  })

  it('groups by project when that order was saved', async () => {
    mocks.saved = 'project'
    renderList()
    expect(await screen.findByRole('heading', { name: 'me/ego' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No repository' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('project')
  })

  it('downloads a PDF from its row and shows why one failed', async () => {
    mocks.docketPdf.mockResolvedValueOnce(null).mockResolvedValueOnce('The PDF could not be made: Navigation timeout')
    renderList()
    await screen.findByRole('combobox', { name: 'Sort' })
    const [first, second] = screen.getAllByRole('button', { name: 'Download PDF' })
    fireEvent.click(first)
    await waitFor(() => expect(mocks.docketPdf).toHaveBeenCalledWith('bbbbbbbbbb', 'Newest'))
    fireEvent.click(second)
    const row = second.parentElement
    if (!row) throw new Error('The button has no row')
    expect(await within(row).findByRole('alert')).toHaveTextContent('Navigation timeout')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })
})
