import type {
  CardAttachment,
  CreateCardInput,
  CreatedCard,
  TrelloBoardSummary,
  TrelloCredentials,
  TrelloListSummary,
  TrelloResult
} from './types'

const BASE = 'https://api.trello.com/1'

/**
 * Electron's main process needs `net.fetch` rather than the global, so the caller supplies one.
 * React Native passes the global fetch.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface TrelloClientOptions {
  getCredentials: () => TrelloCredentials
  fetch: FetchLike
  onError?: (message: string) => void
}

export interface TrelloClient {
  listBoards: () => Promise<TrelloResult<TrelloBoardSummary[]>>
  listLists: (boardId: string) => Promise<TrelloResult<TrelloListSummary[]>>
  createCard: (input: CreateCardInput) => Promise<TrelloResult<CreatedCard>>
  addAttachment: (cardId: string, attachment: CardAttachment) => Promise<TrelloResult<void>>
}

/** Trello tokens start with ATTA. The 64-char hex OAuth secret is a common and silent mix-up. */
export function looksLikeTrelloToken(token: string): boolean {
  return token.trim().startsWith('ATTA')
}

export function createTrelloClient(options: TrelloClientOptions): TrelloClient {
  const { getCredentials, fetch, onError } = options

  const report = (message: string): void => {
    if (onError) onError(message)
    else console.error(message)
  }

  const missingCredentials = (): TrelloResult<never> | null => {
    const { apiKey, token } = getCredentials()
    if (apiKey && token) return null
    return { ok: false, detail: 'Trello API key or token not set' }
  }

  const authQuery = (): string => {
    const { apiKey, token } = getCredentials()
    return `key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`
  }

  const failure = (label: string, err: unknown): TrelloResult<never> => {
    const detail = err instanceof Error ? err.message : 'Network error'
    report(`[trello] ${label}: ${detail}`)
    return { ok: false, detail }
  }

  const badStatus = (label: string, status: number, body: string): TrelloResult<never> => {
    report(`[trello] ${label} -> ${status}: ${body}`)
    return { ok: false, detail: `HTTP ${status}: ${body.slice(0, 120)}` }
  }

  async function getJson<T>(path: string, label: string): Promise<TrelloResult<T>> {
    const blocked = missingCredentials()
    if (blocked) return blocked
    try {
      const response = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}${authQuery()}`)
      const text = await response.text()
      if (!response.ok) return badStatus(label, response.status, text)
      return { ok: true, data: JSON.parse(text) as T }
    } catch (err) {
      return failure(label, err)
    }
  }

  return {
    listBoards: () =>
      getJson<TrelloBoardSummary[]>('/members/me/boards?fields=name', 'listBoards'),

    listLists: (boardId) => {
      if (!boardId) return Promise.resolve({ ok: false, detail: 'Board id is empty' })
      return getJson<TrelloListSummary[]>(
        `/boards/${encodeURIComponent(boardId)}/lists?fields=name`,
        'listLists'
      )
    },

    createCard: async (input) => {
      const blocked = missingCredentials()
      if (blocked) return blocked
      if (!input.idList) return { ok: false, detail: 'List id is empty' }
      try {
        const response = await fetch(`${BASE}/cards?${authQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.name,
            desc: input.desc,
            idList: input.idList
          })
        })
        const text = await response.text()
        if (!response.ok) return badStatus('createCard', response.status, text)
        const parsed = JSON.parse(text) as CreatedCard
        return { ok: true, data: { id: parsed.id, shortUrl: parsed.shortUrl } }
      } catch (err) {
        return failure('createCard', err)
      }
    },

    addAttachment: async (cardId, attachment) => {
      const blocked = missingCredentials()
      if (blocked) return blocked
      try {
        const form = new FormData()
        if (attachment.kind === 'bytes') {
          form.append(
            'file',
            new Blob([attachment.data], { type: attachment.mimeType }),
            attachment.name
          )
        } else {
          form.append('file', {
            uri: attachment.uri,
            name: attachment.name,
            type: attachment.mimeType
          } as unknown as Blob)
        }
        const response = await fetch(
          `${BASE}/cards/${encodeURIComponent(cardId)}/attachments?${authQuery()}`,
          { method: 'POST', body: form }
        )
        const text = await response.text()
        if (!response.ok) return badStatus('addAttachment', response.status, text)
        return { ok: true }
      } catch (err) {
        return failure('addAttachment', err)
      }
    }
  }
}
