export interface TrelloBoardSummary {
  id: string
  name: string
}

export interface TrelloListSummary {
  id: string
  name: string
}

export interface TrelloResult<T> {
  ok: boolean
  data?: T
  detail?: string
}

export interface TrelloCredentials {
  apiKey: string
  token: string
}

export interface CreateCardInput {
  name: string
  desc: string
  idList: string
}

export interface CreatedCard {
  id: string
  shortUrl: string
}

/**
 * Electron hands us raw bytes from a clipboard paste. React Native's FormData cannot take a Blob
 * and instead wants a file reference, so the two platforms describe attachments differently.
 */
export type CardAttachment =
  | { kind: 'bytes'; name: string; mimeType: string; data: ArrayBuffer }
  | { kind: 'uri'; name: string; mimeType: string; uri: string }

export interface ListShortcut {
  listId: string
  listName: string
}

export interface CaptureResult {
  ok: boolean
  detail?: string
  cardUrl?: string
}
