// @vitest-environment jsdom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CalendarDialog } from './DatePicker'

describe('CalendarDialog', () => {
  afterEach(cleanup)

  it('starts each week on Monday', () => {
    render(<CalendarDialog visible value="2026-10-14" onCancel={() => undefined} onConfirm={() => undefined} />)
    const first = screen.getByRole('button', { name: 'Thursday, October 1' })
    const week = first.parentElement
    expect(week?.parentElement?.previousElementSibling?.textContent).toBe('MTWTFSS')
    expect(Array.from(week?.children ?? []).indexOf(first)).toBe(3)
    const sunday = screen.getByRole('button', { name: 'Sunday, October 4' })
    expect(sunday.parentElement).toBe(week)
    expect(Array.from(week?.children ?? []).indexOf(sunday)).toBe(6)
  })
})
