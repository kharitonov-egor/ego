import { createTrelloClient, type TrelloClient } from '@ego/core'
import type { EgoSettings } from './settings'

export function trelloClientFor(settings: EgoSettings): TrelloClient {
  return createTrelloClient({
    getCredentials: () => ({
      apiKey: settings.trelloApiKey,
      token: settings.trelloToken
    }),
    fetch: (url, init) => fetch(url, init)
  })
}
