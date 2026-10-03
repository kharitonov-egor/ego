// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiResult, FoodAnalyzeResponse, FoodProductResponse } from '@ego/api-contracts'
import { SAVE_DELAY_MS } from '@ego/core'
import { FoodProvider, useFood } from './context'

const mocks = vi.hoisted(() => {
  const write = vi.fn(async (_work: unknown, _scope?: string) => true)
  const foodAnalyze = vi.fn()
  const foodProduct = vi.fn()
  return {
    write, foodAnalyze, foodProduct,
    ledger: { api: { foodAnalyze, foodProduct }, db: {}, enabled: true, ready: true, foodVersion: 0, write }
  }
})

vi.mock('../ledger', () => ({ useLedger: () => mocks.ledger }))
vi.mock('../today', () => ({ useToday: () => '2026-10-02' }))
vi.mock('../preferences', () => ({
  SecureStore: { getItemAsync: async () => null, setItemAsync: async () => undefined }
}))
vi.mock('@ego/local/food/repository', () => ({
  localFood: async () => ({ entries: [], fridge: [], goal: null }),
  failedFoodUploads: async () => new Set<string>(),
  localFoodRevision: async () => 1
}))

const PHO: ApiResult<FoodAnalyzeResponse> = {
  ok: true,
  data: {
    mode: 'meal',
    meal: {
      name: 'Large bowl of pho', serving: '1 large bowl', note: '', calories: 680, protein: 42, carbs: 88, fat: 14,
      parts: [{ name: 'Pho', calories: 680, protein: 42, carbs: 88, fat: 14 }]
    }
  }
}

let food: ReturnType<typeof useFood> | null = null

function Probe(): null {
  food = useFood()
  return null
}

async function settle(ms = 0): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function current(): ReturnType<typeof useFood> {
  if (!food) throw new Error('FoodProvider did not render')
  return food
}

describe('FoodProvider drafts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.write.mockClear()
    mocks.foodAnalyze.mockReset().mockResolvedValue(PHO)
    mocks.foodProduct.mockReset()
    render(<FoodProvider><Probe /></FoodProvider>)
  })

  afterEach(() => {
    cleanup()
    food = null
    vi.useRealTimers()
  })

  it('saves a described meal once the bar runs out', async () => {
    await settle()
    await act(async () => { await current().logText('a large bowl of pho') })
    expect(mocks.foodAnalyze).toHaveBeenCalledWith({ mode: 'meal', image: null, text: 'a large bowl of pho' })
    expect(current().draft?.state).toBe('ready')
    await settle(SAVE_DELAY_MS - 100)
    expect(mocks.write).not.toHaveBeenCalled()
    await settle(200)
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write.mock.calls[0][1]).toBe('food')
    expect(current().draft).toBeNull()
  })

  it('throws the meal away on Undo', async () => {
    await settle()
    await act(async () => { await current().logText('a large bowl of pho') })
    act(() => current().undoDraft())
    await settle(SAVE_DELAY_MS * 2)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(current().draft).toBeNull()
  })

  it('holds the timer while the editor is open and gives the full delay back after', async () => {
    await settle()
    await act(async () => { await current().logText('a large bowl of pho') })
    await settle(SAVE_DELAY_MS - 500)
    act(() => current().pauseDraft(true))
    await settle(SAVE_DELAY_MS * 3)
    expect(mocks.write).not.toHaveBeenCalled()
    act(() => current().pauseDraft(false))
    await settle(SAVE_DELAY_MS - 500)
    expect(mocks.write).not.toHaveBeenCalled()
    await settle(600)
    expect(mocks.write).toHaveBeenCalledTimes(1)
  })

  it('offers another way in when no database knows the barcode', async () => {
    const unknown: ApiResult<FoodProductResponse> = { ok: true, data: { product: null } }
    mocks.foodProduct.mockResolvedValue(unknown)
    await settle()
    await act(async () => { await current().logBarcode('0000123', null) })
    const draft = current().draft
    expect(draft?.state).toBe('failed')
    expect(draft?.unknownBarcode).toBe('0000123')
    await settle(SAVE_DELAY_MS * 2)
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('saves the card still counting down when the next one starts', async () => {
    await settle()
    await act(async () => { await current().logText('a large bowl of pho') })
    await act(async () => { await current().logText('two eggs and toast') })
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(current().draft?.state).toBe('ready')
  })
})
