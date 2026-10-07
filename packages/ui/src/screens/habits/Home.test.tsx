// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HabitRecord } from '@ego/api-contracts'
import { shiftIso } from '@ego/local/dates'
import type { DayScore, RowState } from '@ego/local/habits/stats'
import { WeekStrip } from '../../components/habits/WeekStrip'
import { BlurProvider } from '../../lib/blur'
import { HabitRow } from './Home'

const STAMP = '2026-01-01T09:00:00.000Z'

function habit(changes: Partial<HabitRecord>): HabitRecord {
  return {
    id: 'habit-1', name: 'Drink water', icon: '💧', kind: 'build', startDate: '2026-01-01', position: 0,
    target: 1, period: 'day', startedAt: null, createdAt: STAMP, updatedAt: STAMP, revision: 1, ...changes
  }
}

function renderRow(record: HabitRecord, state: RowState): Record<'onTap' | 'onTakeBack' | 'onEdit', ReturnType<typeof vi.fn>> {
  const handlers = { onTap: vi.fn(), onTakeBack: vi.fn(), onEdit: vi.fn() }
  render(<BlurProvider><HabitRow habit={record} state={state} thisWeek {...handlers} /></BlurProvider>)
  return handlers
}

describe('HabitRow', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { preferenceGet: vi.fn(async () => null), preferenceSet: vi.fn(async () => undefined) }
    })
  })
  afterEach(cleanup)

  it('adds on a click and takes one back on a right-click or Delete', () => {
    const handlers = renderRow(habit({ target: 6 }), { today: 2, progress: 2, target: 6, met: false })
    const row = screen.getByRole('button', { name: 'Drink water, 2 of 6 times' })
    fireEvent.click(row)
    expect(handlers.onTap).toHaveBeenCalledTimes(1)
    expect(fireEvent.contextMenu(row)).toBe(false)
    fireEvent.keyDown(row, { key: 'Delete' })
    expect(handlers.onTakeBack).toHaveBeenCalledTimes(2)
  })

  it('offers a minus only while a counted habit has check-offs', () => {
    const handlers = renderRow(habit({ target: 6 }), { today: 2, progress: 2, target: 6, met: false })
    fireEvent.click(screen.getByRole('button', { name: 'Take one back from Drink water' }))
    expect(handlers.onTakeBack).toHaveBeenCalledTimes(1)
    expect(handlers.onTap).not.toHaveBeenCalled()
    cleanup()
    renderRow(habit({ target: 6 }), { today: 0, progress: 0, target: 6, met: false })
    expect(screen.queryByRole('button', { name: 'Take one back from Drink water' })).not.toBeInTheDocument()
  })

  it('shows a once-a-day habit as a checkbox and keeps the pencil separate', () => {
    const handlers = renderRow(habit({}), { today: 1, progress: 1, target: 1, met: true })
    expect(screen.getByRole('checkbox', { name: 'Drink water' })).toBeChecked()
    expect(screen.queryByRole('button', { name: /^Take one back/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Drink water' }))
    expect(handlers.onEdit).toHaveBeenCalledTimes(1)
    expect(handlers.onTap).not.toHaveBeenCalled()
  })
})

describe('WeekStrip', () => {
  afterEach(cleanup)

  const score = (): DayScore => ({ date: '', done: 0, total: 1, partial: 0 })

  it('steps a week with the arrow keys and never past today', () => {
    const today = '2026-10-02'
    const onSelect = vi.fn()
    const { rerender } = render(<WeekStrip selected={today} today={today} scoreFor={score} onSelect={onSelect} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onSelect).toHaveBeenLastCalledWith(shiftIso(today, -7))

    const lastSunday = '2026-09-27'
    rerender(<WeekStrip selected={lastSunday} today={today} scoreFor={score} onSelect={onSelect} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith(today)
    expect(screen.getByRole('button', { name: 'Next week' })).toBeEnabled()
  })

  it('locks future days', () => {
    render(<WeekStrip selected="2026-10-02" today="2026-10-02" scoreFor={score} onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Saturday, October 3' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled()
  })
})
