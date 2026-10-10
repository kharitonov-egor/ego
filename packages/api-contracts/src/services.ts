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

/** One sync of the Work list. `problem` is the first change Trello refused; everything else still synced. */
export interface TrelloWorkSyncResult {
  changed: boolean
  problem: string | null
}
