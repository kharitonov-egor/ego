import type { ImageAnalysisCategory, MoneyAgentAccount, MoneyAgentDraft } from '@ego/core'

export interface MoneyAgentRequest {
  message: string
  image?: { base64: string; mimeType: string }
  today: string
  accounts: MoneyAgentAccount[]
  categories: ImageAnalysisCategory[]
}

export interface MoneyAgentResponse {
  drafts: MoneyAgentDraft[]
}

export interface TrelloCardRequest {
  title: string
  description: string
  listId: string
}

export interface TrelloCardResponse {
  id: string
  shortUrl: string
}

export const MAX_TRELLO_ATTACHMENT_BYTES = 10 * 1024 * 1024
