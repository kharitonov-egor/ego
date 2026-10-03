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
  /** The user attached an image. Ego sends it to the model once and keeps only a meal photo it logs. */
  hasImage: boolean
  /** Always empty. Writes can only be taken back before they save; builds before 0.6.0 still read this. */
  undo: AssistantUndo[]
}

export interface AssistantPendingChange {
  toolName: AssistantToolName
  title: string
  lines: string[]
}

/**
 * Everything one reply asked to save. The phone shows it on a card that saves itself after a few
 * seconds unless the user taps Undo. `callId` names the whole batch.
 */
export interface AssistantPendingWrite {
  callId: string
  chatId: string
  /** Workers from before 0.6.0 leave this out. */
  changes?: AssistantPendingChange[]
  /** The first change's tool, and every change folded into one title and list, for builds before 0.6.0. */
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
  /**
   * Builds from 0.6.0 send true: a card still counting down when the message arrives saves first.
   * Older builds told the user that typing drops the card, so without it the card is dropped.
   */
  autoSave?: boolean
}

/** `approved` false is the Undo button: nothing in the batch is saved. */
export interface AssistantConfirmRequest {
  chatId: string
  callId: string
  approved: boolean
  today: string
  timeZone: string | null
  units: AssistantUnits | null
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
