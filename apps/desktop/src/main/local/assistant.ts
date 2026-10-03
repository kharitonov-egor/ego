import {
  ASSISTANT_TEXT_LIMIT,
  type ApiResult, type AssistantConfirmRequest, type AssistantImage, type AssistantStreamEvent, type AssistantTurnRequest,
  type AssistantUnits
} from '@ego/api-contracts'
import { MAX_TRANSACTION_IMAGE_BYTES } from '@ego/core'
import type { AssistantApi } from '@ego/local/api-client'
import type { AssistantStreamMessage } from '../../shared/local'

const STREAM_ID = /^[A-Za-z0-9_-]{1,64}$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const IMAGE_LIMIT = Math.ceil(MAX_TRANSACTION_IMAGE_BYTES / 3) * 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function units(value: unknown): AssistantUnits | null | undefined {
  if (value === null || value === 'imperial' || value === 'metric') return value
  return undefined
}

function timeZone(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && value.length > 0 && value.length <= 100 ? value : undefined
}

function image(value: unknown): AssistantImage | null {
  if (!isRecord(value) || typeof value.base64 !== 'string' || typeof value.mimeType !== 'string') return null
  if (value.base64.length === 0 || value.base64.length > IMAGE_LIMIT || value.mimeType.length > 100) return null
  return { base64: value.base64, mimeType: value.mimeType }
}

function chatId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

/** Copies only the fields the Worker reads, or null when the renderer sent something else. */
export function parseTurnRequest(value: unknown): AssistantTurnRequest | null {
  if (!isRecord(value)) return null
  if (value.chatId !== null && !chatId(value.chatId)) return null
  if (typeof value.text !== 'string' || value.text.length > ASSISTANT_TEXT_LIMIT) return null
  if (typeof value.today !== 'string' || !DAY.test(value.today)) return null
  const zone = timeZone(value.timeZone)
  const preferred = units(value.units)
  if (zone === undefined || preferred === undefined) return null
  const attached = value.image === undefined ? undefined : image(value.image)
  if (attached === null) return null
  if (!value.text.trim() && !attached) return null
  return {
    chatId: value.chatId, text: value.text, today: value.today, timeZone: zone, units: preferred,
    ...(attached ? { image: attached } : {})
  }
}

export function parseConfirmRequest(value: unknown): AssistantConfirmRequest | null {
  if (!isRecord(value) || !chatId(value.chatId) || !chatId(value.callId) || typeof value.approved !== 'boolean') return null
  if (typeof value.today !== 'string' || !DAY.test(value.today)) return null
  const zone = timeZone(value.timeZone)
  const preferred = units(value.units)
  if (zone === undefined || preferred === undefined) return null
  return {
    chatId: value.chatId, callId: value.callId, approved: value.approved, today: value.today, timeZone: zone, units: preferred
  }
}

/**
 * Runs one streamed assistant call for the window. Each event goes back tagged with the window's
 * stream ID as it arrives, and the promise settles with the Worker's result once the stream ends.
 */
export function streamAssistant(
  api: Pick<AssistantApi, 'assistantTurn' | 'assistantConfirm'>,
  streamId: unknown,
  kind: unknown,
  request: unknown,
  send: (message: AssistantStreamMessage) => void
): Promise<ApiResult<{ done: true }>> {
  if (typeof streamId !== 'string' || !STREAM_ID.test(streamId)) throw new Error('Invalid assistant stream')
  const forward = (event: AssistantStreamEvent): void => send({ streamId, event })
  if (kind === 'turn') {
    const turn = parseTurnRequest(request)
    if (turn) return api.assistantTurn(turn, forward)
  } else if (kind === 'confirm') {
    const confirm = parseConfirmRequest(request)
    if (confirm) return api.assistantConfirm(confirm, forward)
  }
  throw new Error('Invalid assistant request')
}
