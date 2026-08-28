import type { FetchLike } from './trello'
import {
  isReceiptDraft,
  type AnalyzedTransactionDraft,
  type ImageAnalysisCategory
} from './money'

export const MAX_TRANSACTION_IMAGE_BYTES = 10 * 1024 * 1024
export const TRANSACTION_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export interface AnalyzeTransactionImageInput {
  base64: string
  mimeType: string
  apiKey: string
  model: string
  categories: ImageAnalysisCategory[]
}

export type TransactionImageAnalysisResult =
  | { ok: true; data: AnalyzedTransactionDraft }
  | { ok: false; message: string }

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string; refusal?: string } }>
  error?: { message?: string }
}

const itemProperties = {
  name: { type: 'string' },
  quantity: { type: 'number' },
  unitPriceCents: { type: ['integer', 'null'] },
  grossPriceCents: { type: 'integer', minimum: 0 },
  discountCents: { type: 'integer', minimum: 0 },
  lineTotalCents: { type: 'integer', minimum: 0 }
}

const receiptProperties = {
  merchant: { type: 'string' },
  purchaseDate: { type: 'string' },
  currency: { type: 'string' },
  subtotalCents: { type: 'integer', minimum: 0 },
  discountCents: { type: 'integer', minimum: 0 },
  taxCents: { type: 'integer', minimum: 0 },
  feesCents: { type: 'integer', minimum: 0, description: 'Tips, service charges, and other fees included in the final charge.' },
  totalCents: { type: 'integer', minimum: 1, description: 'The final amount paid or charged. This must match amountCents.' },
  items: {
    type: 'array', minItems: 1, maxItems: 500,
    items: {
      type: 'object', additionalProperties: false,
      required: Object.keys(itemProperties), properties: itemProperties
    }
  }
}

function responseSchema(categories: ImageAnalysisCategory[]): object {
  const ids = categories.map((category) => category.id)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'counterparty', 'date', 'currency', 'amountCents', 'notes', 'categoryId', 'receipt'],
    properties: {
      kind: { type: 'string', enum: ['income', 'expense'] },
      counterparty: { type: 'string' },
      date: { type: ['string', 'null'] },
      currency: { type: 'string' },
      amountCents: { type: 'integer', minimum: 1, description: 'The final amount that should match the bank account transaction.' },
      notes: { type: 'string' },
      categoryId: ids.length
        ? { anyOf: [{ type: 'string', enum: ids }, { type: 'null' }] }
        : { type: 'null' },
      receipt: {
        anyOf: [
          {
            type: 'object', additionalProperties: false,
            required: Object.keys(receiptProperties), properties: receiptProperties
          },
          { type: 'null' }
        ]
      }
    }
  }
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function isAnalyzedTransactionDraft(
  value: unknown,
  categories: ImageAnalysisCategory[]
): value is AnalyzedTransactionDraft {
  if (typeof value !== 'object' || value === null) return false
  const draft = value as Record<string, unknown>
  if (draft.kind !== 'income' && draft.kind !== 'expense') return false
  if (typeof draft.counterparty !== 'string' || !draft.counterparty.trim() || draft.counterparty.trim().length > 120) return false
  if (draft.date !== null && !validIsoDate(draft.date)) return false
  if (draft.currency !== 'USD') return false
  if (!Number.isSafeInteger(draft.amountCents) || (draft.amountCents as number) <= 0) return false
  if (typeof draft.notes !== 'string' || draft.notes.length > 360) return false
  if (draft.categoryId !== null) {
    const category = categories.find((item) => item.id === draft.categoryId)
    if (!category || category.kind !== draft.kind) return false
  }
  if (draft.receipt !== null) {
    if (draft.kind !== 'expense' || !isReceiptDraft(draft.receipt)) return false
    if (draft.receipt.totalCents !== draft.amountCents || draft.receipt.currency !== 'USD') return false
  }
  return true
}

export function splitImageDataUrl(data: string): { base64: string; mimeType: string } | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(data)
  if (!match) return null
  return { mimeType: match[1], base64: match[2].replace(/[\r\n]/g, '') }
}

function imageError(input: AnalyzeTransactionImageInput): string | null {
  if (!input.apiKey.trim()) return 'Add an OpenRouter API key in Settings.'
  if (!input.model.trim()) return 'Choose an OpenRouter model in Settings.'
  if (!(TRANSACTION_IMAGE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  const encoded = input.base64.replace(/[\r\n]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return 'The image data is unreadable.'
  if (encoded.length * 0.75 > MAX_TRANSACTION_IMAGE_BYTES) {
    return 'This image is larger than 10 MB. Choose a smaller image.'
  }
  return null
}

export async function analyzeTransactionImage(
  input: AnalyzeTransactionImageInput,
  fetcher: FetchLike
): Promise<TransactionImageAnalysisResult> {
  const blocked = imageError(input)
  if (blocked) return { ok: false, message: blocked }
  const categories = input.categories.filter((category) =>
    category.id && category.name.trim() && (category.kind === 'income' || category.kind === 'expense'))
  const categoryList = categories.length
    ? JSON.stringify(categories.map(({ id, name, kind }) => ({ id, name, kind })))
    : '[]'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  let response: Response
  try {
    response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey.trim()}`,
        'content-type': 'application/json',
        'x-title': 'Ego transaction image analyzer'
      },
      body: JSON.stringify({
        model: input.model.trim(),
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Read this image as one financial transaction. It may be a check, receipt, invoice, card slip, or screenshot. Classify money received as income and money paid as expense. Never return a transfer. The highest priority is amountCents. It must be the final amount actually paid, deposited, or charged, so it can match a bank account transaction. Prefer a clearly labeled grand total, amount paid, card total, or final handwritten total over a subtotal or your own item arithmetic. Include a visible tip, service charge, tax, and fee in the final amount. Do not treat suggested tips, cash tendered, change due, discounts, savings, or a temporary authorization amount as the final charge when a settled total is visible. Never guess a missing tip or adjustment. For an itemized receipt, receipt.totalCents must equal amountCents. Store a visible tip or service charge in receipt.feesCents. Copy the visible counterparty without guessing. Use integer cents. Return null for a date that is not visible. Use USD only. Choose categoryId only from this list and only when its kind matches the transaction: ${categoryList}. Return null when none fit. Put other useful visible text in notes. Include receipt details only for an itemized expense with readable line items. Gross price is before an item discount. Line total is the final item charge. Use 0 for absent discounts, tax, or fees. Do not invent items or prices.`
            },
            { type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.base64}` } }
          ]
        }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'transaction_image', strict: true, schema: responseSchema(categories) }
        }
      }),
      signal: controller.signal
    })
  } catch (error: unknown) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: 'Image analysis took longer than 60 seconds. Try again.' }
    }
    return { ok: false, message: 'OpenRouter is unreachable. Check your connection and try again.' }
  }
  clearTimeout(timer)
  let value: OpenRouterResponse
  try {
    value = await response.json() as OpenRouterResponse
  } catch {
    return { ok: false, message: 'OpenRouter returned an unreadable response.' }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'OpenRouter rejected the API key. Check it in Settings.' }
  }
  if (response.status === 429) return { ok: false, message: 'OpenRouter rate limited this image. Wait a moment and try again.' }
  if (!response.ok) return { ok: false, message: value.error?.message ?? `OpenRouter returned HTTP ${response.status}.` }
  const message = value.choices?.[0]?.message
  if (message?.refusal) return { ok: false, message: 'The model could not read this image. Try a clearer copy.' }
  if (!message?.content) return { ok: false, message: 'The model returned no transaction data.' }
  let draft: unknown
  try { draft = JSON.parse(message.content) } catch {
    return { ok: false, message: 'The model returned invalid transaction data. Try again.' }
  }
  if (typeof draft === 'object' && draft !== null && 'currency' in draft && draft.currency !== 'USD') {
    return { ok: false, message: 'This version only supports USD transactions.' }
  }
  if (!isAnalyzedTransactionDraft(draft, categories)) {
    return { ok: false, message: 'The model could not produce a complete transaction. Check the image and try again.' }
  }
  return { ok: true, data: draft }
}
