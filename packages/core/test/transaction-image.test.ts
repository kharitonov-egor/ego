import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  analyzeTransactionImage,
  isAnalyzedTransactionDraft,
  splitImageDataUrl,
  type AnalyzeTransactionImageInput,
  type ImageAnalysisCategory
} from '../src'

const categories: ImageAnalysisCategory[] = [
  { id: 'food', name: 'Food', kind: 'expense' },
  { id: 'pay', name: 'Pay', kind: 'income' }
]
const expense = {
  kind: 'expense', counterparty: 'Cafe', date: '2026-08-27', currency: 'USD', amountCents: 1250,
  notes: 'Lunch', categoryId: 'food', receipt: null
}
const income = {
  kind: 'income', counterparty: 'Client', date: null, currency: 'USD', amountCents: 50000,
  notes: 'Check 104', categoryId: 'pay', receipt: null
}
const itemized = {
  ...expense,
  amountCents: 106,
  receipt: {
    merchant: 'Market', purchaseDate: '2026-08-27', currency: 'USD', subtotalCents: 100,
    discountCents: 0, taxCents: 6, feesCents: 0, totalCents: 106,
    items: [{ name: 'Carrots', quantity: 1, unitPriceCents: 100, grossPriceCents: 100, discountCents: 0, lineTotalCents: 100 }]
  }
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function input(patch: Partial<AnalyzeTransactionImageInput> = {}): AnalyzeTransactionImageInput {
  return { base64: 'aGVsbG8=', mimeType: 'image/jpeg', apiKey: 'key', model: 'model', categories, ...patch }
}

async function analyze(value: unknown) {
  return analyzeTransactionImage(input(), async () => response(200, { choices: [{ message: { content: JSON.stringify(value) } }] }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('transaction image analysis', () => {
  it.each([expense, income, itemized])('accepts a valid draft', async (draft) => {
    await expect(analyze(draft)).resolves.toEqual({ ok: true, data: draft })
  })

  it('accepts no category match', async () => {
    await expect(analyze({ ...expense, categoryId: null })).resolves.toMatchObject({ ok: true })
  })

  it('tells the model to use the final bank-matching amount', async () => {
    let body = ''
    await analyzeTransactionImage(input(), async (_url, init) => {
      body = String(init?.body ?? '')
      return response(200, { choices: [{ message: { content: JSON.stringify(expense) } }] })
    })
    const request = JSON.parse(body) as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
    const prompt = request.messages[0].content.find((item) => item.type === 'text')?.text ?? ''
    expect(prompt).toContain('final amount actually paid, deposited, or charged')
    expect(prompt).toContain('match a bank account transaction')
    expect(prompt).toContain('suggested tips, cash tendered, change due')
    expect(prompt).toContain('receipt.totalCents must equal amountCents')
  })

  it('rejects unknown, wrong-kind, and inactive category ids', () => {
    expect(isAnalyzedTransactionDraft({ ...expense, categoryId: 'missing' }, categories)).toBe(false)
    expect(isAnalyzedTransactionDraft({ ...expense, categoryId: 'pay' }, categories)).toBe(false)
    expect(isAnalyzedTransactionDraft(expense, categories.filter((item) => item.id !== 'food'))).toBe(false)
  })

  it('rejects transfers and bad receipt totals', () => {
    expect(isAnalyzedTransactionDraft({ ...expense, kind: 'transfer' }, categories)).toBe(false)
    expect(isAnalyzedTransactionDraft({ ...itemized, amountCents: 999 }, categories)).toBe(false)
  })

  it.each([
    [{ ...expense, currency: 'EUR' }, 'This version only supports USD transactions.'],
    [{ ...expense, amountCents: 0 }, 'The model could not produce a complete transaction. Check the image and try again.'],
    [{ ...expense, date: '2026-02-30' }, 'The model could not produce a complete transaction. Check the image and try again.']
  ])('rejects invalid model data', async (draft, message) => {
    await expect(analyze(draft)).resolves.toEqual({ ok: false, message })
  })

  it.each([
    [{ mimeType: 'image/gif' }, 'Choose a JPEG, PNG, or WebP image.'],
    [{ base64: '' }, 'The image data is unreadable.'],
    [{ base64: 'x'.repeat(14 * 1024 * 1024) }, 'This image is larger than 10 MB. Choose a smaller image.']
  ])('rejects invalid image input', async (patch, message) => {
    await expect(analyzeTransactionImage(input(patch), vi.fn())).resolves.toEqual({ ok: false, message })
  })

  it.each([
    [401, 'OpenRouter rejected the API key. Check it in Settings.'],
    [429, 'OpenRouter rate limited this image. Wait a moment and try again.']
  ])('maps HTTP %s', async (status, message) => {
    await expect(analyzeTransactionImage(input(), async () => response(status, {}))).resolves.toEqual({ ok: false, message })
  })

  it('handles a refusal, malformed JSON, and a network failure', async () => {
    await expect(analyzeTransactionImage(input(), async () => response(200, { choices: [{ message: { refusal: 'no' } }] }))).resolves.toMatchObject({ ok: false })
    await expect(analyzeTransactionImage(input(), async () => response(200, { choices: [{ message: { content: '{bad' } }] }))).resolves.toMatchObject({ ok: false })
    await expect(analyzeTransactionImage(input(), async () => { throw new Error('offline') })).resolves.toEqual({ ok: false, message: 'OpenRouter is unreachable. Check your connection and try again.' })
  })

  it('stops after 60 seconds', async () => {
    vi.useFakeTimers()
    const request = analyzeTransactionImage(input(), (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))
    await vi.advanceTimersByTimeAsync(60000)
    await expect(request).resolves.toEqual({ ok: false, message: 'Image analysis took longer than 60 seconds. Try again.' })
  })

  it('splits supported clipboard data URLs', () => {
    expect(splitImageDataUrl('data:image/png;base64,aGVsbG8=')).toEqual({ mimeType: 'image/png', base64: 'aGVsbG8=' })
    expect(splitImageDataUrl('data:image/gif;base64,aGVsbG8=')).toBeNull()
  })
})
