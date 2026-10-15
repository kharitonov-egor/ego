// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReorderList } from './ReorderList'

const items = [{ id: 'teeth', name: 'Brush teeth' }, { id: 'water', name: 'Drink water' }]

describe('ReorderList with rows that bring their own buttons', () => {
  afterEach(cleanup)

  it('leaves clicks to the row and moves the row of the focused button with Alt and an arrow', () => {
    const onMove = vi.fn()
    const onTap = vi.fn()
    render(<ReorderList
      items={items}
      onMove={onMove}
      renderItem={(item) => <button type="button" onClick={() => onTap(item.id)}>{item.name}</button>}
    />)
    expect(screen.getAllByRole('button')).toHaveLength(2)

    const water = screen.getByRole('button', { name: 'Drink water' })
    fireEvent.click(water)
    expect(onTap).toHaveBeenCalledWith('water')
    fireEvent.keyDown(water, { key: 'Enter' })
    expect(onTap).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(water, { key: 'ArrowUp', altKey: true })
    expect(onMove).toHaveBeenCalledWith('water', 0)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Brush teeth' }), { key: 'ArrowUp', altKey: true })
    expect(onMove).toHaveBeenCalledTimes(1)
  })
})
