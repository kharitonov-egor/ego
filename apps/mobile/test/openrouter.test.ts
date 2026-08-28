import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeImage } from '../lib/openrouter'

const categories = [{ id: 'food', name: 'Food', kind: 'expense' as const }]
const draft = {
  kind: 'expense' as const, counterparty: 'Cafe', date: '2026-08-27', currency: 'USD',
  amountCents: 1250, notes: 'Lunch', categoryId: 'food', receipt: null
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

afterEach(() => vi.unstubAllGlobals())

describe('mobile transaction image analysis', () => {
  it('uses the shared analyzer with the mobile fetch implementation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {
      choices: [{ message: { content: JSON.stringify(draft) } }]
    })))
    await expect(analyzeImage({
      base64: 'aGVsbG8=', mimeType: 'image/jpeg', apiKey: 'key', model: 'model', categories
    })).resolves.toEqual({ ok: true, data: draft })
  })

  it('does not include secrets in a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(analyzeImage({
      base64: 'c2VjcmV0', mimeType: 'image/jpeg', apiKey: 'secret-key', model: 'model', categories
    })).resolves.toEqual({ ok: false, message: 'OpenRouter is unreachable. Check your connection and try again.' })
  })
})
