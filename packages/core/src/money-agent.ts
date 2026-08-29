import type { FetchLike } from './trello'
import {
  isAnalyzedTransactionDraft,
  MAX_TRANSACTION_IMAGE_BYTES,
  TRANSACTION_IMAGE_MIME_TYPES
} from './transaction-image'
import type { AnalyzedTransactionDraft, ImageAnalysisCategory } from './money'

export interface MoneyAgentAccount {
  id: string
  name: string
}

export interface MoneyAgentDraft extends AnalyzedTransactionDraft {
  accountId: string
}

export interface RunMoneyAgentInput {
  message: string
  image?: { base64: string; mimeType: string }
  apiKey: string
  model: string
  today: string
  accounts: MoneyAgentAccount[]
  categories: ImageAnalysisCategory[]
}

export type MoneyAgentResult =
  | { ok: true; data: MoneyAgentDraft[] }
  | { ok: false; message: string }

interface OpenRouterToolCall {
  function?: { name?: string; arguments?: string }
}

interface OpenRouterResponse {
  choices?: Array<{ message?: { tool_calls?: OpenRouterToolCall[]; refusal?: string } }>
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
  currency: { type: 'string', enum: ['USD'] },
  subtotalCents: { type: 'integer', minimum: 0 },
  discountCents: { type: 'integer', minimum: 0 },
  taxCents: { type: 'integer', minimum: 0 },
  feesCents: { type: 'integer', minimum: 0 },
  totalCents: { type: 'integer', minimum: 1 },
  items: {
    type: 'array', minItems: 1, maxItems: 500,
    items: {
      type: 'object', additionalProperties: false,
      required: Object.keys(itemProperties), properties: itemProperties
    }
  }
}

function toolSchema(accounts: MoneyAgentAccount[], categories: ImageAnalysisCategory[]): object {
  return {
    type: 'object', additionalProperties: false,
    required: ['transactions'],
    properties: {
      transactions: {
        type: 'array', minItems: 1, maxItems: 50,
        items: {
          type: 'object', additionalProperties: false,
          required: ['kind', 'counterparty', 'date', 'currency', 'amountCents', 'notes', 'accountId', 'categoryId', 'receipt'],
          properties: {
            kind: { type: 'string', enum: ['income', 'expense'] },
            counterparty: { type: 'string' },
            date: { type: 'string' },
            currency: { type: 'string', enum: ['USD'] },
            amountCents: { type: 'integer', minimum: 1 },
            notes: { type: 'string' },
            accountId: { type: 'string', enum: accounts.map((account) => account.id) },
            categoryId: { type: 'string', enum: categories.map((category) => category.id) },
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
    }
  }
}

function inputError(input: RunMoneyAgentInput): string | null {
  if (!input.apiKey.trim()) return 'Add an OpenRouter API key in Settings.'
  if (!input.model.trim()) return 'Choose an OpenRouter model in Settings.'
  if (!input.message.trim() && !input.image) return 'Write a message or attach a receipt.'
  if (input.accounts.length === 0) return 'Add an account before using the money agent.'
  if (input.categories.length === 0) return 'Add an active income or expense category first.'
  if (!input.image) return null
  if (!(TRANSACTION_IMAGE_MIME_TYPES as readonly string[]).includes(input.image.mimeType)) {
    return 'Choose a JPEG, PNG, or WebP image.'
  }
  const encoded = input.image.base64.replace(/[\r\n]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return 'The image data is unreadable.'
  }
  if (encoded.length * 0.75 > MAX_TRANSACTION_IMAGE_BYTES) {
    return 'This image is larger than 10 MB. Choose a smaller image.'
  }
  return null
}

function isMoneyAgentDraft(
  value: unknown,
  accounts: MoneyAgentAccount[],
  categories: ImageAnalysisCategory[]
): value is MoneyAgentDraft {
  if (typeof value !== 'object' || value === null || !('accountId' in value)) return false
  const accountId = value.accountId
  if (typeof accountId !== 'string' || !accounts.some((account) => account.id === accountId)) return false
  return isAnalyzedTransactionDraft(value, categories) && value.date !== null && value.categoryId !== null
}

export async function runMoneyAgent(input: RunMoneyAgentInput, fetcher: FetchLike): Promise<MoneyAgentResult> {
  const blocked = inputError(input)
  if (blocked) return { ok: false, message: blocked }
  const accounts = input.accounts.filter((account) => account.id && account.name.trim())
  const categories = input.categories.filter((category) =>
    category.id && category.name.trim() && (category.kind === 'income' || category.kind === 'expense'))
  const content: Array<Record<string, unknown>> = [{
    type: 'text',
    text: input.message.trim() || 'Read this receipt and prepare the matching purchase.'
  }]
  if (input.image) {
    content.push({ type: 'image_url', image_url: { url: `data:${input.image.mimeType};base64,${input.image.base64}` } })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  let response: Response
  try {
    response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey.trim()}`,
        'content-type': 'application/json',
        'x-title': 'Ego money agent'
      },
      body: JSON.stringify({
        model: input.model.trim(),
        messages: [
          {
            role: 'system',
            content: `You record one or more USD incomes and expenses in a personal ledger. Today is ${input.today}. Always call record_transactions once. Return one array item for each distinct transaction the user requests. Do not combine separate transactions into one total. Use today's date when the user gives no date. Choose an account from ${JSON.stringify(accounts)}. The first account is the default. Choose a category with the same kind from ${JSON.stringify(categories)}. Correct obvious merchant spelling when context is clear. For an attached itemized receipt, copy every readable line and include receipt details. The receipt total and amountCents must match. Prefer the final amount paid over a subtotal. Include visible tax, tip, and fees. Never invent receipt lines or prices. For a text-only request or an image without readable line items, set receipt to null. Put amounts in integer cents. Keep notes short and do not repeat the counterparty.`
          },
          { role: 'user', content }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'record_transactions',
            description: 'Prepare one or more transactions or itemized purchases for the user to add to Cloudflare D1.',
            strict: true,
            parameters: toolSchema(accounts, categories)
          }
        }],
        tool_choice: { type: 'function', function: { name: 'record_transactions' } }
      }),
      signal: controller.signal
    })
  } catch (error: unknown) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: 'The money agent took longer than 60 seconds. Try again.' }
    }
    return { ok: false, message: 'OpenRouter is unreachable. Check your connection and try again.' }
  }
  clearTimeout(timer)
  let value: OpenRouterResponse
  try { value = await response.json() as OpenRouterResponse } catch {
    return { ok: false, message: 'OpenRouter returned an unreadable response.' }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: 'OpenRouter rejected the API key. Check it in Settings.' }
  }
  if (response.status === 429) return { ok: false, message: 'OpenRouter rate limited the request. Wait a moment and try again.' }
  if (!response.ok) return { ok: false, message: value.error?.message ?? `OpenRouter returned HTTP ${response.status}.` }
  const message = value.choices?.[0]?.message
  if (message?.refusal) return { ok: false, message: 'The model could not prepare these transactions. Reword the request and try again.' }
  const call = message?.tool_calls?.find((item) => item.function?.name === 'record_transactions')
  if (!call?.function?.arguments) return { ok: false, message: 'The model did not prepare any transactions.' }
  let payload: unknown
  try { payload = JSON.parse(call.function.arguments) } catch {
    return { ok: false, message: 'The model returned an invalid tool call. Try again.' }
  }
  if (typeof payload !== 'object' || payload === null || !('transactions' in payload) ||
    !Array.isArray(payload.transactions) || payload.transactions.length < 1 || payload.transactions.length > 50 ||
    !payload.transactions.every((draft) => isMoneyAgentDraft(draft, accounts, categories))) {
    return { ok: false, message: 'The model could not prepare complete transactions. Add a little more detail and try again.' }
  }
  return { ok: true, data: payload.transactions }
}
