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
