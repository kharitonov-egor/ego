import type { CardAttachment, CaptureResult } from './types'
import type { TrelloClient } from './trello'

export interface CaptureInput {
  title: string
  description: string
  listId: string
  attachments: CardAttachment[]
}

/**
 * One capture is one card plus its attachments. Both apps call this so the success and partial
 * failure wording stays identical across desktop and mobile.
 */
export async function captureToTrello(
  client: TrelloClient,
  input: CaptureInput
): Promise<CaptureResult> {
  if (!input.listId) {
    return { ok: false, detail: 'Trello list not set. Open Settings.' }
  }

  const card = await client.createCard({
    name: input.title.trim() || '(empty)',
    desc: input.description.trim(),
    idList: input.listId
  })
  if (!card.ok || !card.data) {
    return { ok: false, detail: card.detail ?? 'Failed to create card' }
  }

  if (input.attachments.length === 0) {
    return { ok: true, cardUrl: card.data.shortUrl }
  }

  const uploads = await Promise.all(
    input.attachments.map((attachment) => client.addAttachment(card.data!.id, attachment))
  )
  const failed = uploads.filter((result) => !result.ok).length

  if (failed > 0) {
    return {
      ok: false,
      detail: `Card created, ${failed}/${uploads.length} attachment(s) failed`,
      cardUrl: card.data.shortUrl
    }
  }

  return { ok: true, cardUrl: card.data.shortUrl }
}
