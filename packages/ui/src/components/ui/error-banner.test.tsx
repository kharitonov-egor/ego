// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './dialog'
import { ErrorBanner } from './error-banner'

describe('ErrorBanner', () => {
  afterEach(cleanup)

  it('renders nothing without a message', () => {
    const { container } = render(<ErrorBanner message={null} onDismiss={() => undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('announces the message and dismisses on click', () => {
    const dismiss = vi.fn()
    render(<ErrorBanner message="Could not save" onDismiss={dismiss} />)
    expect(screen.getByRole('alert').textContent).toBe('Could not save')
    fireEvent.click(screen.getByRole('button', { name: 'Could not save' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
})

describe('ConfirmDialog', () => {
  afterEach(cleanup)

  it('keeps the action on the button while busy', () => {
    render(<ConfirmDialog visible title="Delete card?" detail="Gone for good." confirmLabel="Delete" destructive busy onCancel={() => undefined} onConfirm={() => undefined} />)
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm.getAttribute('aria-busy')).toBe('true')
    expect(confirm.hasAttribute('disabled')).toBe(true)
  })
})
