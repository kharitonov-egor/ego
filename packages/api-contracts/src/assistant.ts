import type { AssistantToolName } from '@ego/core'
import type { ApiError } from './errors'

export interface AssistantChat {
  id: string
  /** The first message, shortened. */
  title: string
  createdAt: string
  updatedAt: string
}

export interface AssistantChatList {
  chats: AssistantChat[]
}

/** A change a reply made that can still be taken back. */
export interface AssistantUndo {
  callId: string
  label: string
}

export interface AssistantMessage {
  id: string
  chatId: string
  seq: number
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  /** What a reply read or changed, one short line each. */
  trail: string[]
  /** The user attached a receipt image. Ego reads it once and does not keep it. */
  hasImage: boolean
  /** Changes this reply made that can still be taken back. */
  undo: AssistantUndo[]
}

/** A money write waiting on the Confirm card. */
export interface AssistantPendingWrite {
  callId: string
  chatId: string
  toolName: AssistantToolName
  title: string
  lines: string[]
}

export interface AssistantImage {
  base64: string
  mimeType: string
}

/** Miles and pounds, or kilometers and kilograms, as picked in the Health settings. */
export type AssistantUnits = 'imperial' | 'metric'

export interface AssistantTurnRequest {
  /** Null starts a new chat. */
  chatId: string | null
  text: string
  image?: AssistantImage
  today: string
  timeZone: string | null
  units: AssistantUnits | null
}

export interface AssistantConfirmRequest {
  chatId: string
  callId: string
  approved: boolean
  today: string
  timeZone: string | null
  units: AssistantUnits | null
}

export interface AssistantUndoRequest {
  chatId: string
  callId: string
}

export interface AssistantUndoResponse {
  message: AssistantMessage
}

export interface AssistantHistory {
  chat: AssistantChat | null
  messages: AssistantMessage[]
  pending: AssistantPendingWrite | null
}

/** One line of the NDJSON stream a turn answers with. */
export type AssistantStreamEvent =
  | { type: 'chat'; chat: AssistantChat }
  | { type: 'message'; message: AssistantMessage }
  | { type: 'delta'; text: string }
  | { type: 'trail'; line: string }
  | { type: 'pending'; pending: AssistantPendingWrite }
  | { type: 'error'; error: ApiError }
  | { type: 'done' }

export const ASSISTANT_TEXT_LIMIT = 4000
export const ASSISTANT_HISTORY_LIMIT = 80
