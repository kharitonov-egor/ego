import type { FetchLike } from './trello'

export const MAX_IMAGE_TEXT_BYTES = 10 * 1024 * 1024
export const IMAGE_TEXT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const IMAGE_TEXT_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const
export type ImageTextEffort = typeof IMAGE_TEXT_EFFORTS[number]

export interface ReadImageTextInput {
  base64: string
  mimeType: string
  apiKey: string
  model: string
  effort: ImageTextEffort
}

export type ReadImageTextResult =
  | { ok: true; text: string }
  | { ok: false; message: string }

interface OpenRouterTextResponse {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null } }>
  error?: { message?: string }
}

const NO_TEXT = '[[NO TEXT]]'

const INSTRUCTIONS = [
  'You transcribe the text in an image, such as a screenshot or a photo.',
  'Return every piece of text you can see, exactly as written, in its original language and script. The image may mix several languages.',
  'Copy each word in the script it is written in. Never transliterate: a Cyrillic name stays in Cyrillic.',
  'Do not translate, correct spelling, summarize, explain, or describe the image.',
  'Keep the reading order and keep a line break wherever a line ends in the image. Add a blank line only where the image shows a clear gap between blocks.',
  'Keep the spaces that indent a line, as in code.',
  'Put each table row on its own line with a tab between cells.',
  'Return plain text only: no Markdown, no code fences, no quotes, and no introduction.',
  `If the image has no text at all, return exactly ${NO_TEXT}`
].join(' ')

export function isImageTextEffort(value: unknown): value is ImageTextEffort {
  return typeof value === 'string' && (IMAGE_TEXT_EFFORTS as readonly string[]).includes(value)
}

function imageError(input: ReadImageTextInput): string | null {
  if (!input.apiKey.trim()) return 'The Worker has no OpenRouter key.'
  if (!input.model.trim()) return 'No image to text model is set.'
  if (!(IMAGE_TEXT_MIME_TYPES as readonly string[]).includes(input.mimeType)) return 'Send a JPEG, PNG, or WebP image.'
  const encoded = input.base64.replace(/[\r\n]/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return 'The image data is unreadable.'
  if (encoded.length * 0.75 > MAX_IMAGE_TEXT_BYTES) return 'This image is larger than 10 MB.'
  return null
}

/** Models sometimes wrap the answer in a code fence even when told not to. */
export function cleanImageText(content: string): string {
  const trimmed = content.replace(/^﻿/, '').trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  const text = (fenced ? fenced[1] : trimmed).replace(/\r\n/g, '\n').trim()
  return text === NO_TEXT ? '' : text
}

export async function readImageText(input: ReadImageTextInput, fetcher: FetchLike, timeoutMs = 20000): Promise<ReadImageTextResult> {
  const blocked = imageError(input)
  if (blocked) return { ok: false, message: blocked }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey.trim()}`,
        'content-type': 'application/json',
        'x-title': 'Ego image to text'
      },
      body: JSON.stringify({
        model: input.model.trim(),
        messages: [
          { role: 'system', content: INSTRUCTIONS },
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.base64.replace(/[\r\n]/g, '')}` } }]
          }
        ],
        max_tokens: 8000,
        reasoning: { effort: input.effort, exclude: true }
      }),
      signal: controller.signal
    })
  } catch (error: unknown) {
    clearTimeout(timer)
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: `Reading the image took longer than ${Math.round(timeoutMs / 1000)} seconds.` }
    }
    return { ok: false, message: 'OpenRouter is unreachable.' }
  }
  clearTimeout(timer)
  let value: OpenRouterTextResponse
  try {
    value = await response.json() as OpenRouterTextResponse
  } catch {
    return { ok: false, message: 'OpenRouter returned an unreadable response.' }
  }
  if (response.status === 401 || response.status === 403) return { ok: false, message: 'OpenRouter rejected the Worker key.' }
  if (response.status === 429) return { ok: false, message: 'OpenRouter is rate limiting. Try again in a moment.' }
  if (!response.ok) return { ok: false, message: value.error?.message ?? `OpenRouter returned HTTP ${response.status}.` }
  const message = value.choices?.[0]?.message
  if (message?.refusal) return { ok: false, message: 'The model would not read this image.' }
  if (typeof message?.content !== 'string') return { ok: false, message: 'The model returned no answer.' }
  return { ok: true, text: cleanImageText(message.content) }
}
