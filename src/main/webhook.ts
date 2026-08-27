import { net } from 'electron'
import { getWebhookEnabled, getWebhookUrl } from './settings'

export interface WebhookCardEvent {
  title: string
  description: string
  listId: string
  cardId: string
  cardUrl: string
  attachmentCount: number
  createdAt: string
}

/** Fire-and-forget: a webhook failure must never block the card from being created. */
export async function notifyWebhook(event: WebhookCardEvent): Promise<void> {
  if (!getWebhookEnabled()) return
  const url = getWebhookUrl().trim()
  if (!url) return

  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'quick-add.card-created', ...event })
    })
    if (!response.ok) {
      console.error(`[webhook] POST ${url} -> ${response.status}`)
    }
  } catch (err) {
    console.error('[webhook] POST error', err)
  }
}
