import type { TrelloClient } from '@ego/core'
import type { EgoApi } from './api-client'

/**
 * The same client shape the shared capture code expects, answered by the Worker. The Trello key
 * and token live in Worker secrets, so this phone never holds them.
 */
export function trelloClientFor(api: EgoApi): TrelloClient {
  return {
    listBoards: async () => {
      const result = await api.trelloBoards()
      return result.ok ? { ok: true, data: result.data } : { ok: false, detail: result.error.message }
    },
    listLists: async (boardId) => {
      const result = await api.trelloLists(boardId)
      return result.ok ? { ok: true, data: result.data } : { ok: false, detail: result.error.message }
    },
    createCard: async (input) => {
      const result = await api.trelloCard({ title: input.name, description: input.desc, listId: input.idList })
      return result.ok ? { ok: true, data: result.data } : { ok: false, detail: result.error.message }
    },
    addAttachment: async (cardId, attachment) => {
      if (attachment.kind !== 'uri') return { ok: false, detail: 'Attach a photo from this phone' }
      const result = await api.trelloAttachment(cardId, {
        uri: attachment.uri, name: attachment.name, mimeType: attachment.mimeType
      })
      return result.ok ? { ok: true } : { ok: false, detail: result.error.message }
    }
  }
}
